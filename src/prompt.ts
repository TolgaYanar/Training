import type { DataSummary, Outbound } from './types'

export const SYSTEM_PROMPT = `You translate a request about a dataset into ONE JSON chart spec, and nothing else. No prose, no markdown, no code fences. The application computes the values from the full dataset and renders the chart; you only choose how to chart it.

Output exactly this shape (omit any optional field you do not need):
{
  "chartType": "line" | "bar" | "area" | "pie" | "scatter",
  "x": "<exact column name for the x-axis; the slice category for pie; the x value for scatter>",
  "measure": "<exact numeric column name to plot as the value / y-axis>",
  "measures": ["<optional: two or more numeric columns to compare side by side, e.g. signups vs visits; use instead of measure; may be combined with series to split each measure by a category>"],
  "series": "<optional exact column name to split into one line or bar per distinct value; omit for a single series>",
  "filters": [{ "column": "<column to filter on>", "in": [<values to keep>], "op": "> | >= | < | <= | == | != (optional numeric comparison; use with value instead of in)", "value": <the threshold for op; if the request shows it as a lit_N token, copy that token here verbatim>, "datePart": "day | weekday | month | quarter (optional, for a date column)" }],
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
- You never see the data itself — only opaque tokens: "col_N" for columns and "val_N" for category values, plus each column's type and a coarse size. Small categorical columns also list their value tokens (for example "values: val_3, val_4"). When the request mentions a value token, the column whose list contains it is the one to use: add a "filters" entry with that token in "in" to keep only those rows, and to compare several named values set "series" to that same column as well. The app maps tokens back to the real values. If the user names no specific value, use "datePart" or omit "filters".
- Choose chartType to fit the request and data: line or area for trends over a time or ordered column; bar to compare across categories; pie for parts of a whole; scatter for the relationship between two numeric columns (set x and measure to the two numeric columns and aggregate "none").
- aggregate is how to combine rows that share the same x (and series): "sum", "avg", "min", "max", or "none" when each x already has a single row. Use "count" to count rows (measure is ignored then).
- Use "series" when the request compares groups across the x column (for example one line per channel or per region).
- "filters" is a LIST of conditions, ALL applied together (AND). Each entry keeps only rows whose "column" value is in "in". Use one entry PER distinct condition — to combine a category and a time window (for example "the Organic channel in January") give two entries: one {"column":"<channel column>","in":["<organic token>"]} and one {"column":"<date column>","datePart":"month","in":[1]}. For a date column set "datePart" to "day" (1-31), "weekday" (0=Sunday..6=Saturday), "month" (1-12), or "quarter" (1-4) to match a part of the date instead of the whole string — e.g. {"column":"<date column>","datePart":"day","in":[10]} keeps every month's 10th, and {"column":"<date column>","datePart":"quarter","in":[1]} keeps the first quarter. A month NAME or abbreviation on a date column means datePart "month" with that month's number (January/Jan=1, February/Feb=2, … December/Dec=12); a weekday name means datePart "weekday" (Sunday=0 … Saturday=6); "Q1"/"first quarter" means datePart "quarter". So "January only" on a date column becomes {"column":"<date column>","datePart":"month","in":[1]}.
- If the request names a specific month, weekday, or quarter (for example "January", "Mondays", "Q1"), you MUST include the matching "datePart" filter on the date column — never omit it, even when the request also says "daily" or "by day".
- For a NUMERIC THRESHOLD on a number column (for example "visits over 605", "revenue at least 1000", "units below 50"), add a "filters" entry with "op" (one of >, >=, <, <=, ==, !=) and "value" (the number) instead of "in". To answer "how many rows/days meet a condition", include that threshold entry plus any category entries, set "aggregate" to "count", and set "x" to the category column being counted. Example — "number of days the Organic channel's visits are over 605": filters [{"column":"<channel column>","in":["<organic value>"]}, {"column":"<visits column>","op":">","value":605}], x the channel column, aggregate "count". Large thresholds are masked to a lit_N token in the request (like dates and long numbers); when the threshold is a lit_N token, copy that token verbatim into "value" exactly as you copy a filter value — the app restores the real number. So "visits over 605000" arriving as "visits over lit_4" becomes {"column":"<visits column>","op":">","value":"lit_4"}.
- To compare two or more different numeric columns against each other (for example "signups vs visits"), list them in "measures"; each column becomes its own bar or line. If the request ALSO splits by a category (for example "each product's units vs revenue"), set "series" to that category together with "measures" and the app draws one bar/line per category-and-measure pair; otherwise omit "series" when using "measures". Use "measure" (single) for everything else, and always for pie and scatter.
- For totals over a coarser time period than the rows (for example "monthly" or "quarterly" from daily data), set "bucket" to "week", "month", "quarter", or "year" with "x" as the date column; the app groups the dates into those periods. Use bucket only to aggregate many rows into a period total — to chart one specific day per month (like "the 10th of each month"), use only a day filter and leave bucket out so the x-axis keeps the actual dates.
- For a ratio of two numeric columns (for example conversion rate = signups / visits, or click-through rate), set "derived": {name, numerator, denominator} INSTEAD of "measure"; the app plots sum(numerator) / sum(denominator) per category. Do not also set "measure" or "measures".
- Use sort "value" only for explicit ranking or "top N" requests; leave it out otherwise so the x-axis keeps its natural order (date axes stay chronological). For "top N" set sort "value", order "desc", and limit to N.
- Output only the JSON spec. Never refuse, apologise, or write any prose: if the request is ambiguous or underspecified, make the most reasonable choice and still return one valid spec.`

function cardinalityBand(n: number): string {
  if (n <= 1) return 'constant'
  if (n <= 10) return 'low-cardinality'
  if (n <= 50) return 'medium-cardinality'
  return 'high-cardinality'
}

function profileLines(summary: DataSummary): string {
  return summary.columns
    .map((c) => {
      const missing = c.nullCount > 0 ? ', some missing' : ''
      const values = c.values && c.values.length > 0 ? `; values: ${c.values.join(', ')}` : ''
      return `- ${c.name} (${c.type}, ${cardinalityBand(c.cardinality)}${missing}${values})`
    })
    .join('\n')
}

export function buildSpecMessage(prompt: string, summary: DataSummary): Outbound {
  return `Request: ${prompt}

Dataset columns:
${profileLines(summary)}

Return the chart spec JSON now. JSON only, no code fences.` as Outbound
}

export function buildRepairMessage(raw: string, error: string): Outbound {
  return `Your previous chart spec was rejected.
Previous output:
${raw.slice(0, 2000)}

Error:
${error}

Return a corrected chart spec JSON that fixes this exact error, using only the listed columns. JSON only, no code fences.` as Outbound
}

export const COUNT_SYSTEM = `You decide ONE thing about a data-visualization request: for each group, does the user want a COUNT of the matching rows/records/days/occurrences, or a TOTAL (the sum) of a numeric measure?

- COUNT when the request asks for a quantity, frequency, or tally of things that meet a condition — by ANY wording or language ("how many days", "how often", "the amount of channels whose visits exceed 600", "tally the days", "frequency of", "number of times"). The measure value is irrelevant; you are counting records.
- TOTAL when the request asks to add up a numeric measure ("total revenue", "sum of visits", or "how many units were sold" where units is the measure being summed).

Output only JSON: {"decision":"count"} or {"decision":"total"}.`

export const COUNT_DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { decision: { type: 'string', enum: ['count', 'total'] } },
  required: ['decision'],
}

export function buildCountMessage(safePrompt: string, measure: string, group: string, conditions: string): Outbound {
  return `Request: ${safePrompt}

A chart was drafted that TOTALS (sums) ${measure}, grouped by ${group}${conditions ? `, over rows where ${conditions}` : ''}.
For each ${group}, does the user want the SUM of ${measure}, or a COUNT of the matching rows/records/days? Reply with JSON {"decision":"count"} or {"decision":"total"}.` as Outbound
}

const FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    column: { type: 'string' },
    in: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
    op: { type: 'string', enum: ['>', '>=', '<', '<=', '==', '!='] },
    value: { anyOf: [{ type: 'number' }, { type: 'string' }] },
    datePart: { type: 'string', enum: ['day', 'weekday', 'month', 'quarter'] },
  },
  required: ['column'],
}

export const CHART_SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chartType: { type: 'string', enum: ['line', 'bar', 'area', 'pie', 'scatter'] },
    x: { type: 'string' },
    measure: { type: 'string' },
    measures: { type: 'array', items: { type: 'string' } },
    series: { type: 'string' },
    aggregate: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max', 'none'] },
    filter: FILTER_SCHEMA,
    filters: { type: 'array', items: FILTER_SCHEMA },
    bucket: { type: 'string', enum: ['week', 'month', 'quarter', 'year'] },
    derived: {
      type: 'object',
      additionalProperties: false,
      properties: { name: { type: 'string' }, numerator: { type: 'string' }, denominator: { type: 'string' } },
      required: ['name', 'numerator', 'denominator'],
    },
    title: { type: 'string' },
    sort: { type: 'string', enum: ['value'] },
    order: { type: 'string', enum: ['asc', 'desc'] },
    limit: { type: 'integer' },
  },
  required: ['chartType', 'x'],
}
