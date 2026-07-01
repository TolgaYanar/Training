import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSchema, type PropField } from '../src/schema.ts'

const prop = JSON.parse(readFileSync('formats/propGosterim.json', 'utf8')) as PropField[]
const schema = buildSchema(prop)
const by = (a: string) => schema.find((f) => f.anahtar === a)!

test('one FieldMeta per propGosterim field', () => {
  assert.equal(schema.length, prop.length)
})

test('tur -> type mapping', () => {
  assert.equal(by('miktar').type, 'number')
  assert.equal(by('agirlikOrtalama').type, 'number')
  assert.equal(by('girisTarihi').type, 'date')
  assert.equal(by('enumDepoTipi').type, 'categorical')
  assert.equal(by('depoIsmi').type, 'categorical')
  assert.equal(by('seriTakibi').type, 'boolean')
})

test('enum fields carry their enumKeys label<->code map', () => {
  const e = by('enumDepoTipi')
  assert.ok(e.enumKeys)
  assert.deepEqual(e.enumKeys!.find((k) => k.label === 'Diğer'), { label: 'Diğer', value: 999 })
  assert.equal(by('miktar').enumKeys, null)
})

test('gizli id columns are not resolvable', () => {
  assert.equal(by('stokId').resolvable, false)
  assert.equal(by('depoId').resolvable, false)
  assert.equal(by('seriTakibi').resolvable, false)
})

test('nested liste / sorgu-liste columns are not resolvable', () => {
  assert.equal(by('miktarRezervedekiler').resolvable, false)
  assert.equal(by('malzemeUreticiKodlari').resolvable, false)
  assert.equal(by('seriler').resolvable, false)
})

test('ordinary scalar fields are resolvable', () => {
  assert.equal(by('depoIsmi').resolvable, true)
  assert.equal(by('miktar').resolvable, true)
  assert.equal(by('girisTarihi').resolvable, true)
  assert.equal(by('enumDepoTipi').resolvable, true)
})

test('duplicate baslik has exactly one resolvable (non-gizli) twin', () => {
  const mrp = schema.filter((f) => f.baslik === 'Mrp Sorumlusu')
  assert.equal(mrp.length, 2)
  assert.equal(mrp.filter((f) => f.resolvable).length, 1)
  assert.equal(mrp.find((f) => f.resolvable)!.anahtar, 'mrpSorumlusuKullaniciAdi')
})
