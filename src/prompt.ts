import type { DataSummary } from './types'

export const SYSTEM_PROMPT = `You translate a request about a dataset into ONE JSON chart spec, and nothing else. No prose, no markdown, no code fences. The application computes the values from the full dataset and renders the chart; you only choose how to chart it.

Output exactly this shape (omit any optional field you do not need):
{
  "chartType": "line" | "bar" | "area" | "pie" | "scatter",
  "x": "<exact column name for the x-axis; the slice category for pie; the x value for scatter>",
  "measure": "<exact numeric column name to plot as the value / y-axis>",
  "measures": ["<optional: two or more numeric columns to compare side by side, e.g. signups vs visits; use this instead of measure/series>"],
  "series": "<optional exact column name to split into one line or bar per distinct value; omit for a single series>",
  "aggregate": "sum" | "avg" | "count" | "min" | "max" | "none",
  "title": "<short chart title>",
  "sort": "value",
  "order": "asc" | "desc",
  "limit": <number>
}

Rules:
- Use EXACT column names from the schema below. Do not invent columns.
- Choose chartType to fit the request and data: line or area for trends over a time or ordered column; bar to compare across categories; pie for parts of a whole; scatter for the relationship between two numeric columns (set x and measure to the two numeric columns and aggregate "none").
- aggregate is how to combine rows that share the same x (and series): "sum", "avg", "min", "max", or "none" when each x already has a single row. Use "count" to count rows (measure is ignored then).
- Use "series" when the request compares groups across the x column (for example one line per channel or per region).
- To compare two or more different numeric columns against each other (for example "signups vs visits"), list them in "measures" and omit "series"; each column becomes its own bar or line. Use "measure" (single) for everything else, and always for pie and scatter.
- For "top N", "largest", or "ranking" requests, set sort "value", order "desc", and limit to N.
- Output only the JSON spec.`

function profileLines(summary: DataSummary): string {
  return summary.columns
    .map((c) => {
      const range = c.type === 'number' ? `, range ${c.min}..${c.max}` : `, e.g. ${JSON.stringify(c.sampleValues)}`
      const nulls = c.nullCount > 0 ? `, ${c.nullCount} missing` : ''
      return `- ${c.name} (${c.type}, ${c.cardinality} distinct${range}${nulls})`
    })
    .join('\n')
}

export function buildSpecMessage(prompt: string, summary: DataSummary): string {
  return `Request: ${prompt}

Dataset schema (${summary.rowCount} rows):
${profileLines(summary)}

Return the chart spec JSON now. JSON only, no code fences.`
}

export function buildRepairMessage(raw: string, error: string): string {
  return `Your previous chart spec was rejected.
Previous output:
${raw.slice(0, 2000)}

Error:
${error}

Return a corrected chart spec JSON that fixes this exact error, using only the listed columns. JSON only, no code fences.`
}
