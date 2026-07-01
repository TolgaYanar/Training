import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSchema, type PropField } from '../src/schema.ts'
import { buildFieldIndex } from '../src/fieldIndex.ts'
import { resolveSlot, resolveRequest } from '../src/resolve.ts'

const prop = JSON.parse(readFileSync('formats/propGosterim.json', 'utf8')) as PropField[]
const index = buildFieldIndex(buildSchema(prop))

test('measure slot accepts a numeric field, rejects a categorical (K3)', () => {
  const ok = resolveSlot('Miktar', index, 'measure')
  assert.equal(ok.state, 'green')
  const bad = resolveSlot('Depo İsmi', index, 'measure')
  assert.equal(bad.state, 'red')
  assert.equal(bad.state === 'red' ? bad.reason : '', 'type')
})

test('dimension slot accepts any resolvable field', () => {
  assert.equal(resolveSlot('Depo İsmi', index, 'dimension').state, 'green')
  assert.equal(resolveSlot('İlk Giriş Tarihi', index, 'dimension').state, 'green')
})

test('unknown reference is red (unknown) -> block+ask', () => {
  const c = resolveSlot('gelir', index, 'dimension')
  assert.equal(c.state, 'red')
  assert.equal(c.state === 'red' ? c.reason : '', 'unknown')
})

test('ambiguous bare word is amber with candidates', () => {
  const c = resolveSlot('depo', index, 'dimension')
  assert.equal(c.state, 'amber')
  const ks = c.state === 'amber' ? c.candidates.map((f) => f.anahtar).sort() : []
  assert.ok(ks.includes('depoKodu') && ks.includes('depoIsmi'))
})

test('role narrows an ambiguous set: none of the depo candidates are numeric', () => {
  const c = resolveSlot('depo', index, 'measure')
  assert.equal(c.state, 'red')
})

test('a fully-resolved request is not blocked', () => {
  const r = resolveRequest({ x: 'Depo İsmi', olcu: 'Miktar', topla: 'toplam' }, index)
  assert.equal(r.x!.state, 'green')
  assert.equal(r.olcu!.state, 'green')
  assert.equal(r.blocked, false)
})

test('a type-violating measure blocks the request', () => {
  const r = resolveRequest({ x: 'Depo İsmi', olcu: 'Depo İsmi' }, index)
  assert.equal(r.olcu!.state, 'red')
  assert.equal(r.blocked, true)
})

test('grupla requires a date x-axis (K3)', () => {
  const bad = resolveRequest({ x: 'Depo İsmi', olcu: 'Miktar', grupla: 'ay' }, index)
  assert.equal(bad.gruplaOk, false)
  assert.equal(bad.blocked, true)
  const ok = resolveRequest({ x: 'İlk Giriş Tarihi', olcu: 'Miktar', grupla: 'ay' }, index)
  assert.equal(ok.gruplaOk, true)
  assert.equal(ok.blocked, false)
})

test('a filter field resolves and unknown filter blocks', () => {
  const ok = resolveRequest({ x: 'Malzeme İsmi', olcu: 'Miktar', filtre: [{ field: 'Depo Kodu', op: '=', value: '001' }] }, index)
  assert.equal(ok.filtre[0].field.state, 'green')
  assert.equal(ok.blocked, false)
  const bad = resolveRequest({ x: 'Malzeme İsmi', olcu: 'Miktar', filtre: [{ field: 'müşteri', op: '=', value: 'x' }] }, index)
  assert.equal(bad.filtre[0].field.state, 'red')
  assert.equal(bad.blocked, true)
})
