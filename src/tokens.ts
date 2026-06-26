import type { ChartSpec, DataSummary, Filter, Row } from './types'

// The only cap is a budget on how many distinct values we enumerate, to bound
// regex/prompt size. Protection is NOT gated on a column's cardinality or a
// value's length — those are exactly where real identifiers (emails, IDs, codes)
// hide, so they must be masked too.
const VALUE_TOTAL_CAP = 5000
// Only small categoricals get their value tokens listed in the schema (keeps the
// payload small and avoids disclosing the exact size of large columns).
const VALUE_LIST_MAX = 20
const WORD = 'A-Za-z0-9_'
// Unicode-aware word boundary, so a value can't match a prefix of an accented
// word ("Ann" must not fire inside "Anné").
const UWORD = '\\p{L}\\p{M}\\p{N}_'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Numeric/date LITERALS the user types are data values, not chart controls — but
// small integers ARE controls (top-N limit; day/month/quarter/weekday parts), so
// we redact only ISO dates and 4+ digit runs (years, IDs, account numbers, exact
// amounts) and keep 1-3 digit numbers. Boundaries keep these off existing
// col_/val_ tokens. Redacted literals round-trip via toReal (an echoed filter
// value maps back), so functionality is preserved.
const ISO_DATE = new RegExp(`(?<![${WORD}])\\d{4}-\\d{2}-\\d{2}(?:[ T]\\d{2}:\\d{2}(?::\\d{2})?)?(?![${WORD}])`, 'g')
// Numbers written the human way are single values (salaries, amounts, account/
// card numbers) and must mask WHOLE — not leak their groups. Comma-grouped and
// decimal forms first, then hyphen/dot-separated (phone/SSN), then bare 4+ runs
// (IDs, years). 1-3 digit numbers stay: top-N and day/month/quarter parts are
// controls the model needs.
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
  // Order matters: emails and links first (they embed dots & digits), then whole
  // dates, comma-grouped, hyphen/dot-separated, decimals, bare long runs — each
  // consumes its characters before a looser pattern can split them.
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

export function detokenizeSpec(spec: ChartSpec, toReal: Record<string, string>): ChartSpec {
  const real = (v: string): string => toReal[v] ?? v
  const out: ChartSpec = { ...spec }
  if (typeof spec.x === 'string') out.x = real(spec.x)
  if (typeof spec.measure === 'string') out.measure = real(spec.measure)
  if (Array.isArray(spec.measures)) out.measures = spec.measures.map((m) => (typeof m === 'string' ? real(m) : m))
  if (typeof spec.series === 'string') out.series = real(spec.series)
  const realFilter = (f: Filter): Filter => ({
    ...f,
    column: typeof f.column === 'string' ? real(f.column) : f.column,
    in: Array.isArray(f.in) ? f.in.map((v) => (typeof v === 'string' ? real(v) : v)) : f.in,
    value: typeof f.value === 'string' ? Number(real(f.value)) : f.value,
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
  return out
}

// Replace every real column name / category value with its opaque token before
// the text leaves the device. One left-to-right, case-insensitive, word-boundaried
// pass; longest real first so the most specific alternative wins. Two behaviours:
//   - VALUES match exactly, so a longer word that merely contains a value is left
//     intact ("Northwest" is not the value "North") — no fragments, no mangling.
//   - COLUMN NAMES also match morphological variants ("monthly" -> month,
//     "regions" -> region). Because the real name is masked, the model can only
//     map the request through these tokens, so a near-miss must still resolve to
//     the right column — otherwise it guesses the wrong axis.
export function tokenizeText(text: string, toReal: Record<string, string>): string {
  const entries = Object.entries(toReal).filter(([, real]) => real.length > 0)
  if (entries.length === 0) return text
  const exact = new Map<string, string>() // lowercased real -> token (exact match)
  const names: Array<{ real: string; token: string }> = [] // col_ names, for prefix (stem) match
  for (const [token, real] of entries) {
    const low = real.toLowerCase()
    if (!exact.has(low)) exact.set(low, token)
    if (token.startsWith('col_')) names.push({ real: low, token })
  }
  names.sort((a, b) => b.real.length - a.real.length)
  // Column names also match a BOUNDED set of inflections (plural -s/-es, adverb
  // -ly) so a near-miss reference still maps ("monthly"->month, "regions"->region)
  // — but only those, and only for names long enough (>=4) that an inflection
  // can't swallow unrelated prose ("production"!=product, "country"!=count, and a
  // short "on" must not eat "only"). Values always match exactly.
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

// Reverse of tokenizeText for AI-generated free text (chart title, derived.name):
// known tokens map back to their real strings; any stray/out-of-range token the
// model may have invented is dropped rather than rendered verbatim.
function detokenizeText(text: string, toReal: Record<string, string>): string {
  return text
    .replace(/(?:col|val|lit)_\d+/g, (m) => toReal[m] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// The full de-identification map for one request: real column names AND real
// categorical values — every distinct string value, regardless of cardinality or
// length, since that is where identifiers (emails, names, IDs, codes) live. The
// cloud model only ever sees tokens; toReal stays on the device to map answers back.
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
      // Every distinct value is masked — including ones that look like ordinary
      // words (ISO codes ON/IT/NO, grades, Yes/No). They are real category data;
      // tokenizeText's exact word-boundary match keeps unrelated prose intact.
      if (v.trim().length === 0 || seen.has(v)) continue
      seen.add(v)
      const tk = `val_${next++}`
      toReal[tk] = v
      tokens.push(tk)
    }
    // For small categoricals, expose the value TOKENS in the schema so the model
    // can tie a mentioned value to its column (build filters / per-value series)
    // without ever seeing the real strings.
    if (tokens.length > 0 && tokens.length <= VALUE_LIST_MAX) tokenized.columns[i] = { ...tokenized.columns[i], values: tokens }
  })
  return { summary: tokenized, toReal }
}
