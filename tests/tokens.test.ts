import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeSchema, detokenizeSpec, tokenizeText } from '../src/tokens.ts'

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
