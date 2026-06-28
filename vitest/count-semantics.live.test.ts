import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateOption } from '../src/ai'
import { datasets } from '../src/data.ts'

const KEY = process.env.VITE_CLAUDE_API_KEY ?? ''
const RUN = process.env.RUN_LIVE_API === '1' && KEY.length > 0
beforeEach(() => vi.stubEnv('VITE_CLAUDE_API_KEY', KEY))
afterEach(() => vi.unstubAllEnvs())

interface C { p: string; ds: string; want: 'count' | 'total' }
const CASES: C[] = [
  { p: 'amount of channels, separately, its visits are more than 600 in February', ds: 'traffic', want: 'count' },
  { p: 'for each region, how often did units top 150?', ds: 'sales', want: 'count' },
  { p: 'tally up the days per channel where signups beat 40', ds: 'traffic', want: 'count' },
  { p: 'per sensor, on how many readings did the mercury climb past 17?', ds: 'readings', want: 'count' },
  { p: 'for every product, in how many months did revenue clear 4000?', ds: 'sales', want: 'count' },
  { p: 'show me the frequency of high-traffic days — visits over 1100 — for every channel', ds: 'traffic', want: 'count' },
  { p: 'which sensors and how frequently did humidity exceed 70, one bar each', ds: 'readings', want: 'count' },
  { p: 'break down by region the number of widget-months that beat 4000 in revenue', ds: 'sales', want: 'count' },
  { p: 'total revenue per region', ds: 'sales', want: 'total' },
  { p: 'how many units did each region sell', ds: 'sales', want: 'total' },
  { p: 'the average number of visits per day for each channel', ds: 'traffic', want: 'total' },
  { p: 'sum up visits by channel but only for days over 500', ds: 'traffic', want: 'total' },
]

test.skipIf(!RUN)('count-vs-total decided by the model alone (no guardrail), across novel wordings', async () => {
  const lines: string[] = []
  let pass = 0
  for (const c of CASES) {
    const rows = datasets.find((d) => d.id === c.ds)!.rows
    const r = await generateOption({ prompt: c.p, rows })
    let agg = '?'
    try { agg = JSON.parse((r as any).raw).aggregate ?? '(unset)' } catch { /* ignore */ }
    let maxv = -1
    if (r.status === 'ok') {
      for (const s of (r.option as any).series ?? []) for (const v of s.data ?? []) if (typeof v === 'number' && v > maxv) maxv = v
    }
    const looksCount = maxv >= 0 && maxv <= 370
    const ok = c.want === 'count' ? looksCount : !looksCount
    if (ok) pass++
    lines.push(`${ok ? 'PASS' : 'FAIL'} want=${c.want} rawAgg=${agg} maxVal=${maxv} :: "${c.p}"`)
    await new Promise((res) => setTimeout(res, 900))
  }
  // eslint-disable-next-line no-console
  console.log('\n=== COUNT SEMANTICS ===\n' + lines.join('\n') + `\n=== ${pass}/${CASES.length} ===\n`)
  expect(pass).toBe(CASES.length)
}, 200000)
