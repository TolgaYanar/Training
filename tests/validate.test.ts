import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractJson, validateSpec } from '../src/validate.ts'

test('plain json is unchanged', () => {
  assert.equal(extractJson('{"a":1}'), '{"a":1}')
})

test('strips ```json fences', () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}')
})

test('strips bare ``` fences', () => {
  assert.equal(extractJson('```\n{"a":1}\n```'), '{"a":1}')
})

test('slices the object out of surrounding prose', () => {
  assert.equal(extractJson('Here you go: {"a":1} thanks'), '{"a":1}')
})

test('trims surrounding whitespace', () => {
  assert.equal(extractJson('   {"a":1}   '), '{"a":1}')
})

test('keeps nested braces intact', () => {
  assert.equal(extractJson('{"a":{"b":2}}'), '{"a":{"b":2}}')
})

test('top-level array is returned as-is', () => {
  assert.equal(extractJson('[1,2,3]'), '[1,2,3]')
})

test('text with no braces is returned trimmed', () => {
  assert.equal(extractJson('  not json  '), 'not json')
})

test('multiple objects slice from first { to last }', () => {
  assert.equal(extractJson('{"a":1} junk {"b":2}'), '{"a":1} junk {"b":2}')
})

test('validateSpec accepts a well-formed spec', () => {
  assert.equal(validateSpec({ chartType: 'bar', x: 'region', measure: 'units', aggregate: 'sum' }), null)
})

test('validateSpec requires chartType and x', () => {
  assert.match(validateSpec({ x: 'region' }) ?? '', /chartType is required/)
  assert.match(validateSpec({ chartType: 'bar' }) ?? '', /x is required/)
})

test('validateSpec rejects an out-of-enum chartType', () => {
  assert.match(validateSpec({ chartType: 'columnar', x: 'r' }) ?? '', /chartType must be one of/)
})

test('validateSpec rejects a bad filter operator and datePart', () => {
  assert.match(validateSpec({ chartType: 'bar', x: 'd', filters: [{ column: 'v', op: 'gt' }] }) ?? '', /op must be one of/)
  assert.match(validateSpec({ chartType: 'bar', x: 'd', filters: [{ column: 'd', datePart: 'fortnight' }] }) ?? '', /datePart must be one of/)
})

test('validateSpec is lenient about unknown extra properties (builder ignores them)', () => {
  assert.equal(validateSpec({ chartType: 'bar', x: 'r', notARealField: 123, filter: { column: 'r', in: ['x'] } }), null)
})

test('validateSpec validates nested display booleans', () => {
  assert.equal(validateSpec({ chartType: 'bar', x: 'r', display: { stacked: true } }), null)
  assert.match(validateSpec({ chartType: 'bar', x: 'r', display: { stacked: 'yes' } }) ?? '', /display\.stacked must be a boolean/)
})

test('validateSpec accepts a threshold value as a number or a lit_ token string', () => {
  assert.equal(validateSpec({ chartType: 'bar', x: 'r', filters: [{ column: 'v', op: '>', value: 605 }] }), null)
  assert.equal(validateSpec({ chartType: 'bar', x: 'r', filters: [{ column: 'v', op: '>', value: 'lit_4' }] }), null)
})

test('validateSpec requires filters to be an array of objects each with a column', () => {
  assert.match(validateSpec({ chartType: 'bar', x: 'r', filters: 'nope' }) ?? '', /filters must be an array/)
  assert.match(validateSpec({ chartType: 'bar', x: 'r', filters: [{ in: ['a'] }] }) ?? '', /column is required/)
})
