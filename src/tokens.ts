import type { ChartSpec, DataSummary, Filter, Row } from './types'

const VALUE_TOTAL_CAP = 5000
const VALUE_LIST_MAX = 20
const WORD = 'A-Za-z0-9_'
const UWORD = '\\p{L}\\p{M}\\p{N}_'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ISO_DATE = new RegExp(`(?<![${WORD}])\\d{4}-\\d{1,2}-\\d{1,2}(?:[ T]\\d{2}:\\d{2}(?::\\d{2})?)?(?![${WORD}])`, 'g')
const GROUPED_NUMBER = new RegExp(`(?<![${WORD}.])\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?(?![${WORD}])`, 'g')
const SEPARATED_DIGITS = new RegExp(`(?<![${WORD}.])\\d{2,}(?:[-.]\\d{2,})+(?![${WORD}.])`, 'g')
const DECIMAL = new RegExp(`(?<![${WORD}.])\\d+\\.\\d+(?![${WORD}.])`, 'g')
const LONG_NUMBER = new RegExp(`(?<![${WORD}.])\\d{4,}(?![${WORD}])`, 'g')
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const URL = /(?:https?:\/\/|www\.)[^\s]+/gi

export function redactLiterals(text: string, toReal: Record<string, string>): string {
  let next = Object.keys(toReal).filter((k) => k.startsWith('lit_')).length
  const tokenFor = (literal: string): string => {
    for (const [k, v] of Object.entries(toReal)) {
      if (k.startsWith('lit_') && v === literal) return k
    }
    const token = `lit_${next++}`
    toReal[token] = literal
    return token
  }
  return text
    .replace(EMAIL, tokenFor)
    .replace(URL, tokenFor)
    .replace(ISO_DATE, tokenFor)
    .replace(GROUPED_NUMBER, tokenFor)
    .replace(SEPARATED_DIGITS, tokenFor)
    .replace(DECIMAL, tokenFor)
    .replace(LONG_NUMBER, tokenFor)
}

export function tokenizeSchema(summary: DataSummary): { summary: DataSummary; toReal: Record<string, string> } {
  const toReal: Record<string, string> = {}
  const columns = summary.columns.map((c, i) => {
    const token = `col_${i}`
    toReal[token] = c.name
    return { ...c, name: token }
  })
  return { summary: { ...summary, columns }, toReal }
}

function groupedToNumber(s: string): number {
  return Number(s.replace(/,/g, ''))
}

function coerceLiteral(s: string): string | number {
  return /^\d{4}-\d{1,2}-\d{1,2}/.test(s) ? s : groupedToNumber(s)
}

export function detokenizeSpec(spec: ChartSpec, toReal: Record<string, string>): ChartSpec {
  const real = (v: string): string => toReal[v] ?? v
  const out: ChartSpec = { ...spec }
  if (typeof spec.x === 'string') out.x = real(spec.x)
  if (typeof spec.measure === 'string') out.measure = real(spec.measure)
  if (Array.isArray(spec.measures)) out.measures = spec.measures.map((m) => (typeof m === 'string' ? real(m) : m))
  if (typeof spec.series === 'string') out.series = real(spec.series)
  if (typeof spec.over === 'string') out.over = real(spec.over)
  const realFilter = (f: Filter): Filter => ({
    ...f,
    column: typeof f.column === 'string' ? real(f.column) : f.column,
    in: Array.isArray(f.in) ? f.in.map((v) => (typeof v === 'string' ? real(v) : v)) : f.in,
    notIn: Array.isArray(f.notIn) ? f.notIn.map((v) => (typeof v === 'string' ? real(v) : v)) : f.notIn,
    value: typeof f.value === 'string' ? coerceLiteral(real(f.value)) : f.value,
    from: typeof f.from === 'string' ? real(f.from) : f.from,
    to: typeof f.to === 'string' ? real(f.to) : f.to,
  })
  if (spec.filter && typeof spec.filter.column === 'string') out.filter = realFilter(spec.filter)
  if (Array.isArray(spec.filters)) out.filters = spec.filters.map((f) => (f && typeof f.column === 'string' ? realFilter(f) : f))
  if (typeof spec.title === 'string') out.title = detokenizeText(spec.title, toReal)
  if (spec.derived) {
    out.derived = {
      ...spec.derived,
      name: typeof spec.derived.name === 'string' ? detokenizeText(spec.derived.name, toReal) : spec.derived.name,
      numerator: typeof spec.derived.numerator === 'string' ? real(spec.derived.numerator) : spec.derived.numerator,
      denominator: typeof spec.derived.denominator === 'string' ? real(spec.derived.denominator) : spec.derived.denominator,
    }
  }
  if (spec.pick && typeof spec.pick.column === 'string') {
    out.pick = {
      ...spec.pick,
      column: real(spec.pick.column),
      by: typeof spec.pick.by === 'string' ? real(spec.pick.by) : spec.pick.by,
      where: spec.pick.where && typeof spec.pick.where.column === 'string' ? realFilter(spec.pick.where) : spec.pick.where,
    }
  }
  if (spec.groups && typeof spec.groups === 'object' && !Array.isArray(spec.groups)) {
    const g: Record<string, Array<string | number>> = {}
    for (const [label, members] of Object.entries(spec.groups)) {
      g[label] = Array.isArray(members) ? members.map((v) => (typeof v === 'string' ? real(v) : v)) : members
    }
    out.groups = g
  }
  if (spec.window && typeof spec.window === 'object' && typeof spec.window.date === 'string') {
    out.window = { ...spec.window, date: real(spec.window.date) }
  }
  if (spec.having && typeof spec.having === 'object' && typeof spec.having.column === 'string') {
    out.having = {
      ...spec.having,
      column: real(spec.having.column),
      measure: typeof spec.having.measure === 'string' ? real(spec.having.measure) : spec.having.measure,
      value: typeof spec.having.value === 'string' ? coerceLiteral(real(spec.having.value)) : spec.having.value,
      where: spec.having.where && typeof spec.having.where.column === 'string' ? realFilter(spec.having.where) : spec.having.where,
    }
  }
  return out
}

export function tokenizeText(text: string, toReal: Record<string, string>): string {
  const entries = Object.entries(toReal).filter(([, real]) => real.length > 0)
  if (entries.length === 0) return text
  const exact = new Map<string, string>()
  const names: Array<{ real: string; token: string }> = []
  for (const [token, real] of entries) {
    const low = real.toLowerCase()
    if (!exact.has(low)) exact.set(low, token)
    if (token.startsWith('col_')) names.push({ real: low, token })
  }
  names.sort((a, b) => b.real.length - a.real.length)
  const alternation = [...entries]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([token, real]) => escapeRegExp(real) + (token.startsWith('col_') && real.length >= 4 ? '(?:es|s|ly)?' : ''))
    .join('|')
  const re = new RegExp(`(?<![${UWORD}])(?:${alternation})(?![${UWORD}])`, 'giu')
  return text.replace(re, (m) => {
    const low = m.toLowerCase()
    if (exact.has(low)) return exact.get(low) as string
    for (const n of names) if (low.startsWith(n.real)) return n.token
    return m
  })
}

function detokenizeText(text: string, toReal: Record<string, string>): string {
  return text
    .replace(/(?:col|val|lit)_\d+/g, (m) => toReal[m] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function buildTokens(summary: DataSummary, rows: Row[]): { summary: DataSummary; toReal: Record<string, string> } {
  const { summary: tokenized, toReal } = tokenizeSchema(summary)
  const seen = new Set<string>()
  let next = 0
  summary.columns.forEach((col, i) => {
    if (col.type !== 'categorical' || next >= VALUE_TOTAL_CAP) return
    const tokens: string[] = []
    for (const row of rows) {
      if (next >= VALUE_TOTAL_CAP) break
      const v = row[col.name]
      if (typeof v !== 'string') continue
      if (v.trim().length === 0 || seen.has(v)) continue
      seen.add(v)
      const tk = `val_${next++}`
      toReal[tk] = v
      tokens.push(tk)
    }
    if (tokens.length > 0 && tokens.length <= VALUE_LIST_MAX) tokenized.columns[i] = { ...tokenized.columns[i], values: tokens }
  })
  return { summary: tokenized, toReal }
}
