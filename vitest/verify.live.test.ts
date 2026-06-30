import { test, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { generateOption } from '../src/ai'
import { datasets } from '../src/data'
import { extractJson } from '../src/validate'

const KEY = process.env.VITE_CLAUDE_API_KEY ?? ''
const PROXY = process.env.VITE_LLM_PROXY ?? ''
const CASES_PATH = process.env.LIVE_CASES ?? ''
const OUT = process.env.OUT ?? ''
const LIVE = process.env.RUN_LIVE_API === '1' && (KEY.length > 0 || PROXY.length > 0) && CASES_PATH.length > 0

beforeAll(() => { if (LIVE) { vi.stubEnv('VITE_CLAUDE_API_KEY', KEY); vi.stubEnv('VITE_LLM_PROXY', PROXY) } })
afterAll(() => vi.unstubAllEnvs())

const rowsOf = (id: string) => datasets.find((d) => d.id === id)!.rows
/* eslint-disable @typescript-eslint/no-explicit-any */

function facts(option: any) {
  const xRaw = option?.xAxis, yRaw = option?.yAxis
  const xs = Array.isArray(xRaw) ? xRaw : [xRaw]
  const ys = Array.isArray(yRaw) ? yRaw : [yRaw]
  const xSingle = xs[0], ySingle = ys[0]
  const xIsCat = Array.isArray(xSingle?.data)
  const yIsCat = Array.isArray(ySingle?.data)
  const catAxis = xIsCat ? xSingle : yIsCat ? ySingle : xSingle
  const valAxes = (catAxis === xSingle ? ys : xs).filter(Boolean)
  const series: any[] = option?.series ?? []
  const pie = series[0]?.type === 'pie' ? series[0] : null
  const radius = pie?.radius
  const innerRadius = Array.isArray(radius) ? radius[0] : undefined
  return {
    types: [...new Set(series.map((s) => s.type))],
    xName: catAxis?.name ?? null,
    catValues: Array.isArray(catAxis?.data) ? catAxis.data.slice(0, 8) : undefined,
    yNames: valAxes.map((a: any) => a?.name).filter(Boolean),
    xLen: (Array.isArray(catAxis?.data) ? catAxis.data.length : series[0]?.data?.length) ?? null,
    seriesNames: series.map((s) => s.name).filter(Boolean),
    seriesData: series.map((s) => s.data),
    seriesCount: series.length,
    pieSlices: pie ? pie.data?.length : undefined,
    stacked: series.some((s) => s.stack != null),
    horizontal: yIsCat && !xIsCat && series.some((s) => s.type === 'bar'),
    step: series.some((s) => s.step != null && s.step !== false),
    smooth: series.some((s) => s.smooth === true),
    donut: pie != null && innerRadius != null && innerRadius !== 0 && innerRadius !== '0%' && innerRadius !== '0',
    rose: pie?.roseType != null && pie.roseType !== false,
    dualAxis: catAxis === xSingle ? ys.length === 2 : xs.length === 2,
  }
}

function evaluate(e: any, f: any): string[] {
  const fails: string[] = []
  const lc = (s: any) => String(s ?? '').toLowerCase()
  const isPie = f.types.includes('pie')
  if (e.typesAnyOf && (f.types.length === 0 || !f.types.every((t: string) => e.typesAnyOf.includes(t)))) fails.push(`type[${f.types}]!subsetOf[${e.typesAnyOf}]`)
  if (e.xLen != null && f.xLen !== e.xLen) fails.push(`xLen ${f.xLen}!=${e.xLen}`)
  if (e.xLenMin != null && !(f.xLen >= e.xLenMin)) fails.push(`xLen ${f.xLen}<${e.xLenMin}`)
  if (e.xLenMax != null && !(f.xLen <= e.xLenMax)) fails.push(`xLen ${f.xLen}>${e.xLenMax}`)
  if (e.seriesCount != null && f.seriesCount !== e.seriesCount) fails.push(`series ${f.seriesCount}!=${e.seriesCount}`)
  if (e.seriesCountMin != null && !(f.seriesCount >= e.seriesCountMin)) fails.push(`series ${f.seriesCount}<${e.seriesCountMin}`)
  if (e.pieSlices != null && f.pieSlices !== e.pieSlices) fails.push(`slices ${f.pieSlices}!=${e.pieSlices}`)
  if (e.xNameAnyOf && !isPie && !e.xNameAnyOf.map(lc).includes(lc(f.xName))) fails.push(`xName "${f.xName}"!in[${e.xNameAnyOf}]`)
  if (e.yNameAnyOf && !isPie && !f.yNames.some((y: any) => e.yNameAnyOf.map(lc).includes(lc(y)))) fails.push(`yName "${f.yNames}"!in[${e.yNameAnyOf}]`)
  for (const flag of ['stacked', 'horizontal', 'step', 'smooth', 'donut', 'rose', 'dualAxis']) {
    if (e[flag] != null && f[flag] !== e[flag]) fails.push(`${flag} ${f[flag]}!=${e[flag]}`)
  }
  return fails
}

test.skipIf(!LIVE)('VERIFY: user prompt suite through the wired pipeline', async () => {
  const cases: any[] = JSON.parse(readFileSync(CASES_PATH, 'utf8'))
  const report: any[] = []
  const lines: string[] = []
  let pass = 0, pipelineFail = 0

  for (const c of cases) {
    let rec: any = { id: c.id, group: c.group, dataset: c.dataset, prompt: c.prompt, note: c.note ?? null }
    try {
      const r: any = await generateOption({ prompt: c.prompt, rows: rowsOf(c.dataset) })
      let spec: any = null
      try { spec = JSON.parse(extractJson(r.raw)) } catch { /* */ }
      if (r.status !== 'ok') {
        pipelineFail++
        rec = { ...rec, status: 'PIPELINE-FAIL', error: r.error, spec }
        lines.push(`${c.id} PIPELINE-FAIL :: ${r.error}`)
      } else {
        const f = facts(r.option)
        const miss = evaluate(c.expect, f)
        const ok = miss.length === 0
        if (ok) pass++
        rec = { ...rec, status: ok ? 'PASS' : 'MISS', repaired: !!r.repaired, fails: miss, facts: f, spec }
        lines.push(`${c.id} ${ok ? 'PASS' : 'MISS '} :: x=${f.xName} n=${f.seriesCount} t=${f.types} xLen=${f.xLen}${f.stacked ? ' stacked' : ''}${f.horizontal ? ' horiz' : ''}${f.step ? ' step' : ''}${f.smooth ? ' smooth' : ''}${f.donut ? ' donut' : ''}${f.rose ? ' rose' : ''}${f.dualAxis ? ' dualY' : ''}${r.repaired ? ' (rep)' : ''}${ok ? '' : '  <<' + miss.join('; ')}`)
      }
    } catch (err) {
      pipelineFail++
      rec = { ...rec, status: 'THREW', error: (err as Error).message }
      lines.push(`${c.id} THREW :: ${(err as Error).message}`)
    }
    report.push(rec)
    await new Promise((res) => setTimeout(res, 900))
  }

  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))
  const n = cases.length
  // eslint-disable-next-line no-console
  console.log(`\n=== VERIFY (${n} cases) ===\n${lines.join('\n')}\n=== pipeline-ok ${n - pipelineFail}/${n} | strict-pass ${pass}/${n} (${Math.round((100 * pass) / n)}%) ===\n`)
  expect(report.length).toBe(n)
}, 590000)
