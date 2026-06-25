import type { ChartSpec, DataSummary } from './types'

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
  if (spec.filter && typeof spec.filter.column === 'string') out.filter = { ...spec.filter, column: real(spec.filter.column) }
  if (spec.derived) {
    out.derived = {
      ...spec.derived,
      numerator: typeof spec.derived.numerator === 'string' ? real(spec.derived.numerator) : spec.derived.numerator,
      denominator: typeof spec.derived.denominator === 'string' ? real(spec.derived.denominator) : spec.derived.denominator,
    }
  }
  return out
}

export function tokenizeText(text: string, toReal: Record<string, string>): string {
  const pairs = Object.entries(toReal).sort((a, b) => b[1].length - a[1].length)
  let out = text
  for (const [token, realName] of pairs) out = out.split(realName).join(token)
  return out
}
