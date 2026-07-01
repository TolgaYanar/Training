import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Row } from '../src/types.ts'
import type { RequestInput } from '../src/request.ts'
import { buildSchema, type PropField } from '../src/schema.ts'
import { buildFieldIndex } from '../src/fieldIndex.ts'
import { resolveRequest } from '../src/resolve.ts'
import { buildRequestChart } from '../src/toChart.ts'

const prop = JSON.parse(readFileSync('formats/propGosterim.json', 'utf8')) as PropField[]
const rows = JSON.parse(readFileSync('formats/response.json', 'utf8')) as Row[]
const index = buildFieldIndex(buildSchema(prop))

function chart(req: RequestInput) {
  return buildRequestChart(req, resolveRequest(req, index), rows)
}
const axis = (o: unknown): unknown[] => (o as { xAxis: { data: unknown[] } }).xAxis.data
const series = (o: unknown): { data: unknown[] }[] => (o as { series: { data: unknown[] }[] }).series

test('slots -> chart option on real sample rows', () => {
  const out = chart({ grafik: 'çubuk', x: 'Malzeme İsmi', olcu: 'Miktar', topla: 'toplam' })
  assert.ok('option' in out, 'error' in out ? out.error : '')
  assert.ok(series(out.option).length > 0)
  assert.ok(axis(out.option).length > 0)
})

test('enum x is relabeled code->label (Ö3): axis shows labels, never raw codes', () => {
  const out = chart({ grafik: 'çubuk', x: 'Depo Tipi', olcu: 'Miktar', topla: 'toplam' })
  assert.ok('option' in out, 'error' in out ? out.error : '')
  const xs = axis(out.option)
  assert.ok(xs.every((v) => typeof v === 'string'), `axis had non-strings: ${JSON.stringify(xs)}`)
  assert.ok(!xs.includes(999) && !xs.includes(1))
  const labels = new Set(['Ana', 'Arge', 'Cari', 'Diğer'])
  assert.ok(xs.some((v) => labels.has(v as string)), `no enum labels in ${JSON.stringify(xs)}`)
})

test('top-N: sırala azalan ilk 3 limits the bars', () => {
  const out = chart({ grafik: 'çubuk', x: 'Malzeme İsmi', olcu: 'Miktar', topla: 'toplam', sirala: { yon: 'azalan', ilk: 3 } })
  assert.ok('option' in out, 'error' in out ? out.error : '')
  assert.ok(axis(out.option).length <= 3)
})

test('a request with no resolvable x-axis returns an error, not a chart', () => {
  const out = chart({ olcu: 'Miktar' })
  assert.ok('error' in out)
})

test('date x + monthly bucket renders without error', () => {
  const out = chart({ grafik: 'çizgi', x: 'İlk Giriş Tarihi', olcu: 'Miktar', topla: 'toplam', grupla: 'ay' })
  assert.ok('option' in out, 'error' in out ? out.error : '')
})
