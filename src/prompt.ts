import type { DataSummary } from './types'

export const SYSTEM_PROMPT = `You translate a request about a dataset into ONE JSON chart spec, and nothing else. No prose, no markdown, no code fences. The application computes the values from the full dataset and renders the chart; you only choose how to chart it.

Output exactly this shape (omit any optional field you do not need):
{
  "chartType": "line" | "bar" | "area" | "pie" | "scatter",
  "x": "<exact column name for the x-axis; the slice category for pie; the x value for scatter>",
  "measure": "<exact numeric column name to plot as the value / y-axis>",
  "measures": ["<optional: two or more numeric columns to compare side by side, e.g. signups vs visits; use this instead of measure/series>"],
  "series": "<optional exact column name to split into one line or bar per distinct value; omit for a single series>",
  "filter": { "column": "<column to filter on>", "in": [<values to keep>], "datePart": "day | weekday | month | quarter (optional, for a date column)" },
  "bucket": "week | month | quarter | year (optional: aggregate a date x-column into coarser periods)",
  "derived": { "name": "<label>", "numerator": "<numeric column>", "denominator": "<numeric column>" },
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
- To restrict to a subset of rows (for example "only the Organic channel", "North region only", "weekdays only", "the 10th of each month"), add "filter": keep only rows whose "column" value is in "in". For a date column, set "datePart" to "day" (1-31), "weekday" (0=Sunday..6=Saturday), "month" (1-12), or "quarter" (1-4) to match a part of the date instead of the whole string — e.g. {"column":"date","datePart":"day","in":[10]} keeps every month's 10th, and {"column":"date","datePart":"quarter","in":[1]} keeps the first quarter (January through March).
- To compare two or more different numeric columns against each other (for example "signups vs visits"), list them in "measures" and omit "series"; each column becomes its own bar or line. Use "measure" (single) for everything else, and always for pie and scatter.
- For totals over a coarser time period than the rows (for example "monthly" or "quarterly" from daily data), set "bucket" to "week", "month", "quarter", or "year" with "x" as the date column; the app groups the dates into those periods. Use bucket only to aggregate many rows into a period total — to chart one specific day per month (like "the 10th of each month"), use only a day filter and leave bucket out so the x-axis keeps the actual dates.
- For a ratio of two numeric columns (for example conversion rate = signups / visits, or click-through rate), set "derived": {name, numerator, denominator} INSTEAD of "measure"; the app plots sum(numerator) / sum(denominator) per category. Do not also set "measure" or "measures".
- Use sort "value" only for explicit ranking or "top N" requests; leave it out otherwise so the x-axis keeps its natural order (date axes stay chronological). For "top N" set sort "value", order "desc", and limit to N.
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
