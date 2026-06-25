import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeData, datasets } from '../src/data.ts'

const col = (s, n) => s.columns.find((c) => c.name === n)

test('numeric column with a null stays number; min/max over present only', () => {
  const s = summarizeData([{ a: 1 }, { a: 2 }, { a: null }, { a: 4 }])
  assert.equal(col(s, 'a').type, 'number')
  assert.equal(col(s, 'a').nullCount, 1)
  assert.equal(col(s, 'a').min, 1)
  assert.equal(col(s, 'a').max, 4)
})

test("empty string counts as missing", () => {
  const s = summarizeData([{ a: 'x' }, { a: '' }, { a: 'y' }])
  assert.equal(col(s, 'a').nullCount, 1)
  assert.equal(col(s, 'a').type, 'categorical')
})

test('all-null column -> categorical, cardinality 0, no min/max', () => {
  const z = summarizeData([{ z: null }, { z: null }]).columns[0]
  assert.equal(z.type, 'categorical')
  assert.equal(z.cardinality, 0)
  assert.equal(z.nullCount, 2)
  assert.equal(z.min, undefined)
})

test('categorical cardinality + first sampleValues', () => {
  const s = summarizeData([{ c: 'a' }, { c: 'b' }, { c: 'a' }, { c: 'c' }])
  assert.equal(col(s, 'c').type, 'categorical')
  assert.equal(col(s, 'c').cardinality, 3)
  assert.deepEqual(col(s, 'c').sampleValues, ['a', 'b', 'c'])
})

test('rowCount and sampleRows capped at 5', () => {
  const s = summarizeData(Array.from({ length: 8 }, (_, i) => ({ a: i })))
  assert.equal(s.rowCount, 8)
  assert.equal(s.sampleRows.length, 5)
})

test('empty rows produce no columns', () => {
  const s = summarizeData([])
  assert.equal(s.rowCount, 0)
  assert.deepEqual(s.columns, [])
})

test('datasets: known sizes and deterministic first sales row', () => {
  const sales = datasets.find((d) => d.id === 'sales')
  const readings = datasets.find((d) => d.id === 'readings')
  const traffic = datasets.find((d) => d.id === 'traffic')
  assert.equal(sales.rows.length, 144)
  assert.equal(readings.rows.length, 28)
  assert.equal(traffic.rows.length, 1460)
  assert.deepEqual(sales.rows[0], { month: 'Jan', region: 'North', product: 'Widget', units: 96, revenue: 2400 })
})

test('traffic signups: 113 nulls but profiles as number', () => {
  const s = summarizeData(datasets.find((d) => d.id === 'traffic').rows)
  assert.equal(col(s, 'signups').type, 'number')
  assert.equal(col(s, 'signups').nullCount, 113)
})

test('sales has no nulls; readings has nulls in temperature/humidity', () => {
  const sales = summarizeData(datasets.find((d) => d.id === 'sales').rows)
  assert.ok(sales.columns.every((c) => c.nullCount === 0))
  const readings = summarizeData(datasets.find((d) => d.id === 'readings').rows)
  assert.ok(col(readings, 'temperature').nullCount > 0)
  assert.equal(col(readings, 'temperature').type, 'number')
})

test('mixed-type column (strings + numbers) profiles as categorical', () => {
  const s = summarizeData([{ a: 1 }, { a: 'x' }, { a: 3 }])
  assert.equal(col(s, 'a').type, 'categorical')
})

test('sampleValues capped at 6 distinct', () => {
  const s = summarizeData(Array.from({ length: 10 }, (_, i) => ({ c: 'v' + i })))
  assert.equal(col(s, 'c').sampleValues.length, 6)
})

test('zero is present, not missing', () => {
  const s = summarizeData([{ a: 0 }, { a: 5 }, { a: null }])
  assert.equal(col(s, 'a').type, 'number')
  assert.equal(col(s, 'a').nullCount, 1)
  assert.equal(col(s, 'a').min, 0)
})
