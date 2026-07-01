import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Row } from '../src/types.ts'
import { buildSchema, type PropField } from '../src/schema.ts'
import { buildDenySet, verifyOutbound, sealOutbound } from '../src/tripwire.ts'

const prop = JSON.parse(readFileSync('formats/propGosterim.json', 'utf8')) as PropField[]
const rows = JSON.parse(readFileSync('formats/response.json', 'utf8')) as Row[]
const schema = buildSchema(prop)
const deny = buildDenySet(schema, rows)
const tokens = new Set(['col_0', 'col_1'])

test('tokens + intent words pass the data-deny check', () => {
  assert.deepEqual(verifyOutbound('col_0 göre toplam col_1 çubuk aylık en çok 5', tokens, deny), [])
})

test('field-name words pass as vocabulary (fields are marked with quotes, not denied)', () => {
  assert.deepEqual(verifyOutbound('col_0 depo ortalama tipine göre', tokens, deny), [])
})

test('a raw data value is blocked as a leak', () => {
  assert.deepEqual(verifyOutbound('col_0 deneme', tokens, deny), ['deneme'])
})

test('a fragment of a multi-word value is blocked (closes the intent-bypass hole)', () => {
  assert.deepEqual(verifyOutbound('col_0 mlz', tokens, deny), ['mlz'])
})

test('an enum label value is blocked', () => {
  assert.deepEqual(verifyOutbound('col_0 ana', tokens, deny), ['ana'])
})

test('a token that is not part of this request is blocked', () => {
  assert.deepEqual(verifyOutbound('col_0 col_9', tokens, deny), ['col_9'])
})

test('a long raw number is blocked (should be a lit_ token)', () => {
  assert.deepEqual(verifyOutbound('col_0 999999', tokens, deny), ['999999'])
})

test('sealOutbound throws on any leak, returns the string when clean', () => {
  assert.equal(sealOutbound('col_0 göre toplam', tokens, deny), 'col_0 göre toplam')
  assert.throws(() => sealOutbound('col_0 deneme', tokens, deny), /blocked known-data leak/)
})
