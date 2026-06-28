import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildChartOption } from '../src/chart'
import { checkOption } from '../src/validate'
import { datasets, summarizeData } from '../src/data'
import { generateOption } from '../src/ai'
import { buildTokens, tokenizeText, detokenizeSpec, redactLiterals } from '../src/tokens'
import type { ChartSpec, Row } from '../src/types'

const sales = datasets.find((d) => d.id === 'sales')!.rows
const readings = datasets.find((d) => d.id === 'readings')!.rows
const traffic = datasets.find((d) => d.id === 'traffic')!.rows

const single: Row[] = [{ k: 'A', v: 5 }]
const allNull: Row[] = [{ k: 'A', v: null }, { k: 'B', v: null }]
const numericX: Row[] = [{ yr: 2020, v: 1 }, { yr: 2021, v: 2 }, { yr: 2020, v: 3 }]
const mixed: Row[] = [{ k: 'a', m: 1 }, { k: 'b', m: 'x' }]
const negatives: Row[] = [{ k: 'a', v: -5 }, { k: 'b', v: 0 }, { k: 'c', v: 3 }]
const highCard: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: 'u' + i, v: i }))
const dense: Row[] = Array.from({ length: 40 }, (_, i) => ({ d: 'd' + i, v: i }))
const dated: Row[] = [
  { date: '2024-01-05', cat: 'A', v: 10 },
  { date: '2024-01-20', cat: 'B', v: 20 },
  { date: '2024-02-03', cat: 'A', v: 5 },
  { date: '2024-03-15', cat: 'B', v: 7 },
]

type Want = 'render' | 'error'
interface Outcome { name: string; want: Want; got: Want; detail: string }
const results: Outcome[] = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scen(name: string, rows: Row[], spec: any, want: Want = 'render'): void {
  let got: Want
  let detail = ''
  try {
    const opt = buildChartOption(spec as ChartSpec, rows)
    const c = checkOption(opt)
    if (c.ok) {
      got = 'render'
      detail = `${((opt as { series: unknown[] }).series ?? []).length} series`
    } else {
      got = 'error'
      detail = c.error
    }
  } catch (e) {
    got = 'error'
    detail = (e as Error).message
  }
  results.push({ name, want, got, detail })
}

for (const ct of ['line', 'bar', 'area'] as const)
  for (const agg of ['sum', 'avg', 'min', 'max', 'count', 'none'] as const)
    scen(`${ct}/${agg} region→units`, sales, { chartType: ct, x: 'region', measure: 'units', aggregate: agg })

for (const ct of ['line', 'bar', 'area'] as const)
  for (const agg of ['sum', 'none'] as const)
    scen(`${ct}/${agg} grouped month×region→revenue`, sales, { chartType: ct, x: 'month', series: 'region', measure: 'revenue', aggregate: agg })

for (const agg of ['sum', 'avg', 'count', 'min', 'max'] as const)
  scen(`pie/${agg} region→units`, sales, { chartType: 'pie', x: 'region', measure: 'units', aggregate: agg })
scen('pie with negatives/zeros filtered out', negatives, { chartType: 'pie', x: 'k', measure: 'v', aggregate: 'sum' })
scen('pie all non-positive → empty but renders', allNull, { chartType: 'pie', x: 'k', measure: 'v', aggregate: 'sum' })

scen('scatter units→revenue', sales, { chartType: 'scatter', x: 'units', measure: 'revenue', aggregate: 'none' })
scen('scatter grouped by region', sales, { chartType: 'scatter', x: 'units', measure: 'revenue', series: 'region', aggregate: 'none' })
scen('scatter readings temp→humidity (nulls dropped)', readings, { chartType: 'scatter', x: 'temperature', measure: 'humidity', aggregate: 'none' })

scen('measures[1] single y', sales, { chartType: 'bar', x: 'region', measures: ['units'], aggregate: 'sum' })
scen('measures[2] dual y', sales, { chartType: 'bar', x: 'region', measures: ['units', 'revenue'], aggregate: 'sum' })
scen('measures[3] shared y', sales, { chartType: 'line', x: 'month', measures: ['units', 'revenue', 'units'], aggregate: 'sum' })
scen('series + measures cross (bar, 6 series)', sales, { chartType: 'bar', x: 'month', series: 'product', measures: ['units', 'revenue'], aggregate: 'sum' })
scen('series + measures cross (line, dual axis)', sales, { chartType: 'line', x: 'month', series: 'product', measures: ['units', 'revenue'], aggregate: 'sum' })

scen('derived conv by channel', traffic, { chartType: 'bar', x: 'channel', aggregate: 'sum', derived: { name: 'conv', numerator: 'signups', denominator: 'visits' } })
scen('derived grouped date×channel', traffic, { chartType: 'line', x: 'date', series: 'channel', aggregate: 'sum', derived: { name: 'conv', numerator: 'signups', denominator: 'visits' } })
scen('derived + bucket month', traffic, { chartType: 'line', x: 'date', aggregate: 'sum', bucket: 'month', derived: { name: 'conv', numerator: 'signups', denominator: 'visits' } })

scen('filter value North', sales, { chartType: 'bar', x: 'product', measure: 'units', aggregate: 'sum', filter: { column: 'region', in: ['North'] } })
scen('filter value ci "north"', sales, { chartType: 'bar', x: 'product', measure: 'units', aggregate: 'sum', filter: { column: 'region', in: ['north'] } })
scen('filter substring "Org"', traffic, { chartType: 'bar', x: 'date', measure: 'visits', aggregate: 'sum', filter: { column: 'channel', in: ['Org'] } })
for (const [dp, vals] of [['day', [10]], ['weekday', [6]], ['month', [1]], ['quarter', [1]]] as const)
  scen(`filter datePart ${dp}`, traffic, { chartType: 'line', x: 'date', measure: 'visits', aggregate: 'sum', filter: { column: 'date', datePart: dp, in: vals } })
scen('filter no match → error by default', sales, { chartType: 'bar', x: 'region', measure: 'units', aggregate: 'sum', filter: { column: 'region', in: ['Atlantis'] } }, 'error')
scen('filter empty in → ignored', sales, { chartType: 'bar', x: 'region', measure: 'units', aggregate: 'sum', filter: { column: 'region', in: [] } })

for (const b of ['week', 'month', 'quarter', 'year'] as const)
  scen(`bucket ${b}`, traffic, { chartType: 'bar', x: 'date', measure: 'visits', aggregate: 'sum', bucket: b })
scen('bucket ignored under day filter', dated, { chartType: 'bar', x: 'date', measure: 'v', aggregate: 'sum', bucket: 'month', filter: { column: 'date', datePart: 'day', in: [5] } })

scen('top-N value desc limit', sales, { chartType: 'bar', x: 'product', measure: 'units', aggregate: 'sum', sort: 'value', order: 'desc', limit: 2 })
scen('value asc', sales, { chartType: 'bar', x: 'product', measure: 'units', aggregate: 'sum', sort: 'value', order: 'asc' })
scen('order desc no sort', sales, { chartType: 'line', x: 'month', measure: 'revenue', aggregate: 'sum', order: 'desc' })
scen('date axis stays chronological (sort, no limit)', traffic, { chartType: 'line', x: 'date', measure: 'visits', aggregate: 'sum', sort: 'value', order: 'desc' })
scen('date axis top-N (sort + limit)', traffic, { chartType: 'bar', x: 'date', measure: 'visits', aggregate: 'sum', sort: 'value', order: 'desc', limit: 5 })
scen('limit larger than category count', sales, { chartType: 'bar', x: 'region', measure: 'units', aggregate: 'sum', sort: 'value', limit: 99 })

scen('single row', single, { chartType: 'bar', x: 'k', measure: 'v', aggregate: 'sum' })
scen('all-null measure → null series', allNull, { chartType: 'line', x: 'k', measure: 'v', aggregate: 'sum' })
scen('numeric x column', numericX, { chartType: 'bar', x: 'yr', measure: 'v', aggregate: 'sum' })
scen('mixed-type measure → null series', mixed, { chartType: 'bar', x: 'k', measure: 'm', aggregate: 'sum' })
scen('high-cardinality bar (120)', highCard, { chartType: 'bar', x: 'id', measure: 'v', aggregate: 'sum' })
scen('high-cardinality pie (120)', highCard, { chartType: 'pie', x: 'id', measure: 'v', aggregate: 'sum' })
scen('dense line (40) hides symbols', dense, { chartType: 'line', x: 'd', measure: 'v', aggregate: 'sum' })

scen('traffic 365 daily line', traffic, { chartType: 'line', x: 'date', measure: 'signups', aggregate: 'sum' })
scen('traffic 4×365 grouped', traffic, { chartType: 'line', x: 'date', series: 'channel', measure: 'signups', aggregate: 'none' })
scen('readings temp by sensor (nulls)', readings, { chartType: 'line', x: 'date', series: 'sensor', measure: 'temperature', aggregate: 'none' })

scen('unknown x → error', sales, { chartType: 'bar', x: 'nope', measure: 'units', aggregate: 'sum' }, 'error')
scen('unknown measure → error', sales, { chartType: 'bar', x: 'region', measure: 'nope', aggregate: 'sum' }, 'error')
scen('unknown series → error', sales, { chartType: 'line', x: 'month', series: 'ghost', measure: 'units', aggregate: 'none' }, 'error')
scen('unknown filter column → error', sales, { chartType: 'bar', x: 'region', measure: 'units', aggregate: 'sum', filter: { column: 'nope', in: ['x'] } }, 'error')
scen('unknown derived denominator → error', traffic, { chartType: 'bar', x: 'channel', aggregate: 'sum', derived: { name: 'r', numerator: 'signups', denominator: 'nope' } }, 'error')
scen('measures with unknown col → error', sales, { chartType: 'bar', x: 'region', measures: ['units', 'nope'], aggregate: 'sum' }, 'error')
scen('missing measure → error', sales, { chartType: 'bar', x: 'region', aggregate: 'sum' }, 'error')
scen('empty dataset → error', [], { chartType: 'bar', x: 'a', measure: 'b', aggregate: 'sum' }, 'error')

test('CHART SCENARIO MATRIX — every spec renders or errors exactly as expected', () => {
  const lines = results.map((r) => `${r.got === r.want ? 'PASS' : 'FAIL'}  [want:${r.want} got:${r.got}]  ${r.name}  ::  ${r.detail}`)
  const fails = results.filter((r) => r.got !== r.want)
  // eslint-disable-next-line no-console
  console.log(`\n=== CHART SCENARIO MATRIX (${results.length} scenarios) ===\n${lines.join('\n')}\n=== ${results.length - fails.length}/${results.length} as expected, ${fails.length} unexpected ===\n`)
  expect(fails).toEqual([])
})

test('PRIVACY ROUND-TRIP — no real column name or category value leaves in the prompt', () => {
  const wholeWord = (s: string) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const probes = [
    { rows: sales, prompts: ['monthly revenue by region', 'top 3 products by units', 'revenue for North only', 'units by product as a pie', 'regions compared by revenue'] },
    { rows: traffic, prompts: ['daily signups by channel', 'conversion rate of signups over visits', 'visits for Organic on weekdays', 'channels by total visits'] },
    { rows: readings, prompts: ['temperature by sensor over date', 'humidity for Sensor A', 'average temperature per sensor'] },
  ]
  const leaks: string[] = []
  for (const { rows, prompts } of probes) {
    const summary = summarizeData(rows)
    const { toReal } = buildTokens(summary, rows)
    const names = summary.columns.map((c) => c.name)
    const catValues = [...new Set(rows.flatMap((r) => summary.columns.filter((c) => c.type === 'categorical').map((c) => r[c.name]).filter((v): v is string => typeof v === 'string')))]
    for (const p of prompts) {
      const masked = redactLiterals(tokenizeText(p, toReal), toReal)
      for (const n of names) if (wholeWord(n).test(masked)) leaks.push(`name "${n}" survived in: "${p}" → "${masked}"`)
      for (const v of catValues) if (wholeWord(v).test(masked)) leaks.push(`value "${v}" survived in: "${p}" → "${masked}"`)
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\n=== PRIVACY ROUND-TRIP === ${leaks.length === 0 ? 'no leaks across all probes' : leaks.join('\n')}\n`)
  expect(leaks).toEqual([])
})

test('DETOKENIZE COVERAGE — every identifier-bearing field comes back real', () => {
  const summary = summarizeData(sales)
  const { toReal } = buildTokens(summary, sales)
  const tok = (real: string) => Object.keys(toReal).find((k) => toReal[k] === real) as string
  const spec = detokenizeSpec(
    {
      chartType: 'bar',
      x: tok('month'),
      measure: tok('revenue'),
      measures: [tok('units'), tok('revenue')],
      series: tok('region'),
      aggregate: 'sum',
      filter: { column: tok('region'), in: [tok('North')] },
      derived: { name: `${tok('units')} per ${tok('revenue')}`, numerator: tok('units'), denominator: tok('revenue') },
      title: `${tok('revenue')} by ${tok('month')}`,
    } as ChartSpec,
    toReal,
  )
  expect(spec.x).toBe('month')
  expect(spec.measure).toBe('revenue')
  expect(spec.measures).toEqual(['units', 'revenue'])
  expect(spec.series).toBe('region')
  expect(spec.filter!.column).toBe('region')
  expect(spec.filter!.in).toEqual(['North'])
  expect(spec.derived!.numerator).toBe('units')
  expect(spec.derived!.denominator).toBe('revenue')
  expect(spec.derived!.name).toBe('units per revenue')
  expect(spec.title).toBe('revenue by month')
})

function claudeReturning(spec: object) {
  const text = JSON.stringify(spec)
  return { ok: true, status: 200, text: async () => text, json: async () => ({ content: [{ type: 'text', text }] }) }
}

beforeEach(() => vi.stubEnv('VITE_CLAUDE_API_KEY', 'test-key'))
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

test('FULL PIPELINE — model answers in tokens, app renders real charts for every type', async () => {
  const summary = summarizeData(sales)
  const { toReal } = buildTokens(summary, sales)
  const tok = (real: string) => Object.keys(toReal).find((k) => toReal[k] === real) as string

  const tokenSpecs: Array<{ name: string; spec: object }> = [
    { name: 'line', spec: { chartType: 'line', x: tok('month'), series: tok('region'), measure: tok('revenue'), aggregate: 'sum' } },
    { name: 'bar', spec: { chartType: 'bar', x: tok('region'), measure: tok('units'), aggregate: 'sum' } },
    { name: 'pie', spec: { chartType: 'pie', x: tok('region'), measure: tok('units'), aggregate: 'sum' } },
    { name: 'scatter', spec: { chartType: 'scatter', x: tok('units'), measure: tok('revenue'), aggregate: 'none' } },
    { name: 'derived', spec: { chartType: 'bar', x: tok('region'), aggregate: 'sum', derived: { name: 'r', numerator: tok('units'), denominator: tok('revenue') } } },
  ]
  const outcomes: string[] = []
  for (const { name, spec } of tokenSpecs) {
    vi.stubGlobal('fetch', vi.fn(async () => claudeReturning(spec)))
    const r = await generateOption({ prompt: 'chart it', rows: sales })
    outcomes.push(`${name}: ${r.status}`)
    expect(r.status).toBe('ok')
  }
  // eslint-disable-next-line no-console
  console.log(`\n=== FULL PIPELINE === ${outcomes.join(' | ')}\n`)
})
