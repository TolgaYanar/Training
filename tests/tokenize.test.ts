import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Row } from '../src/types.ts'
import { buildSchema, type PropField } from '../src/schema.ts'
import { buildFieldIndex } from '../src/fieldIndex.ts'
import { tokenizeSentence } from '../src/tokenize.ts'

const prop = JSON.parse(readFileSync('formats/propGosterim.json', 'utf8')) as PropField[]
const rows = JSON.parse(readFileSync('formats/response.json', 'utf8')) as Row[]
const index = buildFieldIndex(buildSchema(prop))
const tok = (s: string) => tokenizeSentence(s, index, rows)

test('quoted fields become col_ tokens; intent words pass through raw', () => {
  const { payload, toReal, unresolved } = tok('"Depo İsmi" bazında toplam "Miktar" çubuk')
  assert.deepEqual(unresolved, [])
  assert.deepEqual(Object.values(toReal).sort(), ['depoIsmi', 'miktar'])
  assert.match(payload, /bazında/)
  assert.match(payload, /toplam/)
  assert.match(payload, /çubuk/)
  assert.doesNotMatch(payload, /Depo|İsmi|Miktar/)
})

test('a fully-marked sentence resolves with no block', () => {
  const { unresolved } = tok('"Depo İsmi" bazında aylık toplam "Miktar" çizgi olarak göster')
  assert.deepEqual(unresolved, [])
})

test('an unmarked field reference is blocked — the gate requires quoting', () => {
  const { payload, unresolved } = tok('depo ismine göre toplam miktar')
  assert.ok(unresolved.some((u) => /depo/i.test(u)))
  assert.ok(unresolved.includes('miktar'))
  assert.doesNotMatch(payload, /col_/)
})

test('an unmarked data value is blocked — the gate requires bracketing', () => {
  const { payload, unresolved } = tok('deneme bazında miktar')
  assert.ok(unresolved.includes('deneme'))
  assert.doesNotMatch(payload, /deneme/)
})

test('a [bracketed] value is an explicit val_ token, never raw', () => {
  const { payload, toReal } = tok('"Depo Tipi" [Ana]')
  assert.ok(Object.entries(toReal).some(([k, v]) => k.startsWith('val_') && v === 'Ana'))
  assert.doesNotMatch(payload, /Ana/)
})

test('the intent/field collision is disambiguated by quoting', () => {
  const field = tok('"Ortalama Ağırlık" ölçüsü')
  assert.deepEqual(Object.values(field.toReal), ['agirlikOrtalama'])
  const intent = tok('ortalama "Rezervesiz Miktar"')
  assert.deepEqual(Object.values(intent.toReal), ['rezervesizMiktar'])
  assert.match(intent.payload, /ortalama col_\d+/)
  assert.deepEqual(intent.unresolved, [])
})

test('a typed proper name is name-risk blocked (unresolved), never sent', () => {
  const { payload, unresolved } = tok('"Malzeme İsmi" Ahmet Yılmaz')
  assert.ok(unresolved.includes('Ahmet') && unresolved.includes('Yılmaz'))
  assert.doesNotMatch(payload, /Ahmet|Yılmaz/)
})

test('a quoted field that does not exist is asked, never sent', () => {
  const { payload, unresolved } = tok('"Olmayan Alan" toplam')
  assert.ok(unresolved.includes('Olmayan Alan'))
  assert.doesNotMatch(payload, /Olmayan|Alan/)
})

test('bare intent vocabulary passes; a full field title still requires quoting', () => {
  const { payload, unresolved } = tok('"Miktar" filanca falanca en çok 5')
  assert.deepEqual(unresolved, [])
  assert.match(payload, /filanca/)
  assert.match(payload, /\b5\b/)
})