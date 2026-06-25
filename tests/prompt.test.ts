import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT, buildSpecMessage, buildRepairMessage } from '../src/prompt.ts'

const summary = {
  rowCount: 144,
  columns: [
    { name: 'month', type: 'categorical', cardinality: 12, nullCount: 0, sampleValues: ['Jan', 'Feb'] },
    { name: 'revenue', type: 'number', cardinality: 100, nullCount: 3, sampleValues: [], min: 100, max: 9000 },
  ],
  sampleRows: [],
}

test('buildSpecMessage includes prompt, row count, columns, ranges, and missing counts', () => {
  const m = buildSpecMessage('total revenue by month', summary)
  assert.ok(m.includes('Request: total revenue by month'))
  assert.ok(m.includes('144 rows'))
  assert.ok(m.includes('month (categorical'))
  assert.ok(m.includes('revenue (number'))
  assert.ok(m.includes('range 100..9000'))
  assert.ok(m.includes('3 missing'))
})

test('buildRepairMessage carries the exact error and truncates long raw', () => {
  const m = buildRepairMessage('x'.repeat(5000), 'Spec refers to unknown column "foo"')
  assert.ok(m.includes('Spec refers to unknown column "foo"'))
  assert.ok(m.includes('corrected chart spec'))
  assert.ok(m.length < 4000)
})

test('SYSTEM_PROMPT lists every chart type and demands JSON only', () => {
  for (const t of ['line', 'bar', 'area', 'pie', 'scatter']) assert.ok(SYSTEM_PROMPT.includes(t), t)
  assert.ok(/JSON/.test(SYSTEM_PROMPT))
  assert.ok(/no code fences/.test(SYSTEM_PROMPT))
})
