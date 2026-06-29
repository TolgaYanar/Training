import { test, expect, vi, beforeAll, afterAll } from 'vitest'
import { generateOption } from '../src/ai'
import { datasets } from '../src/data'

const KEY = process.env.VITE_CLAUDE_API_KEY ?? ''
const LIVE = process.env.RUN_LIVE_API === '1' && KEY.length > 0

beforeAll(() => { if (LIVE) vi.stubEnv('VITE_CLAUDE_API_KEY', KEY) })
afterAll(() => vi.unstubAllEnvs())

const rowsOf = (id: string) => datasets.find((d) => d.id === id)!.rows

/* eslint-disable @typescript-eslint/no-explicit-any */
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
    yName: Array.isArray(valRaw) ? valRaw.map((y: any) => y.name) : valAxis?.name,
    xData: catData,
    xLen: catData?.length ?? (series[0]?.data?.length),
    seriesCount: series.length,
    seriesNames: series.map((s) => s.name),
    title: option?.title?.text,
  }
}

interface Case { name: string; dataset: string; prompt: string; check: (f: ReturnType<typeof facts>) => string[] }

const CASES: Case[] = [
  {
    name: 'line + series mapping', dataset: 'sales', prompt: 'monthly revenue by region as a line chart',
    check: (f) => [
      f.types.every((t) => t === 'line') ? '' : `type=${f.types}`,
      f.xLen === 12 ? '' : `x not 12 months (${f.xLen})`,
      f.seriesCount === 4 ? '' : `not 4 region series (${f.seriesCount})`,
    ].filter(Boolean),
  },
  {
    name: 'bar over a category', dataset: 'sales', prompt: 'total units by product',
    check: (f) => [
      f.types.includes('bar') ? '' : `type=${f.types}`,
      f.xLen === 3 ? '' : `x not 3 products (${f.xLen})`,
      f.seriesCount === 1 ? '' : `not single series (${f.seriesCount})`,
    ].filter(Boolean),
  },
  {
    name: 'pie share', dataset: 'sales', prompt: 'share of total revenue by region',
    check: (f) => [
      f.types.includes('pie') ? '' : `type=${f.types}`,
      f.xLen === 4 ? '' : `not 4 region slices (${f.xLen})`,
    ].filter(Boolean),
  },
  {
    name: 'top-N ranking', dataset: 'sales', prompt: 'the 5 highest-revenue months',
    check: (f) => [f.xLen === 5 ? '' : `not top-5 (${f.xLen})`].filter(Boolean),
  },
  {
    name: 'large grouped time series', dataset: 'traffic', prompt: 'daily signups by channel',
    check: (f) => [
      f.xLen && f.xLen > 300 ? '' : `x not daily (${f.xLen})`,
      f.seriesCount === 4 ? '' : `not 4 channel series (${f.seriesCount})`,
    ].filter(Boolean),
  },
  {
    name: 'bucket to month', dataset: 'traffic', prompt: 'total monthly visits',
    check: (f) => [f.xLen === 12 ? '' : `not 12 month buckets (${f.xLen})`].filter(Boolean),
  },
  {
    name: 'filter to one value', dataset: 'traffic', prompt: 'visits for the Organic channel over time',
    check: (f) => [
      f.seriesCount === 1 ? '' : `not single series (${f.seriesCount})`,
      f.xLen && f.xLen > 300 ? '' : `x not daily (${f.xLen})`,
    ].filter(Boolean),
  },
  {
    name: 'derived ratio', dataset: 'traffic', prompt: 'conversion rate of signups divided by visits, per channel',
    check: (f) => [f.xLen === 4 ? '' : `x not 4 channels (${f.xLen})`].filter(Boolean),
  },
  {
    name: 'two-series over time', dataset: 'readings', prompt: 'temperature for each sensor over time',
    check: (f) => [
      f.seriesCount === 2 ? '' : `not 2 sensor series (${f.seriesCount})`,
      f.xLen === 14 ? '' : `x not 14 days (${f.xLen})`,
    ].filter(Boolean),
  },
]

test.skipIf(!LIVE)('LIVE: Claude picks the right spec through the de-identification layer', async () => {
  const rows: string[] = []
  let pipelineFails = 0
  let judgmentPass = 0

  for (const c of CASES) {
    let line: string
    try {
      const r = await generateOption({ prompt: c.prompt, rows: rowsOf(c.dataset) })
      if (r.status !== 'ok') {
        pipelineFails++
        line = `PIPELINE-FAIL  ${c.name}  ::  ${r.error}`
      } else {
        const f = facts(r.option)
        const miss = c.check(f)
        if (miss.length === 0) {
          judgmentPass++
          line = `PASS  ${c.name}  ::  x=${f.xName} y=${f.yName} series=${f.seriesCount} type=${[...new Set(f.types)]}${r.repaired ? ' (repaired)' : ''}`
        } else {
          line = `JUDGMENT-MISS  ${c.name}  ::  ${miss.join('; ')}  [x=${f.xName} series=${f.seriesCount} type=${[...new Set(f.types)]} title="${f.title}"]`
        }
      }
    } catch (e) {
      pipelineFails++
      line = `THREW  ${c.name}  ::  ${(e as Error).message}`
    }
    rows.push(line)
    await new Promise((res) => setTimeout(res, 1200))
  }

  // eslint-disable-next-line no-console
  console.log(`\n=== LIVE CLAUDE PIPELINE (${CASES.length} prompts) ===\n${rows.join('\n')}\n=== pipeline ok: ${CASES.length - pipelineFails}/${CASES.length} | spec correct: ${judgmentPass}/${CASES.length} ===\n`)

  expect(pipelineFails).toBe(0)
  expect(judgmentPass).toBeGreaterThanOrEqual(Math.ceil(CASES.length * 0.7))
}, 180000)
