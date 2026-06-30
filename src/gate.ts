import { VOCAB } from './vocab'

const TOKEN_RE = /(?:col|val|lit)_\d+/g
const ZERO_WIDTH = /[​-‍﻿⁠­]/g
const ISO_DATE_G = /\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/g
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’]*/gu

const MAX_INPUT = 4000

export function normalizeLite(s: string): string {
  return (s.length > MAX_INPUT ? s.slice(0, MAX_INPUT) : s)
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .replace(/\p{Zs}/gu, ' ')
    .replace(/[\p{Pd}−]/gu, '-')
    .replace(/[·‧∙•]/g, '-')
}

function nextLit(toReal: Record<string, string>): number {
  let n = 0
  for (const k in toReal) if (k.startsWith('lit_')) n++
  return n
}

function literalToken(literal: string, toReal: Record<string, string>): string {
  for (const k in toReal) if (k.startsWith('lit_') && toReal[k] === literal) return k
  const tok = `lit_${nextLit(toReal)}`
  toReal[tok] = literal
  return tok
}

function luhnOk(d: string): boolean {
  let sum = 0
  let alt = false
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48
    if (n < 0 || n > 9) return false
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return d.length >= 13 && sum % 10 === 0
}

function ibanOk(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const v = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48
    rem = (rem * (v > 9 ? 100 : 10) + v) % 97
  }
  return rem === 1
}

function tcknOk(d: string): boolean {
  if (!/^\d{11}$/.test(d) || d[0] === '0') return false
  const n = d.split('').map(Number)
  const oddSum = n[0] + n[2] + n[4] + n[6] + n[8]
  const evenSum = n[1] + n[3] + n[5] + n[7]
  const d10 = ((oddSum * 7) - evenSum) % 10
  if (((d10 % 10) + 10) % 10 !== n[9]) return false
  const total = n.slice(0, 10).reduce((a, b) => a + b, 0)
  return total % 10 === n[10]
}

export function maskPII(text: string, toReal: Record<string, string>): string {
  let out = text.replace(ISO_DATE_G, (m) => literalToken(m, toReal))
  out = out.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){2,8}\b/g, (m) => (ibanOk(m) ? literalToken(m, toReal) : m))
  out = out.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (luhnOk(m.replace(/[ -]/g, '')) ? literalToken(m, toReal) : m))
  out = out.replace(/(?<!\d)\d{11}(?!\d)/g, (m) => (tcknOk(m) ? literalToken(m, toReal) : m))
  out = out.replace(/\+?\d[\d \-().]{8,}\d/g, (m) => (m.replace(/\D/g, '').length >= 10 ? literalToken(m, toReal) : m))
  out = out.replace(/(?<![\w.])\d+(?:[ \-.,:/]\d+)+(?![\w.])/g, (m) => (m.replace(/\D/g, '').length >= 5 ? literalToken(m, toReal) : m))
  out = out.replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, (m) => literalToken(m, toReal))
  return out
}

function normWord(w: string): string {
  return w.normalize('NFKC').toLowerCase().replace(/['’]s$/, '')
}

function allowed(w: string): boolean {
  if (/^\p{N}+$/u.test(w)) return true
  const n = normWord(w)
  return VOCAB.has(n) || VOCAB.has(n.replace(/['’]/g, ''))
}

function mapResidualWords(text: string, fn: (w: string) => string): string {
  let out = ''
  let last = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text)) !== null) {
    out += text.slice(last, m.index).replace(WORD_RE, fn)
    out += m[0]
    last = TOKEN_RE.lastIndex
  }
  out += text.slice(last).replace(WORD_RE, fn)
  return out
}

function levBounded(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

function schemaTerms(toReal: Record<string, string>): Array<{ term: string; token: string }> {
  const out: Array<{ term: string; token: string }> = []
  for (const k in toReal) {
    if (!k.startsWith('col_') && !k.startsWith('val_')) continue
    const norm = normWord(toReal[k])
    if (norm.length >= 4) out.push({ term: norm, token: k })
  }
  return out
}

export function fuzzyTokenizeResiduals(text: string, toReal: Record<string, string>): string {
  const terms = schemaTerms(toReal)
  if (terms.length === 0) return text
  return mapResidualWords(text, (w) => {
    const n = normWord(w)
    if (n.length < 4 || allowed(w)) return w
    const max = n.length <= 5 ? 1 : 2
    let best = max + 1
    let bestTok = ''
    let tie = false
    for (const t of terms) {
      const d = levBounded(n, t.term, max)
      if (d < best) { best = d; bestTok = t.token; tie = false }
      else if (d === best && t.token !== bestTok) tie = true
    }
    return best <= max && !tie ? bestTok : w
  })
}

function enforceAllowlist(text: string, toReal: Record<string, string>): string {
  return mapResidualWords(text, (w) => (allowed(w) ? w : literalToken(w, toReal)))
}

export function verifyAllowlist(text: string): string[] {
  const bad: string[] = []
  mapResidualWords(text, (w) => { if (!allowed(w)) bad.push(w); return w })
  return bad
}

export function neutralizeTokenLookalikes(text: string, toReal: Record<string, string>): string {
  return text.replace(/(?:col|val|lit)_\d+/gi, (m) => literalToken(m, toReal))
}

export function scrub(text: string, toReal: Record<string, string>): string {
  return enforceAllowlist(maskPII(text, toReal), toReal)
}

const FRAME = new Set([
  'request', 'dataset', 'columns', 'column', 'return', 'chart', 'spec', 'json', 'code', 'fences', 'now', 'only', 'no',
  'your', 'previous', 'output', 'error', 'rejected', 'corrected', 'fixes', 'exact', 'using', 'listed', 'was', 'that', 'this', 'a', 'the',
  'number', 'date', 'categorical', 'constant', 'low', 'medium', 'high', 'cardinality', 'some', 'missing', 'values',
  'boolean', 'integer', 'string', 'array', 'object',
  'charttype', 'x', 'y', 'measure', 'measures', 'series', 'over', 'pick', 'datepart', 'bucket', 'by', 'agg', 'extreme',
  'where', 'having', 'aggregate', 'filter', 'filters', 'groupbypart', 'groups', 'window', 'derived', 'name', 'numerator',
  'denominator', 'title', 'sort', 'order', 'limit', 'display', 'stacked', 'horizontal', 'step', 'donut', 'rose',
  'in', 'notin', 'op', 'value', 'from', 'to', 'line', 'bar', 'area', 'pie', 'scatter', 'day', 'weekday', 'month',
  'quarter', 'sum', 'avg', 'count', 'min', 'max', 'none', 'asc', 'desc',
])

function allowedOutbound(w: string): boolean {
  return allowed(w) || FRAME.has(normWord(w))
}

export function verifyOutbound(text: string): string[] {
  const bad: string[] = []
  mapResidualWords(text, (w) => { if (!allowedOutbound(w)) bad.push(w); return w })
  return bad
}

export function enforceOutbound(text: string, toReal: Record<string, string>): string {
  return mapResidualWords(text, (w) => (allowedOutbound(w) ? w : literalToken(w, toReal)))
}

function classifyLiteral(v: string): string {
  if (/@/.test(v) && /\.[a-z]{2,}/i.test(v)) return 'emails'
  if (/^(?:https?:\/\/|www\.)/i.test(v)) return 'links'
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(v)) return 'dates'
  if (v.replace(/\D/g, '').length >= 10) return 'pii'
  if (/^[\p{L}\p{M}'’\- ]+$/u.test(v)) return 'names'
  return 'numbers'
}

export interface RedactionGroup { kind: string; count: number }

export function redactionSummary(toReal: Record<string, string>): RedactionGroup[] {
  const counts: Record<string, number> = {}
  for (const k in toReal) {
    const kind = k.startsWith('col_') ? 'columns' : k.startsWith('val_') ? 'values' : classifyLiteral(toReal[k])
    counts[kind] = (counts[kind] ?? 0) + 1
  }
  const order = ['pii', 'emails', 'links', 'names', 'dates', 'numbers', 'values', 'columns']
  return order.filter((k) => counts[k]).map((k) => ({ kind: k, count: counts[k] }))
}

const CALENDAR_TITLE = new Set(
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
    'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays',
    'ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık',
    'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi', 'pazar'],
)

// Non-destructive: surface runs of 2+ consecutive capitalized words (excluding any run with a
// calendar word) as POSSIBLE names. These are the dictionary-collision case default-deny can't
// catch (a name built from common words); we warn rather than mask, since it's genuinely ambiguous.
export function nameRiskCandidates(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/(?:\p{Lu}[\p{Ll}'’-]+ ){1,}\p{Lu}[\p{Ll}'’-]+/gu)) {
    const words = m[0].split(/\s+/)
    if (words.some((w) => CALENDAR_TITLE.has(w.toLowerCase()))) continue
    if (!out.includes(m[0])) out.push(m[0])
  }
  return out
}

export function looksLikePastedData(text: string): boolean {
  if ((text.match(/\t/g)?.length ?? 0) >= 3) return true
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 3) return false
  const delimited = lines.filter((l) => (l.match(/[,;|\t]/g)?.length ?? 0) >= 2).length
  return delimited >= 3
}
