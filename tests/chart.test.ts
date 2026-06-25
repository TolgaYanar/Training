import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildChartOption } from '../src/chart.ts'
import { datasets } from '../src/data.ts'

const rows = [
  { day: 'Mon', team: 'A', score: 10 },
  { day: 'Mon', team: 'B', score: 20 },
  { day: 'Tue', team: 'A', score: null },
  { day: 'Tue', team: 'B', score: 30 },
  { day: 'Wed', team: 'A', score: 5 },
  { day: 'Wed', team: 'B', score: null },
]

test('line ungrouped sum: present values only, first-appearance x order', () => {
  const o = buildChartOption({ chartType: 'line', x: 'day', measure: 'score', aggregate: 'sum' }, rows)
  assert.deepEqual(o.xAxis.data, ['Mon', 'Tue', 'Wed'])
  assert.equal(o.series.length, 1)
  assert.deepEqual(o.series[0].data, [30, 30, 5])
  assert.equal(o.series[0].name, 'score')
})

test('grouped none: one series per team, nulls preserved, aligned, has legend', () => {
  const o = buildChartOption({ chartType: 'line', x: 'day', series: 'team', measure: 'score', aggregate: 'none' }, rows)
  assert.equal(o.series.length, 2)
  const a = o.series.find((s) => s.name === 'A')
  const b = o.series.find((s) => s.name === 'B')
  assert.deepEqual(a.data, [10, null, 5])
  assert.deepEqual(b.data, [20, 30, null])
  assert.ok(o.series.every((s) => s.data.length === o.xAxis.data.length))
  assert.ok('legend' in o)
})

test('aggregate avg / min / max / count', () => {
  assert.deepEqual(buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'avg' }, rows).series[0].data, [15, 30, 5])
  assert.deepEqual(buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'min' }, rows).series[0].data, [10, 30, 5])
  assert.deepEqual(buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'max' }, rows).series[0].data, [20, 30, 5])
  const c = buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'count' }, rows)
  assert.deepEqual(c.series[0].data, [2, 2, 2])
  assert.equal(c.series[0].name, 'count')
})

test('x with all-null measure becomes a null gap', () => {
  const withThu = [...rows, { day: 'Thu', team: 'A', score: null }, { day: 'Thu', team: 'B', score: null }]
  const o = buildChartOption({ chartType: 'line', x: 'day', measure: 'score', aggregate: 'sum' }, withThu)
  assert.deepEqual(o.xAxis.data, ['Mon', 'Tue', 'Wed', 'Thu'])
  assert.equal(o.series[0].data[3], null)
})

test('sort value desc + limit = top-N', () => {
  const o = buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'sum', sort: 'value', order: 'desc', limit: 2 }, rows)
  assert.equal(o.xAxis.data.length, 2)
  assert.ok(o.series[0].data[0] >= o.series[0].data[1])
})

test('sort value asc puts smallest first', () => {
  const o = buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'sum', sort: 'value', order: 'asc' }, rows)
  assert.equal(o.xAxis.data[0], 'Wed')
})

test('order desc without sort reverses first-appearance order', () => {
  const o = buildChartOption({ chartType: 'line', x: 'day', measure: 'score', aggregate: 'sum', order: 'desc' }, rows)
  assert.deepEqual(o.xAxis.data, ['Wed', 'Tue', 'Mon'])
})

test('pie: aggregated slices, filters out null and <= 0', () => {
  const pieRows = [...rows, { day: 'X', team: 'C', score: null }, { day: 'Y', team: 'D', score: 0 }]
  const o = buildChartOption({ chartType: 'pie', x: 'team', measure: 'score', aggregate: 'sum' }, pieRows)
  const names = o.series[0].data.map((d) => d.name)
  assert.ok(names.includes('A') && names.includes('B'))
  assert.ok(!names.includes('C'))
  assert.ok(!names.includes('D'))
  assert.ok(o.series[0].data.every((d) => d.value > 0))
})

test('scatter: {value:[x,y]} items, drops rows with a null member', () => {
  const sc = [{ a: 1, b: 2 }, { a: 3, b: null }, { a: null, b: 4 }, { a: 5, b: 6 }]
  const o = buildChartOption({ chartType: 'scatter', x: 'a', measure: 'b', aggregate: 'none' }, sc)
  assert.deepEqual(o.series[0].data.map((d) => d.value), [[1, 2], [5, 6]])
  assert.equal(o.xAxis.type, 'value')
  assert.equal(o.yAxis.type, 'value')
})

test('scatter carries non-axis columns into each point and labels them in the tooltip', () => {
  const o = buildChartOption({ chartType: 'scatter', x: 'temperature', measure: 'humidity', aggregate: 'none' }, [{ date: '2024-03-13', sensor: 'Sensor A', temperature: 7, humidity: 56 }])
  const item = o.series[0].data[0]
  assert.deepEqual(item.label, { date: '2024-03-13', sensor: 'Sensor A' })
  const txt = o.tooltip.formatter({ value: item.value, seriesName: 'humidity', data: item })
  assert.ok(txt.includes('date: 2024-03-13'))
  assert.ok(txt.includes('sensor: Sensor A'))
  assert.ok(txt.includes('temperature: 7'))
  assert.ok(txt.includes('humidity: 56'))
  assert.equal(o.xAxis.nameLocation, 'middle')
})

test('scatter grouped: one series per group', () => {
  const sc = [{ a: 1, b: 2, g: 'p' }, { a: 3, b: 4, g: 'q' }, { a: 5, b: 6, g: 'p' }]
  const o = buildChartOption({ chartType: 'scatter', x: 'a', measure: 'b', series: 'g', aggregate: 'none' }, sc)
  assert.equal(o.series.length, 2)
})

test('area sets areaStyle and renders as line', () => {
  const o = buildChartOption({ chartType: 'area', x: 'day', measure: 'score', aggregate: 'sum' }, rows)
  assert.ok(o.series[0].areaStyle)
  assert.equal(o.series[0].type, 'line')
})

test('bar has no smooth / showSymbol', () => {
  const o = buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'sum' }, rows)
  assert.equal(o.series[0].type, 'bar')
  assert.equal(o.series[0].smooth, undefined)
  assert.equal(o.series[0].showSymbol, undefined)
})

const mm = [
  { ch: 'A', s: 1, v: 100 },
  { ch: 'A', s: 2, v: 200 },
  { ch: 'B', s: 3, v: 300 },
]

test('multi-measure: one series per measure, dual y-axis + yAxisIndex for two', () => {
  const o = buildChartOption({ chartType: 'bar', x: 'ch', measures: ['s', 'v'], aggregate: 'sum' }, mm)
  assert.equal(o.series.length, 2)
  assert.deepEqual(o.series.map((s) => s.name), ['s', 'v'])
  assert.deepEqual(o.series[0].data, [3, 3])
  assert.deepEqual(o.series[1].data, [300, 300])
  assert.ok(Array.isArray(o.yAxis) && o.yAxis.length === 2)
  assert.equal(o.series[0].yAxisIndex, 0)
  assert.equal(o.series[1].yAxisIndex, 1)
  assert.ok('legend' in o)
})

test('three measures: single shared y-axis, no yAxisIndex', () => {
  const o = buildChartOption({ chartType: 'bar', x: 'ch', measures: ['s', 'v', 's'], aggregate: 'sum' }, mm)
  assert.equal(o.series.length, 3)
  assert.ok(!Array.isArray(o.yAxis))
  assert.equal(o.series[0].yAxisIndex, undefined)
})

test('measures validates columns and requires a measure', () => {
  assert.throws(() => buildChartOption({ chartType: 'bar', x: 'ch', measures: ['s', 'nope'], aggregate: 'sum' }, mm), /unknown column/)
  assert.throws(() => buildChartOption({ chartType: 'bar', x: 'ch', aggregate: 'sum' }, mm), /must specify a measure/)
})

test('title included when provided, omitted otherwise', () => {
  assert.equal(buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'sum', title: 'Hi' }, rows).title.text, 'Hi')
  assert.equal(buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'sum' }, rows).title, undefined)
})

test('unknown column throws (x and series)', () => {
  assert.throws(() => buildChartOption({ chartType: 'bar', x: 'nope', measure: 'score', aggregate: 'sum' }, rows), /unknown column/)
  assert.throws(() => buildChartOption({ chartType: 'line', x: 'day', series: 'ghost', measure: 'score', aggregate: 'none' }, rows), /unknown column/)
})

test('dense line (>30 pts) hides symbols; sparse keeps them', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ d: 'd' + i, v: i }))
  assert.equal(buildChartOption({ chartType: 'line', x: 'd', measure: 'v', aggregate: 'sum' }, many).series[0].showSymbol, false)
  assert.equal(buildChartOption({ chartType: 'line', x: 'day', measure: 'score', aggregate: 'sum' }, rows).series[0].showSymbol, undefined)
})

test('real sales: months render in CALENDAR order, 4 series x 12', () => {
  const sales = datasets.find((d) => d.id === 'sales')
  const o = buildChartOption({ chartType: 'line', x: 'month', series: 'region', measure: 'revenue', aggregate: 'sum' }, sales.rows)
  assert.deepEqual(o.xAxis.data, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
  assert.equal(o.series.length, 4)
  assert.ok(o.series.every((s) => s.data.length === 12))
})

test('real traffic: daily total = 365 aligned points, zero gaps, symbols hidden', () => {
  const traffic = datasets.find((d) => d.id === 'traffic')
  const o = buildChartOption({ chartType: 'line', x: 'date', measure: 'signups', aggregate: 'sum' }, traffic.rows)
  assert.equal(o.xAxis.data.length, 365)
  assert.equal(o.series[0].data.length, 365)
  assert.equal(o.series[0].data.filter((v) => v === null).length, 0)
  assert.equal(o.series[0].showSymbol, false)
})

test('real traffic per-channel: 4 series x 365, aligned, with real nulls', () => {
  const traffic = datasets.find((d) => d.id === 'traffic')
  const o = buildChartOption({ chartType: 'line', x: 'date', series: 'channel', measure: 'signups', aggregate: 'none' }, traffic.rows)
  assert.equal(o.series.length, 4)
  assert.ok(o.series.every((s) => s.data.length === 365))
  assert.ok(o.series.every((s) => s.data.filter((v) => v === null).length > 0))
})

test('numeric x column is handled', () => {
  const r = [{ yr: 2020, v: 1 }, { yr: 2021, v: 2 }, { yr: 2020, v: 3 }]
  const o = buildChartOption({ chartType: 'bar', x: 'yr', measure: 'v', aggregate: 'sum' }, r)
  assert.deepEqual(o.xAxis.data, [2020, 2021])
  assert.deepEqual(o.series[0].data, [4, 2])
})

test('empty dataset throws', () => {
  assert.throws(() => buildChartOption({ chartType: 'bar', x: 'a', measure: 'b', aggregate: 'sum' }, []), /unknown column/)
})

test('categorical column as measure yields all-null series', () => {
  const r = [{ k: 'a', label: 'x' }, { k: 'b', label: 'y' }]
  const o = buildChartOption({ chartType: 'bar', x: 'k', measure: 'label', aggregate: 'sum' }, r)
  assert.deepEqual(o.series[0].data, [null, null])
})

test('grouped bar: one bar series per group', () => {
  const o = buildChartOption({ chartType: 'bar', x: 'day', series: 'team', measure: 'score', aggregate: 'sum' }, rows)
  assert.equal(o.series.length, 2)
  assert.ok(o.series.every((s) => s.type === 'bar'))
  assert.ok('legend' in o)
})

test('aggregate none with multiple rows per x returns the first present value', () => {
  const r = [{ k: 'a', v: 10 }, { k: 'a', v: 20 }]
  const o = buildChartOption({ chartType: 'bar', x: 'k', measure: 'v', aggregate: 'none' }, r)
  assert.deepEqual(o.series[0].data, [10])
})

test('limit larger than category count returns all', () => {
  const o = buildChartOption({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'sum', sort: 'value', limit: 99 }, rows)
  assert.equal(o.xAxis.data.length, 3)
})

test('pie filters out negative and zero values', () => {
  const r = [{ k: 'a', v: 5 }, { k: 'b', v: -3 }, { k: 'c', v: 0 }]
  const o = buildChartOption({ chartType: 'pie', x: 'k', measure: 'v', aggregate: 'sum' }, r)
  assert.deepEqual(o.series[0].data.map((d) => d.name), ['a'])
})

test('single-element measures: one series, single y-axis', () => {
  const o = buildChartOption({ chartType: 'bar', x: 'day', measures: ['score'], aggregate: 'sum' }, rows)
  assert.equal(o.series.length, 1)
  assert.ok(!Array.isArray(o.yAxis))
})

test('dense-symbol boundary: 30 keeps symbols, 31 hides', () => {
  const at30 = Array.from({ length: 30 }, (_, i) => ({ d: 'd' + i, v: i }))
  const at31 = Array.from({ length: 31 }, (_, i) => ({ d: 'd' + i, v: i }))
  assert.equal(buildChartOption({ chartType: 'line', x: 'd', measure: 'v', aggregate: 'sum' }, at30).series[0].showSymbol, undefined)
  assert.equal(buildChartOption({ chartType: 'line', x: 'd', measure: 'v', aggregate: 'sum' }, at31).series[0].showSymbol, false)
})
