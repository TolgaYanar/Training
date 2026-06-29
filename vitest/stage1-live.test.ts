import { test, vi, beforeAll, afterAll, expect } from 'vitest'
import { generateOption } from '../src/ai'
import { datasets } from '../src/data'

const KEY = process.env.VITE_CLAUDE_API_KEY ?? ''
const LIVE = process.env.RUN_LIVE_API === '1' && KEY.length > 0
beforeAll(() => { if (LIVE) vi.stubEnv('VITE_CLAUDE_API_KEY', KEY) })
afterAll(() => vi.unstubAllEnvs())

const rowsOf = (id: string) => datasets.find((d) => d.id === id)!.rows
/* eslint-disable @typescript-eslint/no-explicit-any */

const CASES = [
  { feat: 'stacked', dataset: 'sales', prompt: 'stacked bar of revenue by region for each month',
    ok: (o: any) => Array.isArray(o.series) && o.series.length > 1 && o.series.every((s: any) => s.stack) },
  { feat: 'horizontal', dataset: 'sales', prompt: 'horizontal bar chart of total units by product',
    ok: (o: any) => (Array.isArray(o.xAxis) ? o.xAxis[0] : o.xAxis)?.type === 'value' && (Array.isArray(o.yAxis) ? o.yAxis[0] : o.yAxis)?.type === 'category' },
  { feat: 'step', dataset: 'traffic', prompt: 'daily total visits as a step line chart',
    ok: (o: any) => o.series?.[0]?.step != null },
  { feat: 'donut', dataset: 'sales', prompt: 'share of total revenue by region as a donut chart',
    ok: (o: any) => Array.isArray(o.series?.[0]?.radius) },
  { feat: 'rose', dataset: 'sales', prompt: 'total units by product as a nightingale rose chart',
    ok: (o: any) => o.series?.[0]?.roseType != null },
]

test.skipIf(!LIVE)('LIVE: model emits the Stage 1 toggles end-to-end', async () => {
  let pass = 0
  for (const c of CASES) {
    const t0 = Date.now()
    const r = await generateOption({ prompt: c.prompt, rows: rowsOf(c.dataset) })
    const ms = Date.now() - t0
    if (r.status !== 'ok') { process.stdout.write(`FAIL ${c.feat} (${ms}ms): ${('error' in r) ? r.error : ''}\n`) }
    else {
      const good = c.ok(r.option as any)
      if (good) pass++
      process.stdout.write(`${good ? 'PASS' : 'MISS'} ${c.feat} (${ms}ms)  raw=${r.raw}\n`)
    }
    await new Promise((res) => setTimeout(res, 400))
  }
  process.stdout.write(`=== STAGE 1 LIVE ${pass}/${CASES.length} ===\n`)
  expect(pass).toBe(CASES.length)
}, 590000)
