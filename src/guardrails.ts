import type { ChartSpec, Filter, Row } from './types'

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MON_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const ORD_Q: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, last: 4 }

function isDateCol(rows: Row[], col: string): boolean {
  for (const r of rows) { const v = r[col]; if (v == null || v === '') continue; return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) }
  return false
}

function allFilters(spec: ChartSpec): Filter[] {
  return [...(Array.isArray(spec.filters) ? spec.filters : []), ...(spec.filter ? [spec.filter] : [])].filter(Boolean) as Filter[]
}
const hasDatePart = (spec: ChartSpec, part: string) => allFilters(spec).some((f) => f.datePart === part)

// "May" the month vs "may" the verb: index 4 requires a capitalized "May" in the original text.
function monthIndices(prompt: string): number[] {
  const low = prompt.toLowerCase()
  const out: number[] = []
  for (let i = 0; i < 12; i++) {
    if (i === 4) { if (/\bMay\b/.test(prompt)) out.push(5); continue }
    if (new RegExp(`\\b(?:${MONTHS[i]}|${MON_ABBR[i]})\\b`).test(low)) out.push(i + 1)
  }
  return out
}
function quarterNums(low: string): number[] {
  const out = new Set<number>()
  for (const m of low.matchAll(/\bq([1-4])\b/g)) out.add(Number(m[1]))
  for (const m of low.matchAll(/\b(first|second|third|fourth|last|1st|2nd|3rd|4th)\s+quarter\b/g)) out.add(ORD_Q[m[1]])
  return [...out]
}
function weekdayNums(low: string): number[] {
  const out: number[] = []
  for (let i = 0; i < 7; i++) if (new RegExp(`\\b${WEEKDAYS[i]}s?\\b`).test(low)) out.push(i)
  return out
}

function distinctVals(rows: Row[], col: string): Array<string | number> | null {
  const seen = new Set<string>(); const out: Array<string | number> = []
  for (const r of rows) { const v = r[col]; if (v == null || v === '') continue; if (typeof v === 'number') return null; if (!seen.has(v)) { seen.add(v); out.push(v) } }
  return out
}
function namedValues(prompt: string, rows: Row[], col: string): Array<string | number> {
  const vals = distinctVals(rows, col)
  if (!vals) return []
  const out: Array<string | number> = []
  for (const v of vals) {
    const sv = String(v).toLowerCase()
    const mi = MON_ABBR.indexOf(sv)
    if (mi === 4) { if (/\bMay\b/.test(prompt)) out.push(v); continue }
    const pat = mi >= 0 ? `(?:${MONTHS[mi]}|${MON_ABBR[mi]})` : sv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${pat}\\b`, 'i').test(prompt)) out.push(v)
  }
  return out
}

// AI-first: only ADD a clearly-named filter the model OMITTED; never override what it emitted.
export function enforceNamedFilters(spec: ChartSpec, prompt: string, rows: Row[]): ChartSpec {
  if (!rows.length) return spec
  const low = prompt.toLowerCase()
  const cols = Object.keys(rows[0])
  let out: ChartSpec = { ...spec }
  const add = (f: Filter) => { out = { ...out, filters: [...(Array.isArray(out.filters) ? out.filters : []), f] } }

  const dateCol = typeof out.x === 'string' && isDateCol(rows, out.x) ? out.x : cols.find((c) => isDateCol(rows, c))
  if (dateCol && out.groupByPart == null) {
    const qs = quarterNums(low); if (qs.length && !hasDatePart(out, 'quarter')) add({ column: dateCol, datePart: 'quarter', in: qs })
    const ms = monthIndices(prompt); if (ms.length && !hasDatePart(out, 'month') && !hasDatePart(out, 'quarter')) add({ column: dateCol, datePart: 'month', in: ms })
    const ws = weekdayNums(low); if (ws.length && !hasDatePart(out, 'weekday')) add({ column: dateCol, datePart: 'weekday', in: ws })
  }

  for (const col of cols) {
    if (col === out.x || col === out.series || col === dateCol) continue
    if (allFilters(out).some((f) => f.column === col)) continue
    const total = distinctVals(rows, col)
    if (!total) continue
    const hits = namedValues(prompt, rows, col)
    if (hits.length > 0 && hits.length < total.length) add({ column: col, in: hits })
  }
  return out
}
