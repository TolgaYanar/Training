import type { ChartSpec, EChartsOption, Filter, Row } from './types'
import type { FieldMeta } from './schema'
import type { Chip, ResolvedFilter, ResolvedRequest } from './resolve'
import type { Agg, Bucket, ChartKind, RequestInput } from './request'
import { buildChartOption } from './chart.ts'

const GRAFIK: Record<ChartKind, ChartSpec['chartType']> = {
  'çizgi': 'line', 'çubuk': 'bar', 'alan': 'area', 'pasta': 'pie', 'dağılım': 'scatter',
}
const TOPLA: Record<Agg, ChartSpec['aggregate']> = {
  toplam: 'sum', ortalama: 'avg', adet: 'count', min: 'min', maks: 'max',
}
const GRUPLA: Partial<Record<Bucket, 'week' | 'month' | 'quarter' | 'year'>> = {
  hafta: 'week', ay: 'month', 'çeyrek': 'quarter', 'yıl': 'year',
}

function green(chip: Chip | undefined): FieldMeta | undefined {
  return chip && chip.state === 'green' ? chip.field : undefined
}

function relabelEnums(rows: Row[], fields: (FieldMeta | undefined)[]): Row[] {
  const maps = fields
    .filter((f): f is FieldMeta => !!f && !!f.enumKeys)
    .map((f) => ({ key: f.anahtar, m: new Map(f.enumKeys!.map((k) => [k.value, k.label])) }))
  if (maps.length === 0) return rows
  return rows.map((row) => {
    const out = { ...row }
    for (const { key, m } of maps) {
      const v = out[key] as number | string
      if (m.has(v)) out[key] = m.get(v)!
    }
    return out
  })
}

function toFilter(rf: ResolvedFilter): Filter | null {
  const f = green(rf.field)
  if (!f) return null
  if (rf.op === '=') return { column: f.anahtar, in: [rf.value] }
  if (rf.op === '!=') return { column: f.anahtar, notIn: [rf.value] }
  return { column: f.anahtar, op: rf.op, value: Number(rf.value) }
}

export function requestToSpec(req: RequestInput, resolved: ResolvedRequest): { spec: ChartSpec; enumFields: (FieldMeta | undefined)[] } | { error: string } {
  if (resolved.blocked) return { error: 'İstem çözülemedi.' }
  const x = green(resolved.x)
  if (!x) return { error: 'x ekseni çözülemedi.' }
  const measure = green(resolved.olcu)
  const series = green(resolved.seri)

  const spec: ChartSpec = {
    chartType: (req.grafik && GRAFIK[req.grafik]) || (x.type === 'date' ? 'line' : 'bar'),
    x: x.anahtar,
    measure: (measure ?? x).anahtar,
    aggregate: measure ? (req.topla && TOPLA[req.topla]) || 'sum' : 'count',
  }
  if (series) spec.series = series.anahtar
  if (resolved.grupla && resolved.gruplaOk) {
    const b = GRUPLA[resolved.grupla]
    if (b) spec.bucket = b
  }
  if (req.sirala) {
    spec.sort = 'value'
    spec.order = req.sirala.yon === 'azalan' ? 'desc' : 'asc'
    if (req.sirala.ilk) spec.limit = req.sirala.ilk
  }
  const filters = resolved.filtre.map(toFilter).filter((f): f is Filter => !!f)
  if (filters.length > 0) spec.filters = filters

  return { spec, enumFields: [x, series, ...resolved.filtre.map((rf) => green(rf.field))] }
}

export function renderChart(spec: ChartSpec, rows: Row[], enumFields: (FieldMeta | undefined)[]): { option: EChartsOption } | { error: string } {
  const relabeled = relabelEnums(rows, enumFields)
  try {
    return { option: buildChartOption(spec, relabeled, false) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export function buildRequestChart(req: RequestInput, resolved: ResolvedRequest, rows: Row[]): { option: EChartsOption; spec: ChartSpec } | { error: string } {
  const s = requestToSpec(req, resolved)
  if ('error' in s) return s
  const r = renderChart(s.spec, rows, s.enumFields)
  if ('error' in r) return r
  return { option: r.option, spec: s.spec }
}

const CHART_TR: Record<string, string> = { line: 'çizgi', bar: 'çubuk', area: 'alan', pie: 'pasta', scatter: 'dağılım' }
const AGG_TR: Record<string, string> = { sum: 'toplam', avg: 'ortalama', count: 'adet', min: 'en az', max: 'en çok', maks: 'en çok' }
const BUCKET_TR: Record<string, string> = { week: 'haftalık', month: 'aylık', quarter: 'çeyrek', year: 'yıllık' }

export function describeSpec(spec: ChartSpec, byAnahtar: Map<string, FieldMeta>): { etiket: string; deger: string }[] {
  const name = (a?: string): string => (a ? byAnahtar.get(a)?.baslik ?? a : '')
  const out: { etiket: string; deger: string }[] = []
  out.push({ etiket: 'Grafik türü', deger: CHART_TR[spec.chartType] ?? spec.chartType })
  out.push({ etiket: 'X ekseni', deger: name(spec.x) })
  if (spec.aggregate === 'count' || !spec.measure) out.push({ etiket: 'Y ekseni (ölçü)', deger: 'kayıt adedi (adet)' })
  else out.push({ etiket: 'Y ekseni (ölçü)', deger: `${name(spec.measure)} · ${AGG_TR[spec.aggregate ?? 'sum'] ?? spec.aggregate}` })
  if (spec.series) out.push({ etiket: 'Seri (ayrım)', deger: name(spec.series) })
  if (spec.bucket) out.push({ etiket: 'Zaman gruplama', deger: BUCKET_TR[spec.bucket] ?? spec.bucket })
  if (spec.limit) out.push({ etiket: 'Sıralama', deger: `${spec.order === 'desc' ? 'en çok' : 'en az'} ${spec.limit}` })
  for (const f of spec.filters ?? []) {
    const vals = (f.in ?? f.notIn ?? (f.value !== undefined ? [f.value] : [])).join(', ')
    out.push({ etiket: 'Filtre', deger: `${name(f.column)} ${f.notIn ? '≠' : f.op ?? '='} ${vals}` })
  }
  return out
}
