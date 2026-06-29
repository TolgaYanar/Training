import type { ChartSpec, Filter, Row } from './types'

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const ORDINAL_QUARTER: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 }

type DatePart = 'day' | 'weekday' | 'month' | 'quarter'

function isDateColumn(rows: Row[], col: string): boolean {
  for (const r of rows) {
    const v = r[col]
    if (v === null || v === undefined || v === '') continue
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
  }
  return false
}

function dataYear(rows: Row[], col: string): number | null {
  for (const r of rows) {
    const v = r[col]
    if (typeof v === 'string') { const m = v.match(/^(\d{4})-/); if (m) return Number(m[1]) }
  }
  return null
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function parseDateExpr(expr: string, year: number): string | null {
  const iso = expr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${pad2(Number(iso[2]))}-${pad2(Number(iso[3]))}`
  const low = expr.toLowerCase()
  let month: number | null = null
  for (let i = 0; i < MONTHS.length; i++) if (new RegExp(`\\b(?:${MONTHS[i]}|${MONTH_ABBR[i]})\\b`).test(low)) { month = i + 1; break }
  const day = low.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/)
  if (month !== null && day) { const d = Number(day[1]); if (d >= 1 && d <= 31) return `${year}-${pad2(month)}-${pad2(d)}` }
  return null
}

function detectRange(prompt: string, year: number): { from?: string; to?: string } | null {
  const order = (a: string, b: string) => (a <= b ? { from: a, to: b } : { from: b, to: a })
  const iso = prompt.match(/(\d{4}-\d{1,2}-\d{1,2})\s*(?:to|until|through|and|-|–)\s*(\d{4}-\d{1,2}-\d{1,2})/i)
  if (iso) { const a = parseDateExpr(iso[1], year), b = parseDateExpr(iso[2], year); if (a && b) return order(a, b) }
  const nat = prompt.match(/\b(?:between|from)\s+(.+?)\s+(?:and|to|until|through)\s+(.+?)(?=\s+(?:as|line|chart|daily|by|over|per|in)\b|[,.]|$)/i)
  if (nat) { const a = parseDateExpr(nat[1], year), b = parseDateExpr(nat[2], year); if (a && b) return order(a, b) }
  const after = prompt.match(/\b(?:after|since|starting(?:\s+from)?|on or after|from)\s+(\d{4}-\d{1,2}-\d{1,2})/i)
  if (after) { const a = parseDateExpr(after[1], year); if (a) return { from: a } }
  const before = prompt.match(/\b(?:before|until|up to|by|through|prior to|on or before|ending)\s+(\d{4}-\d{1,2}-\d{1,2})/i)
  if (before) { const b = parseDateExpr(before[1], year); if (b) return { to: b } }
  const on = prompt.match(/\b(?:just\s+)?on\s+(?:just\s+)?(\d{4}-\d{1,2}-\d{1,2})\b/i)
  if (on) { const a = parseDateExpr(on[1], year); if (a) return { from: a, to: a } }
  return null
}

function datePartValues(prompt: string, part: DatePart): number[] {
  const low = prompt.toLowerCase()
  const out: number[] = []
  if (part === 'month') {
    for (let i = 0; i < MONTHS.length; i++) if (new RegExp(`\\b(?:${MONTHS[i]}|${MONTH_ABBR[i]})\\b`).test(low)) out.push(i + 1)
  } else if (part === 'weekday') {
    for (let i = 0; i < WEEKDAYS.length; i++) if (new RegExp(`\\b${WEEKDAYS[i]}s?\\b`).test(low)) out.push(i)
  } else if (part === 'quarter') {
    const q = low.match(/\bq([1-4])\b/)
    if (q) out.push(Number(q[1]))
    const w = low.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter\b/)
    if (w && !out.includes(ORDINAL_QUARTER[w[1]])) out.push(ORDINAL_QUARTER[w[1]])
  } else {
    const d = low.match(/\bday\s+(\d{1,2})\b/) || low.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/)
    if (d) { const n = Number(d[1]); if (n >= 1 && n <= 31) out.push(n) }
  }
  return out
}

function datePartNum(v: unknown, part: DatePart): number | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return null
  if (part === 'day') return Number(m[3])
  if (part === 'month') return Number(m[2])
  if (part === 'quarter') return Math.ceil(Number(m[2]) / 3)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
}

function matchColumn(word: string, cols: string[]): string | null {
  const w = word.toLowerCase()
  for (const c of cols) {
    const cl = c.toLowerCase()
    if (cl === w || (w.length >= 4 && (w.startsWith(cl) || cl.startsWith(w)))) return c
  }
  return null
}

function argmaxKey(rows: Row[], keyOf: (r: Row) => string | null, measure: string, avg: boolean, min: boolean): string | null {
  const sums = new Map<string, number>()
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = keyOf(r)
    if (k === null) continue
    const v = r[measure]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    sums.set(k, (sums.get(k) ?? 0) + v)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let best: string | null = null
  let bestVal = min ? Infinity : -Infinity
  for (const [k, s] of sums) {
    const val = avg ? s / (counts.get(k) ?? 1) : s
    if (min ? val < bestVal : val > bestVal) { bestVal = val; best = k }
  }
  return best
}

function topNGroups(rows: Row[], groupCol: string, measure: string, n: number, min: boolean): string[] {
  const sums = new Map<string, number>()
  for (const r of rows) {
    const k = r[groupCol]
    if (k === null || k === undefined || k === '') continue
    const v = r[measure]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    sums.set(String(k), (sums.get(String(k)) ?? 0) + v)
  }
  return [...sums.entries()].sort((a, b) => (min ? a[1] - b[1] : b[1] - a[1])).slice(0, n).map((e) => e[0])
}

function detectTopN(prompt: string, numCols: string[], catCols: string[]): { n: number; groupCol: string; measureCol: string; min: boolean } | null {
  const m1 = prompt.match(/\b(?:the\s+)?(?:top\s+)?(\d+)\s+(\w+?)s?\s+(?:with|having)\s+the\s+(most|highest|largest|greatest|biggest|best|least|lowest|fewest|smallest|worst)\s+(?:total\s+|overall\s+|combined\s+|average\s+|avg\s+|mean\s+)?(\w+)\b/i)
  const m2 = m1 ? null : prompt.match(/\btop\s+(\d+)\s+(\w+?)s?\s+by\s+(?:total\s+|overall\s+|combined\s+|average\s+|avg\s+|mean\s+)?(\w+)\b/i)
  let n = 0
  let gw = ''
  let mw = ''
  let min = false
  if (m1) { n = Number(m1[1]); gw = m1[2]; mw = m1[4]; min = /^(least|lowest|fewest|smallest|worst)/i.test(m1[3]) }
  else if (m2) { n = Number(m2[1]); gw = m2[2]; mw = m2[3] }
  else return null
  if (!(n >= 1)) return null
  const groupCol = matchColumn(gw, catCols)
  const measureCol = matchColumn(mw, numCols)
  if (!groupCol || !measureCol) return null
  return { n, groupCol, measureCol, min }
}

export function enforceArgmaxFilter(spec: ChartSpec, prompt: string, rows: Row[]): ChartSpec {
  const cols = Object.keys(rows[0] ?? {})
  const numCols = cols.filter((c) => {
    let saw = false
    for (const r of rows) {
      const v = r[c]
      if (v === null || v === undefined || v === '') continue
      if (typeof v !== 'number') return false
      saw = true
    }
    return saw
  })
  const catCols = cols.filter((c) => !numCols.includes(c) && !isDateColumn(rows, c))
  const topN = detectTopN(prompt, numCols, catCols)
  if (topN) {
    const vals = topNGroups(rows, topN.groupCol, topN.measureCol, topN.n, topN.min)
    if (vals.length > 0) {
      const kept = (Array.isArray(spec.filters) ? spec.filters : []).filter((f) => f && f.column !== topN.groupCol)
      const out: ChartSpec = { ...spec, filters: [...kept, { column: topN.groupCol, in: vals }] }
      if (topN.groupCol !== spec.x) { out.series = topN.groupCol; out.limit = undefined; out.sort = undefined; out.order = undefined }
      return out
    }
  }
  const m = prompt.match(/\b(?:the|which|whichever)\s+(\w+)\s+(?:with|having|(?:that\s+)?(?:has|had|gets?|sells?|generates?|makes?|brings?(?:\s+in)?))\s+the\s+(most|highest|largest|greatest|biggest|top|max(?:imum)?|best|least|lowest|fewest|smallest|min(?:imum)?|worst)\b/i)
  if (!m) return spec
  const start = (m.index ?? 0) + m[0].length
  const window = prompt.slice(start, start + 40).toLowerCase()
  let measureCol: string | null = null
  let bestPos = Infinity
  for (const c of numCols) { const p = window.indexOf(c.toLowerCase()); if (p >= 0 && p < bestPos) { bestPos = p; measureCol = c } }
  if (!measureCol) return spec
  const avg = /\b(average|avg|mean)\b/.test(window)
  const min = /^(least|lowest|fewest|smallest|min|worst)/i.test(m[2])
  const groupWord = m[1].toLowerCase()
  const catCol = matchColumn(groupWord, catCols)
  const dateCol = cols.find((c) => isDateColumn(rows, c))
  const parts: Record<string, DatePart> = { month: 'month', quarter: 'quarter', weekday: 'weekday', day: 'day' }
  let added: Filter | null = null
  let part: DatePart | null = null
  if (catCol) {
    const best = argmaxKey(rows, (r) => { const v = r[catCol]; return v === null || v === undefined || v === '' ? null : String(v) }, measureCol, avg, min)
    if (best !== null) added = { column: catCol, in: [best] }
  } else if (dateCol && parts[groupWord]) {
    part = parts[groupWord]
    const best = argmaxKey(rows, (r) => { const p = datePartNum(r[dateCol], part!); return p === null ? null : String(p) }, measureCol, avg, min)
    if (best !== null) added = { column: dateCol, datePart: part, in: [Number(best)] }
  }
  if (!added) return spec
  const sameDim = (f: Filter | undefined): boolean => {
    if (!f) return false
    if (part) return f.datePart === part && typeof f.column === 'string' && isDateColumn(rows, f.column)
    return f.column === added!.column && Array.isArray(f.in)
  }
  const kept = (Array.isArray(spec.filters) ? spec.filters : []).filter((f) => f && !sameDim(f))
  const out: ChartSpec = { ...spec, filters: [...kept, added] }
  if (sameDim(spec.filter)) out.filter = undefined
  return out
}

function desiredBucket(prompt: string): 'week' | 'month' | 'quarter' | 'year' | null {
  if (/\b(weekly|(?:per|by|each|every) week)\b/i.test(prompt)) return 'week'
  if (/\b(monthly|(?:per|by|each|every) month)\b/i.test(prompt)) return 'month'
  if (/\b(quarterly|(?:per|by|each|every) quarter)\b/i.test(prompt)) return 'quarter'
  if (/\b(yearly|annual(?:ly)?|(?:per|by|each|every) year)\b/i.test(prompt)) return 'year'
  return null
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function monthNum(word: string): number | null {
  const w = word.toLowerCase()
  const i = MONTH_NAMES.findIndex((m) => m === w || (w.length >= 3 && m.slice(0, 3) === w.slice(0, 3)))
  return i < 0 ? null : i + 1
}
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
function isoDay(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}
function shiftDate(isoStr: string, days: number): string {
  const d = new Date(isoStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function extentDate(rows: Row[], col: string, max: boolean): string | null {
  let out = ''
  for (const r of rows) { const v = r[col]; if (typeof v === 'string') { const d = v.slice(0, 10); if (out === '' || (max ? d > out : d < out)) out = d } }
  return out || null
}

function detectTimeWindow(prompt: string, rows: Row[]): Filter | null {
  const cols = Object.keys(rows[0] ?? {})
  const dateCol = cols.find((c) => isDateColumn(rows, c))
  if (!dateCol) return null
  const year = dataYear(rows, dateCol)
  if (year === null) return null
  const low = prompt.toLowerCase()
  const fw = low.match(/\b(first|last) week of (\w+)/)
  if (fw) { const mo = monthNum(fw[2]); if (mo) { const ld = lastDay(year, mo); return fw[1] === 'first' ? { column: dateCol, from: isoDay(year, mo, 1), to: isoDay(year, mo, Math.min(7, ld)) } : { column: dateCol, from: isoDay(year, mo, ld - 6), to: isoDay(year, mo, ld) } } }
  const fn = low.match(/\b(first|last) (\d{1,2}) days? of (\w+)/)
  if (fn) { const n = Number(fn[2]); const mo = monthNum(fn[3]); if (mo && n >= 1) { const ld = lastDay(year, mo); return fn[1] === 'first' ? { column: dateCol, from: isoDay(year, mo, 1), to: isoDay(year, mo, Math.min(n, ld)) } : { column: dateCol, from: isoDay(year, mo, Math.max(1, ld - n + 1)), to: isoDay(year, mo, ld) } } }
  const ld2 = low.match(/\b(?:last|past|trailing|previous|recent) (\d{1,3}) days?\b/)
  if (ld2) { const mx = extentDate(rows, dateCol, true); if (mx) return { column: dateCol, from: shiftDate(mx, -(Number(ld2[1]) - 1)), to: mx } }
  const lw = low.match(/\b(?:last|past|trailing|previous|recent) (\d{1,2}) weeks?\b/)
  if (lw) { const mx = extentDate(rows, dateCol, true); if (mx) return { column: dateCol, from: shiftDate(mx, -(Number(lw[1]) * 7 - 1)), to: mx } }
  const fwGen = low.match(/\b(first|last) week\b/)
  if (fwGen) { const mn = extentDate(rows, dateCol, false); const mx = extentDate(rows, dateCol, true); if (mn && mx) return fwGen[1] === 'first' ? { column: dateCol, from: mn, to: shiftDate(mn, 6) } : { column: dateCol, from: shiftDate(mx, -6), to: mx } }
  const wof = low.match(/\bweek of (\d{4}-\d{1,2}-\d{1,2})\b/)
  if (wof) { const s = parseDateExpr(wof[1], year); if (s) return { column: dateCol, from: s, to: shiftDate(s, 6) } }
  return null
}

export function enforceDateFilters(spec: ChartSpec, prompt: string, rows: Row[]): ChartSpec {
  const cols = Object.keys(rows[0] ?? {})
  const xIsDate = typeof spec.x === 'string' && isDateColumn(rows, spec.x)
  const dateCol = xIsDate ? (spec.x as string) : cols.find((c) => isDateColumn(rows, c))
  if (!dateCol) return spec
  if (xIsDate) {
    const wantsCoarser = /\b(weekly|monthly|quarterly|yearly|annual(?:ly)?|(?:per|by|each|every) (?:week|month|quarter|year))\b/i.test(prompt)
    if (spec.bucket && !wantsCoarser) spec = { ...spec, bucket: undefined }
    if (!spec.bucket && !spec.groupByPart) {
      const b = desiredBucket(prompt)
      if (b) spec = { ...spec, bucket: b }
    }
  }
  const onDate = (f: Filter | undefined): boolean => !!f && typeof f.column === 'string' && isDateColumn(rows, f.column)
  const year = dataYear(rows, dateCol)
  const range = year !== null ? detectRange(prompt, year) : null
  const windowFilter: Filter | null = range ? { column: dateCol, from: range.from, to: range.to } : detectTimeWindow(prompt, rows)
  if (windowFilter) {
    const kept = (Array.isArray(spec.filters) ? spec.filters : []).filter((f) => f && !onDate(f))
    const out: ChartSpec = { ...spec, filters: [...kept, windowFilter] }
    out.filter = spec.filter && !onDate(spec.filter) ? spec.filter : undefined
    return out
  }
  const fill = (f: Filter): Filter => {
    if (!f.datePart || (Array.isArray(f.in) && f.in.length > 0)) return f
    const vals = datePartValues(prompt, f.datePart)
    return vals.length ? { ...f, in: vals } : f
  }
  const out: ChartSpec = { ...spec }
  if (spec.filter) out.filter = fill(spec.filter)
  if (Array.isArray(spec.filters)) out.filters = spec.filters.map((f) => (f ? fill(f) : f))
  const present = (part: DatePart): boolean => {
    const all = [...(Array.isArray(out.filters) ? out.filters : []), ...(out.filter ? [out.filter] : [])]
    return all.some((f) => f && f.datePart === part)
  }
  for (const part of ['month', 'weekday', 'quarter'] as DatePart[]) {
    if (present(part)) continue
    const vals = datePartValues(prompt, part)
    if (vals.length) out.filters = [...(Array.isArray(out.filters) ? out.filters : []), { column: dateCol, datePart: part, in: vals }]
  }
  return out
}
