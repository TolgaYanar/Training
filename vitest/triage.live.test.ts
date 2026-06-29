import { test, vi, beforeEach, afterEach } from 'vitest'
import { generateOption } from '../src/ai'
import { datasets } from '../src/data.ts'
import { extractJson } from '../src/validate'

const KEY = process.env.VITE_CLAUDE_API_KEY ?? ''
const PROXY = process.env.VITE_LLM_PROXY ?? ''
const RUN = process.env.RUN_LIVE_API === '1' && (KEY.length > 0 || PROXY.length > 0)
const REPS = Number(process.env.REPS ?? 3)
const TAG = process.env.TAG ?? ''
beforeEach(() => { vi.stubEnv('VITE_CLAUDE_API_KEY', KEY); vi.stubEnv('VITE_LLM_PROXY', PROXY) })
afterEach(() => vi.unstubAllEnvs())

const CASES: Array<{ id: string; ds: string; p: string; ok: (f: any) => boolean }> = [
  { id: '#1', ds: 'sales', p: 'Restrict to Gadget in the West region and only months whose revenue exceeded 2000, then chart revenue for each remaining month.', ok: (f) => f.xLen === 9 },
  { id: '#38', ds: 'sales', p: 'monthly revenue by region for every region except North and only products that aren\'t Widget', ok: (f) => ['month', 'date'].includes(String(f.x).toLowerCase()) && f.n === 3 },
  { id: '#114', ds: 'sales', p: 'the highest single month units sold per product across all regions', ok: (f) => f.x === 'product' && f.xLen === 3 && f.n === 1 },
]

test.skipIf(!RUN)('TRIAGE faithful proxy', async () => {
  const pass: Record<string, number> = {}
  for (const c of CASES) pass[c.id] = 0
  for (let rep = 0; rep < REPS; rep++) {
    for (const c of CASES) {
      const rows = datasets.find((d) => d.id === c.ds)!.rows
      let line = `${TAG} ${c.id} rep${rep}: ERR`
      try {
        const r = await generateOption({ prompt: c.p, rows })
        let s: any = {}; try { s = JSON.parse(extractJson((r as any).raw)) } catch { /* */ }
        const o: any = r.status === 'ok' ? r.option : {}
        const xa = Array.isArray(o.xAxis) ? o.xAxis[0] : o.xAxis
        const f = { x: xa?.name, n: (o.series ?? []).length, xLen: xa?.data?.length ?? o.series?.[0]?.data?.length }
        const ok = r.status === 'ok' && c.ok(f)
        if (ok) pass[c.id]++
        line = `${TAG} ${c.id} rep${rep}: ${ok ? 'PASS' : 'FAIL'} x=${f.x} n=${f.n} xLen=${f.xLen} raw=${JSON.stringify({ x: s.x, series: s.series, agg: s.aggregate, over: s.over })}`
      } catch (e) { line += ' ' + String((e as Error).message).slice(0, 80) }
      // eslint-disable-next-line no-console
      console.log(line)
      await new Promise((res) => setTimeout(res, 400))
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\n=== ${TAG} TALLY (N=${REPS}) ===\n` + CASES.map((c) => `${c.id}: ${pass[c.id]}/${REPS}`).join('  '))
}, 900000)
