import { test, expect, vi, beforeAll, afterAll } from 'vitest'
import { generateOption, deidentify } from '../src/ai'
import { datasets } from '../src/data'

const PROXY = process.env.VITE_LLM_PROXY ?? ''
const LIVE = process.env.RUN_LIVE_API === '1' && PROXY.length > 0
const rows = datasets.find((d) => d.id === 'sales')!.rows

beforeAll(() => { if (LIVE) vi.stubEnv('VITE_LLM_PROXY', PROXY) })
afterAll(() => vi.unstubAllEnvs())

function catAxis(option: any) {
  const x = Array.isArray(option?.xAxis) ? option.xAxis[0] : option?.xAxis
  const y = Array.isArray(option?.yAxis) ? option.yAxis[0] : option?.yAxis
  const cat = Array.isArray(x?.data) ? x : Array.isArray(y?.data) ? y : x
  return String(cat?.name ?? '').toLowerCase()
}

const cases = [
  { prompt: 'show revenue by region, ping me at 555-123-4567', mask: '4567', xName: 'region' },
  { prompt: 'monthly units for Jonathan as a line chart', mask: 'Jonathan', xName: 'month' },
  { prompt: 'compare units by region for Widget — my card is 4111 1111 1111 1111', mask: '4111', xName: 'region' },
]

test.skipIf(!LIVE)('gate-masked prompts still produce the right chart through the real model', async () => {
  for (const c of cases) {
    const { safePrompt } = deidentify(c.prompt, rows)
    expect(safePrompt, `leak check: ${c.prompt}`).not.toContain(c.mask)

    const res = await generateOption({ prompt: c.prompt, rows })
    expect(res.status, `${c.prompt} -> ${JSON.stringify(res).slice(0, 200)}`).toBe('ok')
    if (res.status === 'ok') {
      expect(catAxis(res.option), `xName for: ${c.prompt}`).toBe(c.xName)
    }
  }
}, 60000)
