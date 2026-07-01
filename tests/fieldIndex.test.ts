import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSchema, type PropField } from '../src/schema.ts'
import { buildFieldIndex, fold } from '../src/fieldIndex.ts'

const prop = JSON.parse(readFileSync('formats/propGosterim.json', 'utf8')) as PropField[]
const index = buildFieldIndex(buildSchema(prop))

const anahtar = (text: string): string | null => {
  const r = index.resolve(text)
  return r.status === 'resolved' ? r.field.anahtar : null
}

test('fold normalizes Turkish letters to ascii without a combining dot', () => {
  assert.equal(fold('Depo İsmi'), 'depo ismi')
  assert.equal(fold('GELİR'), 'gelir')
  assert.equal(fold('Ürün Şubesi'), 'urun subesi')
})

test('exact multi-word title resolves', () => {
  assert.equal(anahtar('Depo İsmi'), 'depoIsmi')
  assert.equal(anahtar('Malzeme Kodu'), 'malzemeKodu')
  assert.equal(anahtar('Rezerve Miktar'), 'miktarRezerve')
})

test('diacritic-insensitive and case-insensitive', () => {
  assert.equal(anahtar('depo ismi'), 'depoIsmi')
  assert.equal(anahtar('MALZEME KODU'), 'malzemeKodu')
})

test('two content words intersect to one field', () => {
  assert.equal(anahtar('depo ismi'), 'depoIsmi')
  assert.equal(anahtar('malzeme ismi'), 'malzemeIsmi')
})

test('inflected single word resolves via stem when unambiguous', () => {
  assert.equal(anahtar('birime'), 'birim')
  assert.equal(anahtar('birimler'), 'birim')
})

test('a bare shared word is ambiguous (block+ask)', () => {
  const r = index.resolve('depo')
  assert.equal(r.status, 'ambiguous')
  const ks = r.status === 'ambiguous' ? r.candidates.map((c) => c.anahtar).sort() : []
  assert.ok(ks.includes('depoKodu') && ks.includes('depoIsmi') && ks.includes('enumDepoTipi'))
})

test('exact single-word title beats the shared-token ambiguity', () => {
  assert.equal(anahtar('Miktar'), 'miktar')
})

test('unknown / out-of-schema references resolve to unknown', () => {
  assert.equal(index.resolve('gelir').status, 'unknown')
  assert.equal(index.resolve('Ahmet Yılmaz').status, 'unknown')
  assert.equal(index.resolve('ciro').status, 'unknown')
})

test('gizli and nested fields are never resolved to', () => {
  assert.notEqual(anahtar('Stok Numarası'), 'stokId')
  const r = index.resolve('Rezerveler')
  assert.ok(r.status !== 'resolved' || r.field.resolvable)
})

test('an inflected form resolves to its exact title, not the shared-token ambiguity', () => {
  assert.equal(anahtar('miktarı'), 'miktar')
  assert.equal(anahtar('miktar'), 'miktar')
  assert.equal(index.resolve('depo').status, 'ambiguous')
})

test('suggest: prefix-matched, role-filtered, capped (index-backed, O(query))', () => {
  const dims = index.suggest('depo', 30, (f) => f.type !== 'number').map((f) => f.anahtar)
  assert.ok(dims.includes('depoIsmi') && dims.includes('depoKodu'))
  const ismi = index.suggest('ismi', 30).map((f) => f.baslik)
  assert.ok(ismi.some((b) => b.includes('İsmi')))
  const nums = index.suggest('miktar', 30, (f) => f.type === 'number')
  assert.ok(nums.length > 0 && nums.every((f) => f.type === 'number'))
  assert.ok(index.suggest('', 5).length <= 5)
  assert.deepEqual(index.suggest('zzzznomatch', 30), [])
})
