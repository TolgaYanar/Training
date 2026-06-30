import type { DataSummary, Outbound } from './types'

export const SYSTEM_PROMPT = `You translate a request about a dataset into ONE JSON chart spec, and nothing else. No prose, no markdown, no code fences. The application computes the values from the full dataset and renders the chart; you only choose how to chart it.

Output exactly this shape (omit any optional field you do not need):
{
  "chartType": "line" | "bar" | "area" | "pie" | "scatter",
  "x": "<exact column name for the x-axis; the slice category for pie; the x value for scatter>",
  "measure": "<exact numeric column name to plot as the value / y-axis>",
  "measures": ["<optional: two or more numeric columns to compare side by side, e.g. signups vs visits; use instead of measure; may be combined with series to split each measure by a category>"],
  "series": "<optional exact column name to split into one line or bar per distinct value; omit for a single series>",
  "over": "<optional inner period/date column to total over BEFORE applying aggregate, e.g. the month or date column; use for 'best/worst/average single month (or day) per group'>",
  "pick": { "column": "<date or category column to choose ONE winning value from>", "datePart": "month | quarter | weekday | day (only when column is a date and you mean its part)", "bucket": "week | month | quarter | year (pick a winning PERIOD that spans rows, e.g. the busiest week)", "by": "<numeric column whose extreme picks the winner>", "extreme": "max | min", "where": { "column": "<column>", "in": ["<value>"] } },
  "having": { "column": "<the GROUP column to test (e.g. month or a category)>", "measure": "<numeric column to aggregate within each group>", "agg": "sum | avg | count | min | max", "op": "> | >= | < | <= | == | !=", "value": <threshold (copy a lit_N token verbatim if shown as one)>, "where": { "column": "<column>", "in": ["<value>"] } },
  "filters": [{ "column": "<column to filter on>", "in": [<values to keep>], "notIn": [<values to EXCLUDE; keeps every other value of that column>], "op": "> | >= | < | <= | == | != (optional numeric comparison; use with value instead of in)", "value": <the threshold for op; if the request shows it as a lit_N token, copy that token here verbatim>, "datePart": "day | weekday | month | quarter (optional, for a date column)" }],
  "bucket": "week | month | quarter | year (optional: aggregate a date x-column into coarser periods)",
  "groupByPart": "day | weekday | month | quarter (optional: collapse a date x-column into recurring cycle buckets — Mon..Sun, 1..31, Jan..Dec, or Q1..Q4)",
  "groups": { "<bucket label you name>": ["<x-values that belong in it>"], "<another label>": ["..."] },
  "window": { "anchor": "last | first", "date": "<a date token like lit_3 to start the span at an explicit date>", "count": <whole number>, "unit": "day | week" },
  "derived": { "name": "<label>", "numerator": "<numeric column>", "denominator": "<numeric column>" },
  "aggregate": "sum" | "avg" | "count" | "min" | "max" | "none",
  "title": "<short chart title>",
  "sort": "value",
  "order": "asc" | "desc",
  "limit": <number>,
  "display": { "stacked": true, "horizontal": true, "step": true, "donut": true, "rose": true }
}

Rules:
- Use EXACT column names from the schema below. Do not invent columns.
- You never see the data itself — only opaque tokens: "col_N" for columns and "val_N" for category values, plus each column's type and a coarse size. Small categorical columns also list their value tokens (for example "values: val_3, val_4"). When the request mentions a value token, the column whose list contains it is the one to use: add a "filters" entry with that token in "in" to keep only those rows, and to compare several named values set "series" to that same column as well. The app maps tokens back to the real values. If the user names no specific value, use "datePart" or omit "filters".
- Choose chartType to fit the request and data: line or area for trends over a time or ordered column; bar to compare across categories; pie for parts of a whole; scatter for the relationship between two numeric columns (set x and measure to the two numeric columns and aggregate "none").
- aggregate is how to combine rows that share the same x (and series): "sum", "avg", "min", "max", or "none" when each x already has a single row. Use "count" to count rows (measure is ignored then). Decide count-vs-sum deliberately: use "count" when the request wants a QUANTITY, FREQUENCY, or TALLY of records/days/things that meet a condition — "how many days", "how often", "the number of channels whose visits exceed 600", "tally the days", "frequency of", "number of times" (the measure value is irrelevant; you are counting rows, and "x" is the category being counted). Use "sum" when the request adds up a numeric measure — "total revenue", "sum of visits", or "how many units were sold" where units is the measure being summed.
- Set "series" to a category column to draw one line/bar PER distinct value — use it whenever the request splits or compares across a category WITHIN the x-axis: "both sensors", "each region", "per channel", "one line per product", "broken down by region", "split by channel". When the request pairs a PERIOD word with "for all / for every / for each <category>" (for example "weekly visits for all channels", "monthly revenue for every region"), put the DATE column on "x" (with the period as "bucket" or "groupByPart") and set "series" to the category — do NOT put the category on "x". Omit "series" for a single combined line.
- When the request COMBINES or merges specific named values (for example "North and South combined", "Widget and Gadget together", "Email and Social as one line"), put those values in a single "filters" entry ("in": [both values]) and do NOT set "series" — the app sums them into one line/bar. Use "series" only to keep them as SEPARATE lines.
- "filters" is a LIST of conditions, ALL applied together (AND). Each entry keeps only rows whose "column" value is in "in". Use one entry PER distinct condition — to combine a category and a time window (for example "the Organic channel in January") give two entries: one {"column":"<channel column>","in":["<organic token>"]} and one {"column":"<date column>","datePart":"month","in":[1]}. For a date column set "datePart" to "day" (1-31), "weekday" (0=Sunday..6=Saturday), "month" (1-12), or "quarter" (1-4) to match a part of the date instead of the whole string — e.g. {"column":"<date column>","datePart":"day","in":[10]} keeps every month's 10th, and {"column":"<date column>","datePart":"quarter","in":[1]} keeps the first quarter. A month NAME or abbreviation on a date column means datePart "month" with that month's number (January/Jan=1, February/Feb=2, … December/Dec=12); a weekday name means datePart "weekday" (Sunday=0 … Saturday=6); "Q1".."Q4" or "first/second/third/fourth quarter" means datePart "quarter" with that number; "the last quarter (of the year)" means Q4 ("in":[4]) and "the first quarter" means Q1 ("in":[1]) — always include this datePart filter when the request names a quarter. So "January only" on a date column becomes {"column":"<date column>","datePart":"month","in":[1]}.
- If the request names a specific month, weekday, or quarter (for example "January", "Mondays", "Q1"), you MUST include the matching "datePart" filter on the date column — never omit it, even when the request also says "daily" or "by day".
- For a NUMERIC THRESHOLD on a number column (for example "visits over 605", "revenue at least 1000", "units below 50"), add a "filters" entry with "op" (one of >, >=, <, <=, ==, !=) and "value" (the number) instead of "in". To answer "how many rows/days meet a condition", include that threshold entry plus any category entries, set "aggregate" to "count", and set "x" to the category column being counted. Example — "number of days the Organic channel's visits are over 605": filters [{"column":"<channel column>","in":["<organic value>"]}, {"column":"<visits column>","op":">","value":605}], x the channel column, aggregate "count". Large thresholds are masked to a lit_N token in the request (like dates and long numbers); when the threshold is a lit_N token, copy that token verbatim into "value" exactly as you copy a filter value — the app restores the real number. So "visits over 605000" arriving as "visits over lit_4" becomes {"column":"<visits column>","op":">","value":"lit_4"}.
- To EXCLUDE specific values ("all channels except Email", "every region but North", "without the Paid channel"), use "notIn" with the values to drop: {"column":"<channel column>","notIn":["<email value>"]} keeps every other channel (for a small listed column you may instead list the keepers in "in"). To keep ONLY weekdays use a datePart weekday filter {"column":"<date column>","datePart":"weekday","in":[1,2,3,4,5]}; for "weekends only" use {"column":"<date column>","datePart":"weekday","in":[0,6]} (Sunday=0 … Saturday=6); "exclude weekends" is the same as weekdays only. But to COMPARE weekends VERSUS weekdays as two side-by-side groups, do NOT filter — set "groupByPart":"weekday" together with "groups" to fold the seven days into a "Weekday" and a "Weekend" bucket (see the groups rule).
- A request for a measure over a DATE RANGE — "temperature readings between Mar 5 and Mar 10", "visits before 2024-02-15", "signups after X", "readings over <span>" — is a TIME SERIES: set "x" to the DATE column and "measure" to the numeric column (chartType "line"), and express the dates as a "from"/"to" or before/after date filter. Do NOT put the measure itself on "x", and do NOT pick "scatter" just because a numeric column is named (scatter is only for the relationship between TWO numeric columns). If it also says "for each / per <category>", add "series" for that category. (A single specific day, "on <date>", instead keeps the natural categorical x such as channel.) For "since/from/after <date>" use a single "op":">=" (no upper bound); for "until/before/through <date>" a single "op":"<=". CRUCIAL — dates only become "lit_N" tokens when the request already shows them as a token; a date written in WORDS or without a year ("March 7", "7 March", "3/7") is NOT a token, so do NOT invent a lit_N — emit it as "MM-DD" (e.g. "03-07") and the app fills in the data's year. "the end of the year" = "12-31", "the start of the year" = "01-01". With a full year present ("March 7 2024", "2024-03-07") emit the whole "YYYY-MM-DD".
- For a span measured RELATIVE TO THE DATA itself — "the last 60 days", "the past two weeks", "the most recent 30 days", "the trailing month", "the first week of the data" — you cannot know the real dates (they are hidden), so do NOT invent a from/to. Instead set "window": {"anchor":"last" to count back from the most recent date (or "first" from the earliest), "count": <whole number>, "unit":"day" or "week"}; the app resolves it against the real date range on device. Use "window" with "anchor" ONLY for spans tied to the data's latest/earliest date. For "the week of <date>" (a 7-day span starting at a SPECIFIC date that appears in the request as a token), set "window": {"date": <that date token>, "count": 1, "unit": "week"} — the app expands it to the seven days from that date. Other CALENDAR spans use "datePart"/day filters or "from"/"to", never "window": a named month → datePart month; the FIRST or LAST week of a named month → datePart month plus a "day" datePart for days 1-7 (first) or the month's final seven day-numbers, e.g. 25-31 for a 31-day month, 22-28 for February (last); "the first 10 days of February" → datePart month 2 + day 1-10; a quarter → datePart quarter; an explicit YYYY-MM-DD range → "from"/"to".
- To compare two or more different numeric columns against each other (for example "signups vs visits"), list them in "measures"; each column becomes its own bar or line. If the request ALSO splits by a category (for example "each product's units vs revenue"), set "series" to that category together with "measures" and the app draws one bar/line per category-and-measure pair; otherwise omit "series" when using "measures". Use "measure" (single) for everything else, and always for pie and scatter.
- For totals over a coarser time period than the rows (for example "monthly" or "quarterly" from daily data), set "bucket" to "week", "month", "quarter", or "year" with "x" as the date column; the app groups the dates into those periods. Use bucket only to aggregate many rows into a period total — to chart one specific day per month (like "the 10th of each month"), use only a day filter and leave bucket out so the x-axis keeps the actual dates.
- To collapse a date x-column into a RECURRING CYCLE — one point per weekday (Mon..Sun), per day-of-month (1..31), per calendar month (Jan..Dec pooled across years), or per quarter (Q1..Q4) — set "groupByPart" to "weekday", "day", "month", or "quarter" with "x" as the date column. Use this for "by weekday", "a weekday breakdown", "broken down by weekday", "average visits by day of the week", "the busiest weekday", "across the seven weekdays", "sales by calendar month", or "by quarter of the year" (for a two-bucket weekend-vs-weekday split, combine groupByPart "weekday" with "groups" — see the next rule). A "weekday breakdown" / "breakdown by weekday" still means groupByPart "weekday" even when combined with a numeric threshold (e.g. "weekday breakdown of visits over 1000" = keep visits>1000, then groupByPart weekday). This is DIFFERENT from "bucket" (which keeps each distinct chronological period like 2024-01 then 2024-02) and from a "datePart" FILTER (which keeps only matching dates, e.g. only Mondays). For a recurring-cycle breakdown use "groupByPart" and do NOT also set "bucket"; for a single named day/month/quarter use a "datePart" filter instead.
- To MERGE the x-axis values into a few buckets YOU define, add "groups": a map from each bucket label to the list of x-values it contains. The app relabels every x-value to its bucket and drops any value you do not list. Use it for "weekend vs weekday", seasons, halves of the year, or custom tiers — anything that pools the natural x-values into fewer named groups. The listed values must match what the x-axis shows: with "groupByPart":"weekday" the buckets hold day names ("Mon".."Sun"), with "groupByPart":"month" they hold "Jan".."Dec", with "bucket":"quarter" they hold "Q1".."Q4"; for a plain category x list that column's values (their val_N tokens). Weekend vs weekday: "groupByPart":"weekday","groups":{"Weekday":["Mon","Tue","Wed","Thu","Fri"],"Weekend":["Sat","Sun"]}. Halves of the year: "groupByPart":"month","groups":{"H1":["Jan","Feb","Mar","Apr","May","Jun"],"H2":["Jul","Aug","Sep","Oct","Nov","Dec"]}. Keep "series" for any per-category split you also want (for example one bar per channel inside each bucket).
- For a ratio of two numeric columns (for example conversion rate = signups / visits, or click-through rate), set "derived": {name, numerator, denominator} INSTEAD of "measure"; the app plots sum(numerator) / sum(denominator) per category. Do not also set "measure" or "measures".
- For the BEST, HIGHEST, LOWEST, WORST, or AVERAGE single PERIOD per group (for example "each region's best single month of revenue", "the peak day per channel", "the average monthly revenue per product"), set "x" to the group column, "measure" to the numeric column, "aggregate" to "max" (best/highest), "min" (worst/lowest), or "avg" (typical/average), and "over" to the inner period column to total first (the month or date column). The app sums the measure within each "over" value, then takes the aggregate of those period totals for each x. Leave "over" out for a plain total or an ordinary max/min over individual rows: "the lowest/highest temperature reading (or value) for each sensor" with NO period word means aggregate "min"/"max" with "x" the group column and one value per group — do NOT plot the raw readings over time.
- To ZOOM into ONE winning period or category chosen by an extreme of a measure — especially when ONE group decides the winner but the chart then shows ALL groups (for example "in the month Organic's visits peak, show every channel's signups", "on the single day visits were highest, signups per channel", "the region where Widget sells best, units of every product there") — set "pick": { "column": <the date or category column to choose the winner from>, "datePart": <its part, only if column is a date and you mean month/quarter/weekday/day>, "by": <the numeric column whose max/min decides>, "extreme": "max" or "min", "where": { <OPTIONAL condition restricting which rows decide the winner, e.g. only the Organic channel> } }. The app finds the winning value from the full data and filters EVERY row to it, then draws "x"/"measure"/"series" as usual. IMPORTANT: "where" ONLY selects the winning period — do NOT also put that group in "filters", or the chart will wrongly show just that one group. Omit "where" for a plain "the month with the most total visits across all channels". "pick" chooses exactly ONE winning value, so do NOT use it for the TOP N (two or more) groups: for "the 2 regions with the most revenue", "the top 3 channels by visits", "the 2 regions ... month by month", set "series" to that group column with "sort":"value", "order":"desc", "limit":N and NO "pick". The chart's "x" and "measure" describe what to plot AFTER the pick and are INDEPENDENT of "by": for "the region with the most REVENUE, break UNITS down by PRODUCT" set pick {"column":<region>,"by":<revenue>,"extreme":"max"} but "x":<product> and "measure":<units>. When the winner is a PERIOD that spans several rows — the busiest/quietest WEEK, the best quarter — set "bucket" to "week"/"month"/"quarter"/"year" on a date column INSTEAD of "datePart"; the app totals "by" within each period, picks the extreme period, and keeps ALL its days. Example — "in the busiest week of the year for total visits, show each channel's signups per day": pick {"column":<date>,"bucket":"week","by":<visits>,"extreme":"max"} with "x":<date>, "series":<channel>, "measure":<signups> — plot signups even though the week was chosen by visits.
- To keep ONLY the GROUPS whose own aggregate meets a condition — "only the months where North's revenue exceeded 4000", "products whose TOTAL units are over 500", "regions averaging more than X" — set "having": {"column": <the group column whose groups you test, e.g. the month or a category>, "measure": <numeric column>, "agg": "sum"/"avg"/"count"/"min"/"max", "op": <comparison>, "value": <threshold (copy a lit_N token verbatim if shown as one)>, "where": <OPTIONAL condition scoping which rows are aggregated, e.g. only the North region>}. The app totals "measure" within each value of "column" (restricted by "where"), keeps only the groups that pass, and filters the chart to them. This is a per-GROUP test on a TOTAL — different from a "filters" "op" entry, which tests each individual ROW. Example — "only the months where North's revenue beat 4000, charted as North's units those months": "x":<month>, "measure":<units>, "filters":[{"column":<region>,"in":["North"]}], "having":{"column":<month>,"measure":<revenue>,"agg":"sum","op":">","value":<4000 token>,"where":{"column":<region>,"in":["North"]}}.
- Use sort "value" only for explicit ranking or "top N" requests; leave it out otherwise so the x-axis keeps its natural order (date axes stay chronological). For "top N" set sort "value", order "desc", and limit to N.
- "display" holds optional look toggles — include the whole "display" object only when the request clearly calls for one, and inside it set ONLY the flags you need: "stacked": true stacks a bar/line/area chart's series (or measures) into a cumulative part-to-whole total (use for "stacked", "cumulative", or contribution requests; it needs a "series" split or multiple "measures"); "horizontal": true turns a BAR chart on its side with the categories on the y-axis (use for "horizontal bar" or to rank long category labels); "step": true draws a LINE as a step/staircase rather than sloped segments (use for "step line" or discrete level changes); "donut": true renders a PIE as a ring/doughnut with a hollow centre; "rose": true renders a PIE as a nightingale/rose chart whose slice radius encodes value. "donut" and "rose" apply only to pie; "stacked", "horizontal", and "step" apply only to bar/line/area and are ignored elsewhere.
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

const FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    column: { type: 'string' },
    in: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
    notIn: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
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
    over: { type: 'string' },
    pick: {
      type: 'object',
      additionalProperties: false,
      properties: {
        column: { type: 'string' },
        datePart: { type: 'string', enum: ['day', 'weekday', 'month', 'quarter'] },
        bucket: { type: 'string' },
        by: { type: 'string' },
        agg: { type: 'string', enum: ['sum', 'avg'] },
        extreme: { type: 'string', enum: ['max', 'min'] },
        where: FILTER_SCHEMA,
      },
      required: ['column', 'by', 'extreme'],
    },
    having: {
      type: 'object',
      additionalProperties: false,
      properties: {
        column: { type: 'string' },
        measure: { type: 'string' },
        agg: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max'] },
        op: { type: 'string', enum: ['>', '>=', '<', '<=', '==', '!='] },
        value: { anyOf: [{ type: 'number' }, { type: 'string' }] },
        where: FILTER_SCHEMA,
      },
      required: ['column', 'measure', 'op', 'value'],
    },
    aggregate: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max', 'none'] },
    filters: { type: 'array', items: FILTER_SCHEMA },
    bucket: { type: 'string' },
    groupByPart: { type: 'string' },
    groups: { type: 'object' },
    window: { type: 'object' },
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
    display: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stacked: { type: 'boolean' },
        horizontal: { type: 'boolean' },
        step: { type: 'boolean' },
        donut: { type: 'boolean' },
        rose: { type: 'boolean' },
      },
    },
  },
  required: ['chartType', 'x'],
}

export const MINIMAL_SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chartType: { type: 'string', enum: ['line', 'bar', 'area', 'pie', 'scatter'] },
    x: { type: 'string' },
    measure: { type: 'string' },
    measures: { type: 'array', items: { type: 'string' } },
    series: { type: 'string' },
    aggregate: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max', 'none'] },
    title: { type: 'string' },
  },
  required: ['chartType', 'x'],
}
