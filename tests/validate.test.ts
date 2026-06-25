import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractJson } from '../src/validate.ts'

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
