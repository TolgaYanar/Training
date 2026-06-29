import type { ChartSpec, EChartsOption, Filter, Row } from './types'

function present(v: unknown): v is string | number {
  return v !== null && v !== undefined && v !== ''
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function datePartOf(v: unknown, part: 'day' | 'weekday' | 'month' | 'quarter'): number | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return null
  if (part === 'day') return Number(m[3])
  if (part === 'month') return Number(m[2])
  if (part === 'quarter') return Math.ceil(Number(m[2]) / 3)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
}

function bucketOf(v: unknown, b: 'week' | 'month' | 'quarter' | 'year'): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return null
  if (b === 'year') return m[1]
  if (b === 'quarter') return `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`
  if (b === 'week') {
    const doy = Math.floor((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(Number(m[1]), 0, 1)) / 86400000) + 1
    return `${m[1]}-W${String(Math.floor((doy - 1) / 7) + 1).padStart(2, '0')}`
  }
  return `${m[1]}-${m[2]}`
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function cyclicLabel(v: unknown, part: 'day' | 'weekday' | 'month' | 'quarter'): string | null {
  const p = datePartOf(v, part)
  if (p === null) return null
  if (part === 'weekday') return WEEKDAY_LABELS[p]
  if (part === 'month') return MONTH_LABELS[p - 1]
  if (part === 'quarter') return `Q${p}`
  return String(p)
}

function partRank(label: string, part: 'day' | 'weekday' | 'month' | 'quarter'): number {
  if (part === 'weekday') return WEEKDAY_LABELS.indexOf(label)
  if (part === 'month') return MONTH_LABELS.indexOf(label)
  if (part === 'quarter') return Number(label.slice(1))
  return Number(label)
}

function namedPartNum(v: unknown, part: 'day' | 'weekday' | 'month' | 'quarter'): number | null {
  if (typeof v !== 'string') return null
  const w = v.trim().toLowerCase().slice(0, 3)
  if (part === 'month') { const i = MONTH_LABELS.findIndex((m) => m.toLowerCase() === w); return i < 0 ? null : i + 1 }
  if (part === 'weekday') { const i = WEEKDAY_LABELS.findIndex((d) => d.toLowerCase() === w); return i < 0 ? null : i }
  return null
}

function matchesTerm(actual: string, term: string): boolean {
  if (actual === term) return true
  const a = actual.toLowerCase().trim()
  const t = term.toLowerCase().trim()
  if (a === t) return true
  return t.length >= 3 && (a.includes(t) || t.includes(a))
}

function applyFilter(rows: Row[], filter: Filter): Row[] {
  if (filter.from !== undefined || filter.to !== undefined) {
    const { from, to } = filter
    return rows.filter((r) => {
      const v = r[filter.column]
      if (typeof v !== 'string') return false
      const d = v.slice(0, 10)
      if (from !== undefined && d < from) return false
      if (to !== undefined && d > to) return false
      return true
    })
  }
  if (filter.op) {
    const raw = filter.value ?? (Array.isArray(filter.in) ? filter.in[0] : undefined)
    const t = typeof raw === 'string' ? Number(raw.replace(/,/g, '')) : Number(raw)
    if (!Number.isFinite(t)) return rows
    const op = filter.op
    return rows.filter((r) => {
      const n = num(r[filter.column])
      if (n === null) return false
      switch (op) {
        case '>': return n > t
        case '>=': return n >= t
        case '<': return n < t
        case '<=': return n <= t
        case '==': return n === t
        case '!=': return n !== t
        default: return false
      }
    })
  }
  if (filter.datePart) {
    const set = new Set((filter.in ?? []).map(String))
    return rows.filter((r) => {
      const p = datePartOf(r[filter.column], filter.datePart!) ?? namedPartNum(r[filter.column], filter.datePart!)
      return p !== null && set.has(String(p))
    })
  }
  if (Array.isArray(filter.notIn) && filter.notIn.length > 0) {
    const excluded = filter.notIn.map(String)
    return rows.filter((r) => {
      const v = r[filter.column]
      return !present(v) || !excluded.some((t) => matchesTerm(String(v), t))
    })
  }
  const terms = (filter.in ?? []).map(String)
  return rows.filter((r) => {
    const v = r[filter.column]
    return present(v) && terms.some((t) => matchesTerm(String(v), t))
  })
}

function allFilters(spec: ChartSpec): Filter[] {
  const list: Filter[] = []
  if (Array.isArray(spec.filters)) list.push(...spec.filters)
  if (spec.filter) list.push(spec.filter)
  return list.filter((f) => f && typeof f.column === 'string' && ((typeof f.op === 'string' && Number.isFinite(f.value)) || (Array.isArray(f.in) && f.in.length > 0) || (Array.isArray(f.notIn) && f.notIn.length > 0) || typeof f.from === 'string' || typeof f.to === 'string'))
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
    case 'min': return nums.reduce((a, b) => (b < a ? b : a), Infinity)
    case 'max': return nums.reduce((a, b) => (b > a ? b : a), -Infinity)
    default: return nums[0]
  }
}

function overActive(spec: ChartSpec): boolean {
  return typeof spec.over === 'string' && spec.over.length > 0 && typeof spec.measure === 'string' && !spec.derived && !(Array.isArray(spec.measures) && spec.measures.length > 0)
}

function cellOver(rows: Row[], measure: string, op: ChartSpec['aggregate'], over: string): number | null {
  const totals = new Map<string, number>()
  for (const r of rows) {
    const k = r[over]
    if (!present(k)) continue
    const n = num(r[measure])
    if (n === null) continue
    totals.set(String(k), (totals.get(String(k)) ?? 0) + n)
  }
  const vals = [...totals.values()]
  if (vals.length === 0) return null
  switch (op) {
    case 'min': return vals.reduce((a, b) => (b < a ? b : a), Infinity)
    case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length
    case 'sum': return vals.reduce((a, b) => a + b, 0)
    case 'count': return vals.length
    default: return vals.reduce((a, b) => (b > a ? b : a), -Infinity)
  }
}

function derivedItem(rows: Row[], spec: ChartSpec): { value: number | null; [k: string]: number | null } {
  const n = cell(rows, spec.derived!.numerator, 'sum')
  const d = cell(rows, spec.derived!.denominator, 'sum')
  return { value: n !== null && d !== null && d !== 0 ? n / d : null, [spec.derived!.numerator]: n, [spec.derived!.denominator]: d }
}

function metric(rows: Row[], spec: ChartSpec): number | null {
  if (spec.derived) return derivedItem(rows, spec).value
  if (overActive(spec)) return cellOver(rows, spec.measure, spec.aggregate, spec.over as string)
  return cell(rows, spec.measure, spec.aggregate)
}

function cellValue(rows: Row[], spec: ChartSpec): number | { value: number | null } | null {
  if (spec.derived) return derivedItem(rows, spec)
  if (overActive(spec)) return cellOver(rows, spec.measure, spec.aggregate, spec.over as string)
  return cell(rows, spec.measure, spec.aggregate)
}

function derivedTooltip(spec: ChartSpec): Record<string, unknown> {
  if (!spec.derived) return { trigger: 'axis' }
  const { numerator, denominator } = spec.derived
  const fmt = (n: unknown) => (typeof n === 'number' ? String(Math.round(n * 10000) / 10000) : '-')
  return {
    trigger: 'axis',
    formatter: (ps: Array<{ axisValueLabel?: string; axisValue?: string; marker?: string; seriesName: string; data: Record<string, unknown> }>) => {
      const head = ps[0]?.axisValueLabel ?? ps[0]?.axisValue ?? ''
      const body = ps
        .map((p) => {
          const d = p.data || {}
          return `${p.marker ?? ''}${p.seriesName}: ${fmt(d.value)} (${numerator} ${fmt(d[numerator])} / ${denominator} ${fmt(d[denominator])})`
        })
        .join('<br/>')
      return `${head}<br/>${body}`
    },
  }
}

function grouped(spec: ChartSpec): boolean {
  return typeof spec.series === 'string' && spec.series.length > 0 && spec.series !== spec.x
}

function orderX(spec: ChartSpec, rows: Row[], byX: Map<string, Row[]>, baseVals?: Array<string | number>): Array<string | number> {
  let xVals = baseVals ? [...baseVals] : uniqueInOrder(rows, spec.x)
  if (spec.groupByPart) {
    const part = spec.groupByPart
    if (spec.sort === 'value') {
      const m = typeof spec.measure === 'string' ? spec.measure : (Array.isArray(spec.measures) ? spec.measures[0] : '')
      const total = (xv: string | number) => (spec.derived ? metric(byX.get(String(xv)) ?? [], spec) : overActive(spec) ? cellOver(byX.get(String(xv)) ?? [], m, spec.aggregate, spec.over as string) : cell(byX.get(String(xv)) ?? [], m, spec.aggregate === 'count' ? 'count' : 'sum')) ?? -Infinity
      xVals = [...xVals].sort((a, b) => total(a) - total(b))
      if (spec.order !== 'asc') xVals.reverse()
    } else {
      xVals = [...xVals].sort((a, b) => partRank(String(a), part) - partRank(String(b), part))
      if (spec.order === 'desc') xVals.reverse()
    }
    if (typeof spec.limit === 'number' && spec.limit > 0) xVals = xVals.slice(0, spec.limit)
    return xVals
  }
  const isDate = xVals.length > 0 && xVals.every((v) => typeof v === 'string' && /^\d{4}(-|$)/.test(v))
  const rank = spec.sort === 'value' && (!isDate || typeof spec.limit === 'number')
  if (rank) {
    const m = typeof spec.measure === 'string' ? spec.measure : (Array.isArray(spec.measures) ? spec.measures[0] : '')
    const total = (xv: string | number) => (spec.derived ? metric(byX.get(String(xv)) ?? [], spec) : overActive(spec) ? cellOver(byX.get(String(xv)) ?? [], m, spec.aggregate, spec.over as string) : cell(byX.get(String(xv)) ?? [], m, spec.aggregate === 'count' ? 'count' : 'sum')) ?? -Infinity
    xVals = [...xVals].sort((a, b) => total(a) - total(b))
    if (spec.order !== 'asc') xVals.reverse()
  } else if (isDate) {
    xVals = [...xVals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    if (spec.order === 'desc' && spec.sort !== 'value') xVals.reverse()
  } else if (spec.order === 'desc') {
    xVals = [...xVals].reverse()
  }
  if (typeof spec.limit === 'number' && spec.limit > 0) xVals = xVals.slice(0, spec.limit)
  return xVals
}

function cartesian(spec: ChartSpec, rows: Row[], title: Record<string, unknown>, domainX?: Array<string | number>): EChartsOption {
  const byX = indexBy(rows, spec.x)
  const xVals = orderX(spec, rows, byX, domainX)
  const fill = (grp: Row[]) => (domainX !== undefined && grp.length === 0 ? 0 : cellValue(grp, spec))
  const type = spec.chartType === 'bar' ? 'bar' : 'line'
  const extra: Record<string, unknown> = type === 'line' ? (spec.display?.step ? { step: 'end' } : { smooth: true }) : {}
  if (type === 'line' && xVals.length > 30) extra.showSymbol = false
  if (spec.chartType === 'area') extra.areaStyle = {}
  const measures = Array.isArray(spec.measures) && spec.measures.length > 0 ? spec.measures : null
  const dual = measures !== null && measures.length === 2 && spec.chartType === 'line'
  const stackProp = spec.display?.stacked === true && !dual ? { stack: 'total' } : {}
  let series: unknown[]
  if (measures && grouped(spec)) {
    const key = spec.series as string
    series = uniqueInOrder(rows, key).flatMap((sv) =>
      measures.map((m, i) => ({
        name: `${String(sv)} · ${m}`,
        type,
        data: xVals.map((xv) => cell((byX.get(String(xv)) ?? []).filter((r) => String(r[key]) === String(sv)), m, spec.aggregate)),
        ...extra,
        ...stackProp,
        ...(dual ? { yAxisIndex: i } : {}),
      })),
    )
  } else if (!measures && grouped(spec)) {
    const key = spec.series as string
    series = uniqueInOrder(rows, key).map((sv) => ({
      name: String(sv),
      type,
      data: xVals.map((xv) => fill((byX.get(String(xv)) ?? []).filter((r) => String(r[key]) === String(sv)))),
      ...extra,
      ...stackProp,
    }))
  } else if (measures) {
    series = measures.map((m, i) => ({
      name: m,
      type,
      data: xVals.map((xv) => cell(byX.get(String(xv)) ?? [], m, spec.aggregate)),
      ...extra,
      ...stackProp,
      ...(dual ? { yAxisIndex: i } : {}),
    }))
  } else {
    series = [{ name: spec.derived ? spec.derived.name : (spec.aggregate === 'count' ? 'count' : spec.measure), type, data: xVals.map((xv) => fill(byX.get(String(xv)) ?? [])), ...extra }]
  }
  const yName = !measures ? (spec.derived ? spec.derived.name : spec.aggregate === 'count' ? 'count' : spec.measure) : undefined
  const horizontal = spec.display?.horizontal === true && type === 'bar'
  const catAxis = { type: 'category', data: xVals, name: spec.x, nameLocation: 'middle', nameGap: 30 }
  const valueAxis = dual
    ? [{ type: 'value', name: measures![0] }, { type: 'value', name: measures![1] }]
    : { type: 'value', name: yName }
  const option: Record<string, unknown> = {
    ...title,
    tooltip: derivedTooltip(spec),
    grid: { bottom: 48 },
    xAxis: horizontal ? valueAxis : catAxis,
    yAxis: horizontal ? catAxis : valueAxis,
    series,
  }
  if (series.length > 1) option.legend = {}
  return option as EChartsOption
}

function pie(spec: ChartSpec, rows: Row[], title: Record<string, unknown>): EChartsOption {
  const byX = indexBy(rows, spec.x)
  const data = orderX(spec, rows, byX)
    .map((xv) => ({ name: String(xv), value: metric(byX.get(String(xv)) ?? [], spec) }))
    .filter((d) => typeof d.value === 'number' && d.value > 0)
  const radius = spec.display?.donut === true ? ['40%', '70%'] : '60%'
  const rose = spec.display?.rose === true ? { roseType: 'area' } : {}
  const option: Record<string, unknown> = {
    ...title,
    tooltip: { trigger: 'item' },
    legend: {},
    series: [{ type: 'pie', radius, ...rose, data }],
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

function emptyOption(spec: ChartSpec): EChartsOption {
  const title: Record<string, unknown> = { title: { text: spec.title ? `${spec.title} — no matching data` : 'No matching data', left: 'center' } }
  if (spec.chartType === 'pie') return { ...title, series: [{ type: 'pie', data: [] }] } as EChartsOption
  if (spec.chartType === 'scatter') return { ...title, xAxis: { type: 'value' }, yAxis: { type: 'value' }, series: [{ type: 'scatter', data: [] }] } as EChartsOption
  const type = spec.chartType === 'bar' ? 'bar' : 'line'
  return { ...title, xAxis: { type: 'category', data: [] }, yAxis: { type: 'value' }, series: [{ type, data: [] }] } as EChartsOption
}

function categoricalDomain(spec: ChartSpec, rows: Row[], filters: Filter[]): Array<string | number> | undefined {
  if (spec.chartType === 'pie' || spec.chartType === 'scatter') return undefined
  if (spec.groupByPart || spec.bucket) return undefined
  if (spec.aggregate !== 'count') return undefined
  if (spec.derived || (Array.isArray(spec.measures) && spec.measures.length > 0)) return undefined
  if (typeof spec.x !== 'string') return undefined
  let categorical = false
  for (const r of rows) {
    const v = r[spec.x]
    if (!present(v)) continue
    categorical = !(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))
    break
  }
  if (!categorical) return undefined
  let domainRows = rows
  for (const f of filters) if (f.column === spec.x || f.column === spec.series) domainRows = applyFilter(domainRows, f)
  const dom = uniqueInOrder(domainRows, spec.x)
  return dom.length > 0 ? dom : undefined
}

function resolvePick(spec: ChartSpec, rows: Row[]): ChartSpec {
  const p = spec.pick
  const rest: ChartSpec = { ...spec }
  delete rest.pick
  if (!p || typeof p.column !== 'string' || typeof p.by !== 'string') return rest
  const candidates = p.where ? applyFilter(rows, p.where) : rows
  const totals = new Map<string, number>()
  const counts = new Map<string, number>()
  for (const r of candidates) {
    const key = p.datePart
      ? ((d) => (d === null ? null : String(d)))(datePartOf(r[p.column], p.datePart) ?? namedPartNum(r[p.column], p.datePart))
      : (present(r[p.column]) ? String(r[p.column]) : null)
    if (key === null) continue
    const n = num(r[p.by])
    if (n === null) continue
    totals.set(key, (totals.get(key) ?? 0) + n)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (totals.size === 0) return rest
  let best: string | null = null
  let bestVal = p.extreme === 'min' ? Infinity : -Infinity
  for (const [k, sum] of totals) {
    const val = p.agg === 'avg' ? sum / (counts.get(k) ?? 1) : sum
    if (p.extreme === 'min' ? val < bestVal : val > bestVal) { bestVal = val; best = k }
  }
  if (best === null) return rest
  const pickFilter: Filter = p.datePart ? { column: p.column, datePart: p.datePart, in: [Number(best)] } : { column: p.column, in: [best] }
  return { ...rest, filters: [...(Array.isArray(rest.filters) ? rest.filters : []), pickFilter] }
}

export function buildChartOption(spec: ChartSpec, rows: Row[], emptyOk = false): EChartsOption {
  if (!spec.aggregate) spec = { ...spec, aggregate: 'sum' }
  if (spec.pick) spec = resolvePick(spec, rows)
  const columns = new Set(Object.keys(rows[0] ?? {}))
  const hasMeasures = Array.isArray(spec.measures) && spec.measures.length > 0
  const hasDerived = !!spec.derived && typeof spec.derived.numerator === 'string' && typeof spec.derived.denominator === 'string'
  if (spec.aggregate !== 'count' && typeof spec.measure !== 'string' && !hasMeasures && !hasDerived) throw new Error('Spec must specify a measure')
  const required: string[] = [spec.x]
  if (typeof spec.measure === 'string') required.push(spec.measure)
  if (hasMeasures) required.push(...(spec.measures as string[]))
  if (hasDerived) required.push(spec.derived!.numerator, spec.derived!.denominator)
  if (grouped(spec)) required.push(spec.series as string)
  if (typeof spec.over === 'string') required.push(spec.over)
  const filters = allFilters(spec)
  for (const f of filters) required.push(f.column)
  for (const key of required) {
    if (typeof key !== 'string' || !columns.has(key)) throw new Error(`Spec refers to unknown column "${key}"`)
  }
  let data = rows
  for (const f of filters) data = applyFilter(data, f)
  if (data.length === 0) {
    if (emptyOk) return emptyOption(spec)
    throw new Error('Filter matched no rows')
  }
  if (spec.groupByPart) {
    const part = spec.groupByPart
    data = data.map((r) => {
      const lbl = cyclicLabel(r[spec.x], part)
      return lbl === null ? r : { ...r, [spec.x]: lbl }
    })
  } else if (spec.bucket && !filters.some((f) => f.datePart === 'day')) {
    data = data.map((r) => {
      const b = bucketOf(r[spec.x], spec.bucket as 'week' | 'month' | 'quarter' | 'year')
      return b === null ? r : { ...r, [spec.x]: b }
    })
  }
  const title: Record<string, unknown> = spec.title ? { title: { text: spec.title } } : {}
  if (spec.chartType === 'scatter') return scatter(spec, data, title)
  if (spec.chartType === 'pie') return pie(spec, data, title)
  return cartesian(spec, data, title, categoricalDomain(spec, rows, filters))
}
