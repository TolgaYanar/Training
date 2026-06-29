import { test, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateOption } from '../src/ai'
import { datasets } from '../src/data'

const KEY = process.env.VITE_CLAUDE_API_KEY ?? ''
const PROXY = process.env.VITE_LLM_PROXY ?? ''
const CASES_PATH = process.env.LIVE_CASES ?? ''
const LIVE = process.env.RUN_LIVE_API === '1' && (KEY.length > 0 || PROXY.length > 0) && CASES_PATH.length > 0

beforeAll(() => { if (LIVE) { vi.stubEnv('VITE_CLAUDE_API_KEY', KEY); vi.stubEnv('VITE_LLM_PROXY', PROXY) } })
afterAll(() => vi.unstubAllEnvs())

const rowsOf = (id: string) => datasets.find((d) => d.id === id)!.rows
/* eslint-disable @typescript-eslint/no-explicit-any */

interface Expect {
  typesAnyOf?: string[]; xLen?: number; xLenMin?: number; xLenMax?: number
  seriesCount?: number; pieSlices?: number; xNameAnyOf?: string[]; yNameAnyOf?: string[]
}
interface Case { name: string; dataset: string; prompt: string; expect: Expect }

function facts(option: any) {
  const xRaw = option?.xAxis
  const yRaw = option?.yAxis
  const xAxis = Array.isArray(xRaw) ? xRaw[0] : xRaw
  const yAxis = Array.isArray(yRaw) ? yRaw[0] : yRaw
  const catAxis = Array.isArray(xAxis?.data) ? xAxis : Array.isArray(yAxis?.data) ? yAxis : xAxis
  const valRaw = catAxis === xAxis ? yRaw : xRaw
  const valAxis = Array.isArray(valRaw) ? valRaw[0] : valRaw
  const series: any[] = option?.series ?? []
  const catData: any[] | undefined = Array.isArray(catAxis?.data) ? catAxis.data : undefined
  return {
    types: series.map((s) => s.type),
    xName: catAxis?.name,
    yName: Array.isArray(valRaw) ? valRaw.map((y: any) => y.name).filter(Boolean) : valAxis?.name,
    xLen: catData?.length ?? series[0]?.data?.length,
    seriesCount: series.length,
    pieSlices: series[0]?.type === 'pie' ? series[0]?.data?.length : undefined,
  }
}

function evaluate(e: Expect, f: ReturnType<typeof facts>): string[] {
  const fails: string[] = []
  const yNames = (Array.isArray(f.yName) ? f.yName : [f.yName]).filter(Boolean).map((s: any) => String(s).toLowerCase())
  const isPie = f.types.includes('pie')
  if (e.typesAnyOf && (f.types.length === 0 || !f.types.every((t) => e.typesAnyOf!.includes(t)))) fails.push(`type[${f.types}]∉${e.typesAnyOf}`)
  if (e.xLen != null && f.xLen !== e.xLen) fails.push(`xLen ${f.xLen}≠${e.xLen}`)
  if (e.xLenMin != null && !(f.xLen >= e.xLenMin)) fails.push(`xLen ${f.xLen}<${e.xLenMin}`)
  if (e.xLenMax != null && !(f.xLen <= e.xLenMax)) fails.push(`xLen ${f.xLen}>${e.xLenMax}`)
  if (e.seriesCount != null && f.seriesCount !== e.seriesCount) fails.push(`series ${f.seriesCount}≠${e.seriesCount}`)
  if (e.pieSlices != null && f.pieSlices !== e.pieSlices) fails.push(`slices ${f.pieSlices}≠${e.pieSlices}`)
  if (e.xNameAnyOf && !isPie && !e.xNameAnyOf.map((s) => s.toLowerCase()).includes(String(f.xName ?? '').toLowerCase())) fails.push(`xName "${f.xName}"∉${e.xNameAnyOf}`)
  if (e.yNameAnyOf && !isPie && !yNames.some((y) => e.yNameAnyOf!.map((s) => s.toLowerCase()).includes(y))) fails.push(`yName "${f.yName}"∉${e.yNameAnyOf}`)
  return fails
}

test.skipIf(!LIVE)('LIVE matrix: Claude picks the right spec through de-identification', async () => {
  const all: Case[] = JSON.parse(readFileSync(CASES_PATH, 'utf8'))
  const offset = Number(process.env.LIVE_OFFSET ?? 0)
  const limit = Number(process.env.LIVE_LIMIT ?? all.length)
  const cases = all.slice(offset, offset + limit)

  const lines: string[] = []
  let pipelineFails = 0
  let pass = 0
  const misses: string[] = []

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    const idx = offset + i
    try {
      const r = await generateOption({ prompt: c.prompt, rows: rowsOf(c.dataset) })
      if (r.status !== 'ok') {
        pipelineFails++
        lines.push(`#${idx} PIPELINE-FAIL  [${c.dataset}] ${c.name}  ::  ${r.error}`)
      } else {
        const f = facts(r.option)
        const miss = evaluate(c.expect, f)
        if (miss.length === 0) {
          pass++
          lines.push(`#${idx} PASS  [${c.dataset}] ${c.name}  ::  x=${f.xName} y=${f.yName} n=${f.seriesCount} t=${[...new Set(f.types)]}${r.repaired ? ' (rep)' : ''}`)
        } else {
          const m = `#${idx} MISS  [${c.dataset}] ${c.name}  ::  "${c.prompt}"  ::  ${miss.join('; ')}  [got x=${f.xName} n=${f.seriesCount} t=${[...new Set(f.types)]} xLen=${f.xLen}]`
          lines.push(m); misses.push(m)
        }
      }
    } catch (err) {
      pipelineFails++
      lines.push(`#${idx} THREW  [${c.dataset}] ${c.name}  ::  ${(err as Error).message}`)
    }
    await new Promise((res) => setTimeout(res, 900))
  }

  const n = cases.length
  // eslint-disable-next-line no-console
  console.log(`\n=== LIVE MATRIX (${n} cases, offset ${offset}) ===\n${lines.join('\n')}\n=== pipeline ok: ${n - pipelineFails}/${n} | spec correct: ${pass}/${n} (${Math.round((100 * pass) / n)}%) ===\nMISSES:\n${misses.join('\n') || '(none)'}\n`)

  expect(pipelineFails).toBe(0)
  expect(pass).toBeGreaterThanOrEqual(Math.ceil(n * 0.8))
}, 590000)
