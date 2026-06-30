import { test, expect, vi, beforeAll, afterAll } from 'vitest'
import { writeFileSync } from 'node:fs'
import { generateOption } from '../src/ai'
import { datasets } from '../src/data'

const KEY = process.env.VITE_CLAUDE_API_KEY ?? ''
const PROXY = process.env.VITE_LLM_PROXY ?? ''
const OUT = process.env.OUT ?? ''
const LIVE = process.env.RUN_LIVE_API === '1' && (KEY.length > 0 || PROXY.length > 0)
beforeAll(() => { if (LIVE) { vi.stubEnv('VITE_CLAUDE_API_KEY', KEY); vi.stubEnv('VITE_LLM_PROXY', PROXY) } })
afterAll(() => vi.unstubAllEnvs())
/* eslint-disable @typescript-eslint/no-explicit-any */

const rowsOf = (id: string) => datasets.find((d) => d.id === id)!.rows
const r2 = (x: number) => Math.round(x * 100) / 100
const t = datasets.find((d) => d.id === 'traffic')!.rows
const s = datasets.find((d) => d.id === 'sales')!.rows
const rd = datasets.find((d) => d.id === 'readings')!.rows

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CH = ['Organic', 'Paid', 'Social', 'Email']
const REG = ['North', 'South', 'East', 'West']
const PRD = ['Widget', 'Gadget', 'Gizmo']
const mNum = (d: string) => Number(d.slice(5, 7))
const dom = (d: string) => Number(d.slice(8, 10))
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay()
const qOf = (d: string) => Math.ceil(mNum(d) / 3)
const ym = (d: string) => d.slice(0, 7)
const wbk = (d: string) => { const doy = Math.floor((Date.UTC(2024, mNum(d) - 1, dom(d)) - Date.UTC(2024, 0, 1)) / 86400000) + 1; return `2024-W${String(Math.floor((doy - 1) / 7) + 1).padStart(2, '0')}` }
const sumNN = (v: any[]): number | null => { const n = v.filter((x) => typeof x === 'number') as number[]; return n.length ? n.reduce((a, b) => a + b, 0) : null }
const avgNN = (v: any[]): number | null => { const n = v.filter((x) => typeof x === 'number') as number[]; return n.length ? r2(n.reduce((a, b) => a + b, 0) / n.length) : null }
const uniq = (rows: any[], k: string) => { const o: any[] = []; const seen = new Set(); for (const r of rows) { const v = r[k]; if (v == null || v === '') continue; if (!seen.has(String(v))) { seen.add(String(v)); o.push(v) } } return o }

interface Truth { cat: Array<string | number>; series: Record<string, Array<number | null>>; kind?: 'pie' | 'scatter' }

const CASES: Array<{ id: string; ds: string; prompt: string; truth: () => Truth }> = [
  { id: 'c01', ds: 'traffic', prompt: 'Smooth line chart of weekly total signups for the Organic and Social channels only, one line each, across the whole year.', truth: () => { const weeks = uniq(t.map((r) => ({ w: wbk(r.date) })).sort((a: any, b: any) => a.w < b.w ? -1 : 1), 'w'); return { cat: weeks, series: Object.fromEntries(['Organic', 'Social'].map((c) => [c, weeks.map((w) => sumNN(t.filter((r) => r.channel === c && wbk(r.date) === w).map((r) => r.signups)))])) } } },
  { id: 'c02', ds: 'sales', prompt: 'Total units by product for the West region, in March, June and September only, as a bar chart.', truth: () => ({ cat: PRD, series: { units: PRD.map((p) => sumNN(s.filter((r) => r.product === p && r.region === 'West' && ['Mar', 'Jun', 'Sep'].includes(r.month)).map((r) => r.units))) } }) },
  { id: 'c03', ds: 'traffic', prompt: 'Stacked area chart of daily visits broken down by channel, excluding Email, over the summer months.', truth: () => { const days = uniq(t.filter((r) => [6, 7, 8].includes(mNum(r.date))), 'date'); return { cat: days, series: Object.fromEntries(['Organic', 'Paid', 'Social'].map((c) => [c, days.map((d) => sumNN(t.filter((r) => r.channel === c && r.date === d).map((r) => r.visits)))])) } } },
  { id: 'c04', ds: 'sales', prompt: 'Share of total revenue by region for the Gizmo product only, as a pie chart.', truth: () => ({ kind: 'pie', cat: REG, series: { value: REG.map((rg) => sumNN(s.filter((r) => r.region === rg && r.product === 'Gizmo').map((r) => r.revenue))) } }) },
  { id: 'c05', ds: 'readings', prompt: 'Scatter of temperature versus humidity, one series per sensor, for readings after 2024-03-08.', truth: () => ({ kind: 'scatter', cat: [], series: Object.fromEntries(['Sensor A', 'Sensor B'].map((sn) => [sn, [rd.filter((r) => r.sensor === sn && r.date > '2024-03-08' && r.temperature != null && r.humidity != null).length]])) }) },
  { id: 'c06', ds: 'traffic', prompt: 'Grouped bar counting, for each channel, how many days its visits exceeded 1000 during the first quarter.', truth: () => ({ cat: CH, series: { count: CH.map((c) => t.filter((r) => r.channel === c && qOf(r.date) === 1 && (r.visits as number) > 1000).length) } }) },
  { id: 'c07', ds: 'traffic', prompt: 'Average signups by day of the week for the Paid channel, as a bar chart.', truth: () => ({ cat: DOW, series: { signups: DOW.map((_, i) => avgNN(t.filter((r) => r.channel === 'Paid' && dow(r.date) === i).map((r) => r.signups))) } }) },
  { id: 'c08', ds: 'traffic', prompt: 'How many days did each channel get more than 50 signups in the last quarter, as a bar chart?', truth: () => ({ cat: CH, series: { count: CH.map((c) => t.filter((r) => r.channel === c && qOf(r.date) === 4 && r.signups != null && (r.signups as number) > 50).length) } }) },
  { id: 'c09', ds: 'traffic', prompt: 'On a line chart with two separate y-axes, compare monthly total visits against monthly total signups for the Paid channel across the year.', truth: () => { const months = MONTHS.map((_, i) => `2024-${String(i + 1).padStart(2, '0')}`); return { cat: months, series: { visits: months.map((m) => sumNN(t.filter((r) => r.channel === 'Paid' && ym(r.date) === m).map((r) => r.visits))), signups: months.map((m) => sumNN(t.filter((r) => r.channel === 'Paid' && ym(r.date) === m).map((r) => r.signups))) } } } },
  { id: 'c10', ds: 'sales', prompt: 'Compare total units and total revenue per product as side-by-side bars.', truth: () => ({ cat: PRD, series: { units: PRD.map((p) => sumNN(s.filter((r) => r.product === p).map((r) => r.units))), revenue: PRD.map((p) => sumNN(s.filter((r) => r.product === p).map((r) => r.revenue))) } }) },
  { id: 'c11', ds: 'traffic', prompt: 'Monthly conversion rate — signups divided by visits — for each channel as separate lines, in the second half of the year.', truth: () => { const months = [7, 8, 9, 10, 11, 12].map((m) => `2024-${String(m).padStart(2, '0')}`); return { cat: months, series: Object.fromEntries(CH.map((c) => [c, months.map((m) => { const rows = t.filter((r) => r.channel === c && ym(r.date) === m); const sg = sumNN(rows.map((r) => r.signups)) ?? 0; const vs = sumNN(rows.map((r) => r.visits)) ?? 0; return vs ? sg / vs : null })])) } } },
  { id: 'c12', ds: 'traffic', prompt: 'Compare average visits on weekends versus weekdays, for the Organic and Email channels, as bars.', truth: () => ({ cat: ['Weekday', 'Weekend'], series: Object.fromEntries(['Organic', 'Email'].map((c) => [c, ['Weekday', 'Weekend'].map((b) => avgNN(t.filter((r) => r.channel === c && ((dow(r.date) === 0 || dow(r.date) === 6) === (b === 'Weekend'))).map((r) => r.visits)))])) }) },
  { id: 'c13', ds: 'traffic', prompt: 'Total signups by channel during the last week of December.', truth: () => ({ cat: CH, series: { signups: CH.map((c) => sumNN(t.filter((r) => r.channel === c && mNum(r.date) === 12 && dom(r.date) >= 25).map((r) => r.signups))) } }) },
  { id: 'c14', ds: 'traffic', prompt: 'Daily visits in the first 10 days of February for the Social channel as a line.', truth: () => { const days = uniq(t.filter((r) => mNum(r.date) === 2 && dom(r.date) <= 10), 'date'); return { cat: days, series: { visits: days.map((d) => sumNN(t.filter((r) => r.channel === 'Social' && r.date === d).map((r) => r.visits))) } } } },
  { id: 'c15', ds: 'readings', prompt: 'Temperature for both sensors as two lines, between 2024-03-04 and 2024-03-11, day by day.', truth: () => { const days = uniq(rd.filter((r) => r.date >= '2024-03-04' && r.date <= '2024-03-11'), 'date'); return { cat: days, series: Object.fromEntries(['Sensor A', 'Sensor B'].map((sn) => [sn, days.map((d) => sumNN(rd.filter((r) => r.sensor === sn && r.date === d).map((r) => r.temperature)))])) } } },
  { id: 'c16', ds: 'sales', prompt: 'The top 2 regions by total revenue, plotted month by month as two lines.', truth: () => { const rev = REG.map((rg) => [rg, sumNN(s.filter((r) => r.region === rg).map((r) => r.revenue)) as number] as const); const top2 = REG.filter((rg) => [...rev].sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]).includes(rg)); return { cat: MONTHS, series: Object.fromEntries(top2.map((rg) => [rg, MONTHS.map((m) => sumNN(s.filter((r) => r.region === rg && r.month === m).map((r) => r.revenue)))])) } } },
  { id: 'c17', ds: 'sales', prompt: "For the region that sells the most units overall, break that region's revenue down by product.", truth: () => { const u = REG.map((rg) => [rg, sumNN(s.filter((r) => r.region === rg).map((r) => r.units)) as number] as const); const win = [...u].sort((a, b) => b[1] - a[1])[0][0]; return { cat: PRD, series: { revenue: PRD.map((p) => sumNN(s.filter((r) => r.region === win && r.product === p).map((r) => r.revenue))) } } } },
  { id: 'c18', ds: 'sales', prompt: 'Horizontal bar ranking the four regions highest-to-lowest by total revenue, for the Gizmo product only.', truth: () => { const rev = REG.map((rg) => [rg, sumNN(s.filter((r) => r.region === rg && r.product === 'Gizmo').map((r) => r.revenue)) as number] as const); const ord = [...rev].sort((a, b) => b[1] - a[1]); return { cat: ord.map((e) => e[0]), series: { revenue: ord.map((e) => e[1]) } } } },
  { id: 'c19', ds: 'sales', prompt: 'Stacked bar of revenue by region for each month, for the Widget and Gadget products combined.', truth: () => ({ cat: MONTHS, series: Object.fromEntries(REG.map((rg) => [rg, MONTHS.map((m) => sumNN(s.filter((r) => r.region === rg && r.month === m && ['Widget', 'Gadget'].includes(r.product)).map((r) => r.revenue)))])) }) },
  { id: 'c20', ds: 'traffic', prompt: "As a step line, show the Email channel's daily signups over the last 60 days of data.", truth: () => { const allDays = uniq(t, 'date').sort(); const last60 = allDays.slice(-60); return { cat: last60, series: { signups: last60.map((d) => sumNN(t.filter((r) => r.channel === 'Email' && r.date === d).map((r) => r.signups))) } } } },
  { id: 'c21', ds: 'sales', prompt: 'Donut chart of total units by region for the Gadget product only.', truth: () => ({ kind: 'pie', cat: REG, series: { value: REG.map((rg) => sumNN(s.filter((r) => r.region === rg && r.product === 'Gadget').map((r) => r.units))) } }) },
  { id: 'c22', ds: 'sales', prompt: 'Nightingale rose chart of total units by product, for the North and South regions combined.', truth: () => ({ kind: 'pie', cat: PRD, series: { value: PRD.map((p) => sumNN(s.filter((r) => r.product === p && ['North', 'South'].includes(r.region)).map((r) => r.units))) } }) },
  { id: 'c23', ds: 'traffic', prompt: 'For every channel, show its single best day of signups, as a horizontal bar chart.', truth: () => ({ cat: CH, series: { signups: CH.map((c) => Math.max(...t.filter((r) => r.channel === c && r.signups != null).map((r) => r.signups as number))) } }) },
  { id: 'c24', ds: 'sales', prompt: "Each region's worst single month of revenue, as a bar chart.", truth: () => ({ cat: REG, series: { revenue: REG.map((rg) => Math.min(...MONTHS.map((m) => sumNN(s.filter((r) => r.region === rg && r.month === m).map((r) => r.revenue)) as number))) } }) },
  { id: 'c25', ds: 'traffic', prompt: 'The average monthly visits per channel — for each channel, the mean of its monthly totals, as a bar chart.', truth: () => ({ cat: CH, series: { visits: CH.map((c) => { const byM = new Map<string, number>(); for (const r of t.filter((r) => r.channel === c)) byM.set(ym(r.date), (byM.get(ym(r.date)) ?? 0) + (r.visits as number)); const v = [...byM.values()]; return r2(v.reduce((a, b) => a + b, 0) / v.length) }) } }) },
  { id: 'c26', ds: 'traffic', prompt: "In the month the Paid channel's signups peak, show every channel's total visits side by side.", truth: () => { const byM = new Map<number, number>(); for (const r of t.filter((r) => r.channel === 'Paid' && r.signups != null)) byM.set(mNum(r.date), (byM.get(mNum(r.date)) ?? 0) + (r.signups as number)); const win = [...byM.entries()].sort((a, b) => b[1] - a[1])[0][0]; return { cat: CH, series: { visits: CH.map((c) => sumNN(t.filter((r) => r.channel === c && mNum(r.date) === win).map((r) => r.visits))) } } } },
  { id: 'c27', ds: 'traffic', prompt: "On the single day Organic had its highest visits, plot each channel's signups as bars.", truth: () => { const win = t.filter((r) => r.channel === 'Organic').sort((a, b) => (b.visits as number) - (a.visits as number))[0].date; return { cat: CH, series: { signups: CH.map((c) => sumNN(t.filter((r) => r.channel === c && r.date === win).map((r) => r.signups))) } } } },
  { id: 'c28', ds: 'sales', prompt: "For the product with the highest total revenue, chart that product's units by region.", truth: () => { const rev = PRD.map((p) => [p, sumNN(s.filter((r) => r.product === p).map((r) => r.revenue)) as number] as const); const win = [...rev].sort((a, b) => b[1] - a[1])[0][0]; return { cat: REG, series: { units: REG.map((rg) => sumNN(s.filter((r) => r.product === win && r.region === rg).map((r) => r.units))) } } } },
  { id: 'c29', ds: 'traffic', prompt: 'Daily visits over time, one line per channel, for every channel except Email and Paid.', truth: () => { const days = uniq(t, 'date'); return { cat: days, series: Object.fromEntries(['Organic', 'Social'].map((c) => [c, days.map((d) => sumNN(t.filter((r) => r.channel === c && r.date === d).map((r) => r.visits)))])) } } },
  { id: 'c30', ds: 'traffic', prompt: "In the busiest single week of the year for total visits, show each channel's signups per day.", truth: () => { const totByDay = new Map<string, number>(); for (const r of t) totByDay.set(r.date, (totByDay.get(r.date) ?? 0) + (r.visits as number)); const byW = new Map<string, { sum: number; days: string[] }>(); for (const [d, v] of totByDay) { const w = wbk(d); const e = byW.get(w) ?? { sum: 0, days: [] }; e.sum += v; e.days.push(d); byW.set(w, e) } const win = [...byW.values()].sort((a, b) => b.sum - a.sum)[0]; const days = win.days.sort(); return { cat: days, series: Object.fromEntries(CH.map((c) => [c, days.map((d) => sumNN(t.filter((r) => r.channel === c && r.date === d).map((r) => r.signups)))])) } } },
  { id: 'c31', ds: 'sales', prompt: "Only the months where the North region's revenue beat 4000, charted as North's units those months.", truth: () => { const months = MONTHS.filter((m) => (sumNN(s.filter((r) => r.region === 'North' && r.month === m).map((r) => r.revenue)) as number) > 4000); return { cat: months, series: { units: months.map((m) => sumNN(s.filter((r) => r.region === 'North' && r.month === m).map((r) => r.units))) } } } },
]

function facts(o: any): { cat: any[]; series: Record<string, any[]>; kind?: string } {
  const s0 = (o.series ?? [])[0]
  if (s0?.type === 'pie') return { kind: 'pie', cat: (s0.data ?? []).map((d: any) => d.name), series: { value: (s0.data ?? []).map((d: any) => d.value) } }
  if (s0?.type === 'scatter') return { kind: 'scatter', cat: [], series: Object.fromEntries((o.series ?? []).map((sx: any) => [sx.name ?? 'value', [(sx.data ?? []).length]])) }
  const xa = Array.isArray(o.xAxis) ? o.xAxis[0] : o.xAxis
  const ya = Array.isArray(o.yAxis) ? o.yAxis[0] : o.yAxis
  const cat = Array.isArray(xa?.data) ? xa.data : Array.isArray(ya?.data) ? ya.data : []
  const series: Record<string, any[]> = {}
  for (const sx of o.series ?? []) series[sx.name ?? 'value'] = (sx.data ?? []).map((d: any) => (d && typeof d === 'object' ? d.value : d))
  return { cat, series }
}

function diff(truth: Truth, got: any): string[] {
  const e: string[] = []
  if (truth.kind !== 'scatter' && JSON.stringify(truth.cat.map(String)) !== JSON.stringify((got.cat ?? []).map(String))) e.push(`cat: want ${JSON.stringify(truth.cat)} got ${JSON.stringify(got.cat)}`)
  for (const [name, want] of Object.entries(truth.series)) {
    const g = got.series[name]
    if (!g) { e.push(`missing series "${name}" (have ${Object.keys(got.series)})`); continue }
    const wr = (want as any[]).map((v) => (typeof v === 'number' ? r2(v) : v))
    const gr = g.map((v: any) => (typeof v === 'number' ? r2(v) : v))
    if (JSON.stringify(wr) !== JSON.stringify(gr)) e.push(`series "${name}": want ${JSON.stringify(wr)} got ${JSON.stringify(gr)}`)
  }
  return e
}

test.skipIf(!LIVE)('VALUE AUDIT 31: chart numbers match independently-computed ground truth', async () => {
  const report: any[] = []
  const lines: string[] = []
  let ok = 0
  for (const c of CASES) {
    try {
      const r: any = await generateOption({ prompt: c.prompt, rows: rowsOf(c.ds) })
      if (r.status !== 'ok') { lines.push(`${c.id} PIPELINE-FAIL ${r.error}`); report.push({ id: c.id, status: 'fail' }); continue }
      const got = facts(r.option)
      const errs = diff(c.truth(), got)
      if (errs.length === 0) { ok++; lines.push(`${c.id} OK`) } else lines.push(`${c.id} MISMATCH :: ${errs.join('  ||  ')}`)
      report.push({ id: c.id, prompt: c.prompt, errs, raw: r.raw })
    } catch (e) { lines.push(`${c.id} THREW ${(e as Error).message}`); report.push({ id: c.id, status: 'threw' }) }
    await new Promise((res) => setTimeout(res, 900))
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))
  // eslint-disable-next-line no-console
  console.log(`\n=== VALUE AUDIT 31 ===\n${lines.join('\n')}\n=== ${ok}/${CASES.length} value-exact ===\n`)
  expect(report.length).toBe(CASES.length)
}, 590000)
