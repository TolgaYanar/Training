import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT, buildSpecMessage, buildRepairMessage } from '../src/prompt.ts'

const summary = {
  rowCount: 144,
  columns: [
    { name: 'month', type: 'categorical', cardinality: 12, nullCount: 0 },
    { name: 'revenue', type: 'number', cardinality: 100, nullCount: 3 },
  ],
}

test('buildSpecMessage includes prompt and columns but no exact counts or data values', () => {
  const m = buildSpecMessage('total revenue by month', summary)
  assert.ok(m.includes('Request: total revenue by month'))
  assert.ok(m.includes('month (categorical'))
  assert.ok(m.includes('revenue (number'))
  assert.ok(/some missing/.test(m))
  assert.ok(!m.includes('144'))
  assert.ok(!m.includes('12 distinct'))
  assert.ok(!m.includes('3 missing'))
  assert.ok(!/range|e\.g\.|Jan|9000/.test(m))
})

test('SYSTEM_PROMPT states the model never sees the data', () => {
  assert.ok(/never see the data/i.test(SYSTEM_PROMPT))
})

test('buildRepairMessage carries the exact error and truncates long raw', () => {
  const m = buildRepairMessage('x'.repeat(5000), 'Spec refers to unknown column "foo"')
  assert.ok(m.includes('Spec refers to unknown column "foo"'))
  assert.ok(m.includes('corrected chart spec'))
  assert.ok(m.length < 4000)
})

test('SYSTEM_PROMPT explains that a month name maps to a datePart month filter', () => {
  assert.ok(/month NAME or abbreviation/i.test(SYSTEM_PROMPT))
  assert.ok(/January\/Jan=1/.test(SYSTEM_PROMPT))
  assert.ok(/datePart/.test(SYSTEM_PROMPT))
})

test('SYSTEM_PROMPT lists every chart type and demands JSON only', () => {
  for (const t of ['line', 'bar', 'area', 'pie', 'scatter']) assert.ok(SYSTEM_PROMPT.includes(t), t)
  assert.ok(/JSON/.test(SYSTEM_PROMPT))
  assert.ok(/no code fences/.test(SYSTEM_PROMPT))
})
