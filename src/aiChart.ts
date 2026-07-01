import type { ChartSpec, EChartsOption, Row } from './types'
import type { FieldIndex } from './fieldIndex'
import type { FieldType } from './schema'
import { fold } from './fieldIndex.ts'
import { tokenizeSentence, type Unresolved } from './tokenize.ts'
import { buildDenySet, sealOutbound, type Outbound } from './tripwire.ts'
import { detokenizeSpec } from './tokens.ts'
import { extractJson, validateSpec } from './validate.ts'
import { renderChart } from './toChart.ts'

export const CLAUDE_MODEL = 'claude-sonnet-5'

const SYSTEM_PROMPT = `You convert a de-identified Turkish chart request into ONE JSON chart spec, and nothing else. No prose, no markdown, no code fences.
You NEVER see real data. Fields appear only as opaque tokens col_0, col_1, …; category values as val_0, …; literals (numbers/dates) as lit_0, ….
Input is two lines. Line 1 is the request in free Turkish with those tokens standing in for field/value names. Line 2 lists each col_N token's data type: sayısal (number), kategorik (category), tarihsel (date), mantıksal (boolean).
Interpret the Turkish intent in ANY phrasing and output a ChartSpec that references ONLY the given col_/val_/lit_ tokens:
- chartType: line | bar | area | pie | scatter  (çizgi | çubuk/sütun | alan | pasta | dağılım/nokta)
- x: the dimension token (the token right before "göre"/"bazında"/"başına"; or a tarihsel token for a time trend)
- measure: the sayısal token being measured
- aggregate (ALWAYS set this, never omit): sum(toplam) | avg(ortalama) | count(adet/sayı, when there is no measure) | min(en düşük/en az bir ölçü) | max(en yüksek/en fazla bir ölçü). Default to sum when a measure exists, count otherwise.
- series: a SECOND grouping token in addition to x. Set it whenever a second kategorik token appears as a grouping or split — triggers: "… ayır", "… ayrı ayrı", "her … için ayrı", "… kırılımıyla", or a second "… bazında"/"…'e göre" token. RULE: when two grouping tokens appear, the FIRST is x and the SECOND is series — never drop the second token.
- bucket: when the request groups a tarihsel x by a period you MUST set it — aylık/aya göre/ayda → month; haftalık → week; çeyreklik → quarter; yıllık → year (put the tarihsel token on x).
- ranking: a number together with çok/az/fazla/ilk/ağır/büyük/küçük/yüksek/düşük means top-N/bottom-N — set sort="value", limit=N, and order="desc" for en çok/en fazla/en ağır/en büyük/en yüksek/ilk, "asc" for en az/en düşük/en küçük.
- filters: [{ "column": <token>, "in": [val_/lit_ tokens] }] or numeric { "column": <token>, "op": ">|>=|<|<=|=|!=", "value": <number or lit_ token> }
Examples:
"col_0 aylık toplam col_1 çizgi" (col_0 tarihsel, col_1 sayısal) → {"chartType":"line","x":"col_0","bucket":"month","measure":"col_1","aggregate":"sum"}
"col_0 ortalama col_1 en az 3" (col_0 kategorik, col_1 sayısal) → {"chartType":"bar","x":"col_0","measure":"col_1","aggregate":"avg","sort":"value","order":"asc","limit":3}
"col_0 aylık toplam col_1 col_2 ayrı ayrı" (col_0 tarihsel, col_1 sayısal, col_2 kategorik) → {"chartType":"line","x":"col_0","bucket":"month","measure":"col_1","aggregate":"sum","series":"col_2"}
Required: chartType, x, aggregate. Emit JSON only.`

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

const AI_SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chartType: { type: 'string', enum: ['line', 'bar', 'area', 'pie', 'scatter'] },
    x: { type: 'string' },
    measure: { type: 'string' },
    series: { type: 'string' },
    aggregate: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max', 'none'] },
    bucket: { type: 'string', enum: ['week', 'month', 'quarter', 'year'] },
    filters: { type: 'array', items: FILTER_SCHEMA },
    sort: { type: 'string', enum: ['value'] },
    order: { type: 'string', enum: ['asc', 'desc'] },
    limit: { type: 'integer' },
    title: { type: 'string' },
  },
  required: ['chartType', 'x', 'aggregate'],
}

const RETRYABLE = new Set([429, 503, 529])

function proxyUrl(): string {
  return (import.meta.env.VITE_LLM_PROXY ?? '').trim()
}

async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init)
  for (let attempt = 1; attempt <= 3 && RETRYABLE.has(res.status); attempt++) {
    await new Promise((r) => setTimeout(r, 1500 * attempt))
    res = await fetch(url, init)
  }
  return res
}

async function claudeComplete(user: Outbound, key: string): Promise<string> {
  const proxy = proxyUrl()
  const res = await fetchRetry(proxy || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: proxy
      ? { 'content-type': 'application/json' }
      : { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema: AI_SPEC_SCHEMA } },
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const blocks: Array<{ type: string; text?: string }> = data?.content ?? []
  return blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

const TYPE_TR: Record<FieldType, string> = { number: 'sayısal', categorical: 'kategorik', date: 'tarihsel', boolean: 'mantıksal' }
const denyCache = new WeakMap<Row[], Set<string>>()

export type AiResult = { option: EChartsOption; spec: ChartSpec } | { error: string } | { ask: Unresolved[] }

export async function generateChartAI(sentence: string, index: FieldIndex, rows: Row[], key: string): Promise<AiResult> {
  const { payload, toReal, unresolved } = tokenizeSentence(sentence, index, rows)
  if (unresolved.length > 0) return { ask: unresolved }
  if (!payload.trim()) return { error: 'Boş istem.' }
  if (!key && !proxyUrl()) return { error: 'VITE_CLAUDE_API_KEY (.env) eksik.' }

  const byAnahtar = new Map(index.fields.map((f) => [f.anahtar, f]))
  const typeLine = Object.entries(toReal)
    .filter(([k]) => k.startsWith('col_'))
    .map(([k, a]) => `${k} ${TYPE_TR[byAnahtar.get(a)!.type]}`)
    .join(' ')
  const message = typeLine ? `${payload}\n${typeLine}` : payload

  let deny = denyCache.get(rows)
  if (!deny) { deny = buildDenySet(index.fields, rows); denyCache.set(rows, deny) }

  let sealed: Outbound
  try { sealed = sealOutbound(message, new Set(Object.keys(toReal)), deny) } catch (e) { return { error: (e as Error).message } }

  let raw: string
  try { raw = await claudeComplete(sealed, key) } catch (e) { return { error: (e as Error).message } }

  let parsed: unknown
  try { parsed = JSON.parse(extractJson(raw)) } catch (e) { return { error: `AI yanıtı ayrıştırılamadı: ${(e as Error).message}` } }
  const schemaErr = validateSpec(parsed)
  if (schemaErr) return { error: schemaErr }

  const spec = detokenizeSpec(parsed as ChartSpec, toReal)
  const cols = Object.entries(toReal).filter(([k]) => k.startsWith('col_')).map(([, a]) => a)
  if (!spec.measure && spec.aggregate !== 'count') {
    const used = new Set([spec.x, spec.series].filter(Boolean))
    const num = cols.find((a) => byAnahtar.get(a)?.type === 'number' && !used.has(a))
    if (num) spec.measure = num
  }
  if (!spec.series && /ayir|ayri|kirilim/.test(fold(payload))) {
    const used = new Set([spec.x, spec.measure].filter(Boolean))
    const cat = cols.find((a) => { const t = byAnahtar.get(a)?.type; return (t === 'categorical' || t === 'boolean') && !used.has(a) })
    if (cat) spec.series = cat
  }
  const enumFields = [spec.x, spec.series, ...(spec.filters ?? []).map((fl) => fl.column)]
    .filter((a): a is string => typeof a === 'string')
    .map((a) => byAnahtar.get(a))
  const r = renderChart(spec, rows, enumFields)
  if ('error' in r) return r
  return { option: r.option, spec }
}

export function previewTokens(sentence: string, index: FieldIndex, rows: Row[]): { payload: string; toReal: Record<string, string>; unresolved: Unresolved[] } {
  return tokenizeSentence(sentence, index, rows)
}
