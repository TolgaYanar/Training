import type { ChartSpec, EChartsOption, Row } from './types'

function present(v: unknown): v is string | number {
  return v !== null && v !== undefined && v !== ''
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function uniqueInOrder(rows: Row[], key: string): Array<string | number> {
  const seen = new Set<string>()
  const out: Array<string | number> = []
  for (const r of rows) {
    const v = r[key]
    if (!present(v)) continue
    const k = String(v)
    if (!seen.has(k)) {
      seen.add(k)
      out.push(v)
    }
  }
  return out
}

function indexBy(rows: Row[], key: string): Map<string, Row[]> {
  const m = new Map<string, Row[]>()
  for (const r of rows) {
    const v = r[key]
    if (!present(v)) continue
    const k = String(v)
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  return m
}

function cell(rows: Row[], measure: string, op: ChartSpec['aggregate']): number | null {
  if (op === 'count') return rows.length
  const nums: number[] = []
  for (const r of rows) {
    const n = num(r[measure])
    if (n !== null) nums.push(n)
  }
  if (nums.length === 0) return null
  switch (op) {
    case 'sum': return nums.reduce((a, b) => a + b, 0)
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
    default: return nums[0]
  }
}

function grouped(spec: ChartSpec): boolean {
  return typeof spec.series === 'string' && spec.series.length > 0
}

function orderX(spec: ChartSpec, rows: Row[], byX: Map<string, Row[]>): Array<string | number> {
  let xVals = uniqueInOrder(rows, spec.x)
  if (spec.sort === 'value') {
    const m = typeof spec.measure === 'string' ? spec.measure : (Array.isArray(spec.measures) ? spec.measures[0] : '')
    const total = (xv: string | number) => cell(byX.get(String(xv)) ?? [], m, spec.aggregate === 'count' ? 'count' : 'sum') ?? -Infinity
    xVals = [...xVals].sort((a, b) => total(a) - total(b))
    if (spec.order !== 'asc') xVals.reverse()
  } else if (spec.order === 'desc') {
    xVals = [...xVals].reverse()
  }
  if (typeof spec.limit === 'number' && spec.limit > 0) xVals = xVals.slice(0, spec.limit)
  return xVals
}

function cartesian(spec: ChartSpec, rows: Row[], title: Record<string, unknown>): EChartsOption {
  const byX = indexBy(rows, spec.x)
  const xVals = orderX(spec, rows, byX)
  const type = spec.chartType === 'bar' ? 'bar' : 'line'
  const extra: Record<string, unknown> = type === 'line' ? { smooth: true } : {}
  if (type === 'line' && xVals.length > 30) extra.showSymbol = false
  if (spec.chartType === 'area') extra.areaStyle = {}
  const measures = Array.isArray(spec.measures) && spec.measures.length > 0 ? spec.measures : null
  const dual = measures !== null && measures.length === 2
  let series: unknown[]
  if (measures) {
    series = measures.map((m, i) => ({
      name: m,
      type,
      data: xVals.map((xv) => cell(byX.get(String(xv)) ?? [], m, spec.aggregate)),
      ...extra,
      ...(dual ? { yAxisIndex: i } : {}),
    }))
  } else if (grouped(spec)) {
    const key = spec.series as string
    series = uniqueInOrder(rows, key).map((sv) => {
      const data = xVals.map((xv) => cell((byX.get(String(xv)) ?? []).filter((r) => String(r[key]) === String(sv)), spec.measure, spec.aggregate))
      return { name: String(sv), type, data, ...extra }
    })
  } else {
    const data = xVals.map((xv) => cell(byX.get(String(xv)) ?? [], spec.measure, spec.aggregate))
    series = [{ name: spec.aggregate === 'count' ? 'count' : spec.measure, type, data, ...extra }]
  }
  const option: Record<string, unknown> = {
    ...title,
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: xVals },
    yAxis: measures && measures.length === 2 ? [{ type: 'value', name: measures[0] }, { type: 'value', name: measures[1] }] : { type: 'value' },
    series,
  }
  if (series.length > 1) option.legend = {}
  return option as EChartsOption
}

function pie(spec: ChartSpec, rows: Row[], title: Record<string, unknown>): EChartsOption {
  const byX = indexBy(rows, spec.x)
  const data = orderX(spec, rows, byX)
    .map((xv) => ({ name: String(xv), value: cell(byX.get(String(xv)) ?? [], spec.measure, spec.aggregate) }))
    .filter((d) => typeof d.value === 'number' && d.value > 0)
  const option: Record<string, unknown> = {
    ...title,
    tooltip: { trigger: 'item' },
    legend: {},
    series: [{ type: 'pie', radius: '60%', data }],
  }
  return option as EChartsOption
}

function scatter(spec: ChartSpec, rows: Row[], title: Record<string, unknown>): EChartsOption {
  const cols = Object.keys(rows[0] ?? {})
  const labelCols = cols.filter((c) => c !== spec.x && c !== spec.measure && c !== spec.series)
  type Item = { value: number[]; label: Record<string, unknown> }
  const toItem = (r: Row): Item | null => {
    const x = num(r[spec.x])
    const y = num(r[spec.measure])
    if (x === null || y === null) return null
    const label: Record<string, unknown> = {}
    for (const c of labelCols) label[c] = r[c]
    return { value: [x, y], label }
  }
  const keep = (p: Item | null): p is Item => p !== null
  const isGrouped = grouped(spec)
  let series: unknown[]
  if (isGrouped) {
    const key = spec.series as string
    series = uniqueInOrder(rows, key).map((sv) => ({
      name: String(sv),
      type: 'scatter',
      data: rows.filter((r) => String(r[key]) === String(sv)).map(toItem).filter(keep),
    }))
  } else {
    series = [{ name: spec.measure, type: 'scatter', data: rows.map(toItem).filter(keep) }]
  }
  const formatter = (p: { value: number[]; seriesName: string; data: Item }) => {
    const head = isGrouped ? `${p.seriesName}<br/>` : ''
    const labels = labelCols.map((c) => `${c}: ${p.data.label[c]}`).join('<br/>')
    return `${head}${labels ? labels + '<br/>' : ''}${spec.x}: ${p.value[0]}<br/>${spec.measure}: ${p.value[1]}`
  }
  const option: Record<string, unknown> = {
    ...title,
    tooltip: { trigger: 'item', formatter },
    grid: { bottom: 48 },
    xAxis: { type: 'value', name: spec.x, nameLocation: 'middle', nameGap: 28 },
    yAxis: { type: 'value', name: spec.measure },
    series,
  }
  if (isGrouped) option.legend = {}
  return option as EChartsOption
}

export function buildChartOption(spec: ChartSpec, rows: Row[]): EChartsOption {
  const columns = new Set(Object.keys(rows[0] ?? {}))
  const hasMeasures = Array.isArray(spec.measures) && spec.measures.length > 0
  if (typeof spec.measure !== 'string' && !hasMeasures) throw new Error('Spec must specify a measure')
  const required: string[] = [spec.x]
  if (typeof spec.measure === 'string') required.push(spec.measure)
  if (hasMeasures) required.push(...(spec.measures as string[]))
  if (grouped(spec)) required.push(spec.series as string)
  for (const key of required) {
    if (typeof key !== 'string' || !columns.has(key)) throw new Error(`Spec refers to unknown column "${key}"`)
  }
  const title: Record<string, unknown> = spec.title ? { title: { text: spec.title } } : {}
  if (spec.chartType === 'scatter') return scatter(spec, rows, title)
  if (spec.chartType === 'pie') return pie(spec, rows, title)
  return cartesian(spec, rows, title)
}
