import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeSchema, detokenizeSpec, tokenizeText, buildTokens, redactLiterals } from '../src/tokens.ts'

const summary = {
  rowCount: 5,
  columns: [
    { name: 'month', type: 'categorical', cardinality: 12, nullCount: 0 },
    { name: 'revenue', type: 'number', cardinality: 100, nullCount: 3 },
  ],
}

test('tokenizeSchema renames columns to col_N, keeps stats, maps back, hides real names', () => {
  const { summary: t, toReal } = tokenizeSchema(summary)
  assert.deepEqual(t.columns.map((c) => c.name), ['col_0', 'col_1'])
  assert.equal(t.columns[0].cardinality, 12)
  assert.equal(t.columns[1].type, 'number')
  assert.equal(t.rowCount, 5)
  assert.deepEqual(toReal, { col_0: 'month', col_1: 'revenue' })
  assert.ok(!JSON.stringify(t).includes('revenue') && !JSON.stringify(t).includes('month'))
})

test('detokenizeSpec maps every column-bearing field back; user filter value untouched', () => {
  const { toReal } = tokenizeSchema(summary)
  const spec = detokenizeSpec(
    { chartType: 'bar', x: 'col_0', measure: 'col_1', aggregate: 'sum', series: 'col_0', filter: { column: 'col_0', in: ['Jan'] } },
    toReal,
  )
  assert.equal(spec.x, 'month')
  assert.equal(spec.measure, 'revenue')
  assert.equal(spec.series, 'month')
  assert.equal(spec.filter.column, 'month')
  assert.deepEqual(spec.filter.in, ['Jan'])
})

test('detokenizeSpec maps a filters[] list — every column and value back to real', () => {
  const spec = detokenizeSpec(
    { chartType: 'bar', x: 'col_0', measure: 'col_1', aggregate: 'sum', filters: [{ column: 'col_2', in: ['val_3'] }, { column: 'col_0', datePart: 'month', in: [1] }] },
    { col_0: 'date', col_1: 'visits', col_2: 'channel', val_3: 'Organic' },
  )
  assert.equal(spec.filters[0].column, 'channel')
  assert.deepEqual(spec.filters[0].in, ['Organic'])
  assert.equal(spec.filters[1].column, 'date')
  assert.deepEqual(spec.filters[1].in, [1]) // numeric date-part value passes through
})

test('detokenizeSpec maps measures[] and derived numerator/denominator', () => {
  const { toReal } = tokenizeSchema(summary)
  const spec = detokenizeSpec(
    { chartType: 'line', x: 'col_0', measure: 'col_1', aggregate: 'sum', measures: ['col_0', 'col_1'], derived: { name: 'r', numerator: 'col_1', denominator: 'col_0' } },
    toReal,
  )
  assert.deepEqual(spec.measures, ['month', 'revenue'])
  assert.equal(spec.derived.numerator, 'revenue')
  assert.equal(spec.derived.denominator, 'month')
})

test('detokenizeSpec is permissive: unknown ids and real names pass through', () => {
  const spec = detokenizeSpec({ chartType: 'bar', x: 'month', measure: 'col_9', aggregate: 'sum' }, { col_0: 'month' })
  assert.equal(spec.x, 'month')
  assert.equal(spec.measure, 'col_9')
})

test('tokenizeText hides real names in an error string, longest name first', () => {
  const out = tokenizeText('unknown column "revenue" and "rev"', { col_0: 'rev', col_1: 'revenue' })
  assert.equal(out, 'unknown column "col_1" and "col_0"')
})

const rows = [
  { region: 'North', revenue: 100 },
  { region: 'South', revenue: 200 },
]
const sales = {
  rowCount: 2,
  columns: [
    { name: 'region', type: 'categorical' as const, cardinality: 2, nullCount: 0 },
    { name: 'revenue', type: 'number' as const, cardinality: 2, nullCount: 0 },
  ],
}

test('buildTokens tokenizes column names and categorical values, not numbers', () => {
  const { summary, toReal } = buildTokens(sales, rows)
  assert.deepEqual(summary.columns.map((c) => c.name), ['col_0', 'col_1'])
  const reals = Object.values(toReal)
  assert.ok(reals.includes('region') && reals.includes('revenue'))
  assert.ok(reals.includes('North') && reals.includes('South'))
  // every key is an opaque token; no real string leaks as a key
  assert.ok(Object.keys(toReal).every((k) => /^(col|val)_\d+$/.test(k)))
})

test('tokenizeText masks values case-insensitively (matching how the app filters)', () => {
  const { toReal } = buildTokens(sales, rows)
  for (const variant of ['North', 'north', 'NORTH']) {
    assert.ok(!/north/i.test(tokenizeText(`show me ${variant} sales`, toReal)), variant)
  }
})

test('VALUES match exactly: a longer word that merely contains a value is left intact', () => {
  const { toReal } = buildTokens(sales, rows)
  // value 'North' inside 'Northwest' must NOT be half-masked (would leak "west")
  assert.ok(tokenizeText('the Northwest area', toReal).includes('Northwest'))
})

test('COLUMN NAMES match morphological variants, mapped cleanly to the whole word', () => {
  const { toReal } = buildTokens(sales, rows) // region -> col_0, revenue -> col_1
  // 'regions' refers to the region column; maps to the whole token, no leftover fragment
  assert.equal(tokenizeText('compare regions', toReal), 'compare col_0')
})

test('morphological matching is bounded: it does not capture unrelated prose words', () => {
  const cols = (names: string[]) => Object.fromEntries(names.map((n, i) => [`col_${i}`, n]))
  const salesCols = cols(['month', 'region', 'product', 'units', 'revenue'])
  assert.equal(tokenizeText('forecast production volume', salesCols), 'forecast production volume') // product ≠ production
  const aggCols = cols(['count', 'sum', 'order', 'rate'])
  // the aggregate/ordering words prompt.ts tells users to type are NOT swallowed
  assert.equal(tokenizeText('show a summary of the country by ordering', aggCols), 'show a summary of the country by ordering')
  // legitimate inflections still map cleanly
  assert.equal(tokenizeText('compare products monthly', cols(['product', 'month'])), 'compare col_0 col_1')
})

test('a value does not match inside an accented word (unicode word boundary)', () => {
  assert.equal(tokenizeText('we met Anné today', { val_0: 'Ann' }), 'we met Anné today')
})

test('redactLiterals masks comma-grouped, decimal and separator-formatted numbers whole', () => {
  const run = (s: string) => redactLiterals(s, {})
  assert.ok(!/1,234,567/.test(run('salary 1,234,567 yearly')))
  assert.ok(!/1234\.56/.test(run('amount 1234.56 total')))
  assert.ok(!/3\.14/.test(run('ratio 3.14 here')))
  const phone = run('call 555-123-4567 now')
  assert.ok(!/555/.test(phone) && !/123/.test(phone) && !/4567/.test(phone)) // no group leaks
  // small control numbers still pass through (top-N, date parts)
  assert.ok(/top 5/.test(run('top 5')) && /day 15/.test(run('day 15')))
})

test('a "monthly" reference resolves to the month column so the model picks the right x-axis', () => {
  const schema = {
    rowCount: 1,
    columns: [
      { name: 'month', type: 'categorical' as const, cardinality: 12, nullCount: 0 },
      { name: 'region', type: 'categorical' as const, cardinality: 4, nullCount: 0 },
      { name: 'revenue', type: 'number' as const, cardinality: 100, nullCount: 0 },
    ],
  }
  const { toReal } = buildTokens(schema, [{ month: 'Jan', region: 'North', revenue: 10 }])
  // month -> col_0, region -> col_1, revenue -> col_2
  assert.equal(tokenizeText('monthly revenue by region', toReal), 'col_0 col_2 by col_1')
})

test('buildTokens masks values in HIGH-cardinality columns (where identifiers live)', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ customer: `Acme_${i}` }))
  const schema = { rowCount: 60, columns: [{ name: 'customer', type: 'categorical' as const, cardinality: 60, nullCount: 0 }] }
  const { toReal } = buildTokens(schema, many)
  assert.ok(Object.values(toReal).includes('Acme_42'))
  assert.ok(!/Acme_42/.test(tokenizeText('chart for Acme_42 only', toReal)))
})

test('buildTokens masks EVERY categorical value, including word-like ISO codes (privacy over prose)', () => {
  const codes = [{ code: 'NY' }, { code: 'ON' }, { code: 'IN' }, { code: 'No' }, { code: 'A' }]
  const schema = { rowCount: 5, columns: [{ name: 'code', type: 'categorical' as const, cardinality: 5, nullCount: 0 }] }
  const { toReal } = buildTokens(schema, codes)
  // values that collide with English stopwords used to leak verbatim — now they don't
  for (const c of ['NY', 'ON', 'IN', 'No', 'A']) assert.ok(Object.values(toReal).includes(c), c)
  assert.ok(!/\bON\b/i.test(tokenizeText('revenue for ON only', toReal)))
})

test('detokenizeText drops a stray out-of-range token instead of rendering it', () => {
  const spec = detokenizeSpec({ chartType: 'bar', x: 'col_0', measure: 'col_1', aggregate: 'sum', title: 'col_0 vs col_99 trend' }, { col_0: 'month', col_1: 'revenue' })
  assert.equal(spec.title, 'month vs trend')
})

test('redactLiterals masks ISO dates and 4+ digit numbers but keeps small control numbers', () => {
  const toReal: Record<string, string> = {}
  const out = redactLiterals('top 5 days over 99999 since 2024-01-15, the 10th', toReal)
  assert.ok(/top 5 /.test(out)) // top-N kept
  assert.ok(/the 10th/.test(out)) // day part kept
  assert.ok(!out.includes('99999')) // precise amount masked
  assert.ok(!out.includes('2024-01-15')) // exact date masked
  // and they round-trip back to the real literal for filtering
  assert.ok(Object.values(toReal).includes('99999'))
  assert.ok(Object.values(toReal).includes('2024-01-15'))
})

test('redactLiterals leaves existing col_/val_ tokens untouched', () => {
  const toReal: Record<string, string> = { col_0: 'region', val_1234: 'Acme' }
  assert.equal(redactLiterals('chart col_0 with val_1234', toReal), 'chart col_0 with val_1234')
})

test('redactLiterals masks emails and links whole, round-tripping the real value', () => {
  const toReal: Record<string, string> = {}
  const out = redactLiterals('mail jane@acme.com and see https://acme.com/report?id=42', toReal)
  assert.ok(!/jane@acme\.com/.test(out))
  assert.ok(!/acme\.com/.test(out))
  assert.ok(!out.includes('https://'))
  assert.ok(Object.values(toReal).includes('jane@acme.com'))
})

test('redactLiterals masks a www link and an email containing digits', () => {
  const toReal: Record<string, string> = {}
  const out = redactLiterals('visit www.site.io/x and mail bob1234@x.org', toReal)
  assert.ok(!out.includes('www.site.io/x'))
  assert.ok(!out.includes('bob1234@x.org'))
})

test('a redacted literal echoed back as a filter value detokenizes to the real value', () => {
  const toReal: Record<string, string> = { col_0: 'date' }
  redactLiterals('only 2024-01-15', toReal) // assigns lit_0 -> '2024-01-15'
  const spec = detokenizeSpec({ chartType: 'bar', x: 'col_0', measure: 'col_0', aggregate: 'count', filter: { column: 'col_0', in: ['lit_0'] } }, toReal)
  assert.deepEqual(spec.filter.in, ['2024-01-15'])
})

test('a redacted numeric threshold (4+ digits) round-trips to a number for op comparison', () => {
  const toReal: Record<string, string> = { col_0: 'visits' }
  redactLiterals('visits over 6050', toReal) // 6050 -> lit_0
  const lit = Object.keys(toReal).find((k) => k.startsWith('lit_')) as string
  const spec = detokenizeSpec({ chartType: 'bar', x: 'col_0', measure: 'col_0', aggregate: 'count', filter: { column: 'col_0', op: '>', value: lit as unknown as number } }, toReal)
  assert.equal(spec.filter.value, 6050)
})

test('round-trip: a real prompt tokenizes away, and the returned spec maps fully back', () => {
  const { toReal } = buildTokens(sales, rows)
  const tokenOf = (real: string) => Object.keys(toReal).find((k) => toReal[k] === real) as string

  const safePrompt = tokenizeText('revenue by region in North', toReal)
  assert.ok(!/revenue|region|North/.test(safePrompt))

  // the model answers in tokens — including filter values and the title
  const spec = detokenizeSpec(
    {
      chartType: 'bar',
      x: tokenOf('region'),
      measure: tokenOf('revenue'),
      aggregate: 'sum',
      filter: { column: tokenOf('region'), in: [tokenOf('North')] },
      title: `${tokenOf('revenue')} by ${tokenOf('region')}`,
    },
    toReal,
  )
  assert.equal(spec.x, 'region')
  assert.equal(spec.measure, 'revenue')
  assert.equal(spec.filter.column, 'region')
  assert.deepEqual(spec.filter.in, ['North'])
  assert.equal(spec.title, 'revenue by region')
})
