import type { ChartSpec, EChartsOption, GenerateRequest, GenerateResult, Outbound, Row, SentRequest } from './types'
import { summarizeData } from './data'
import { MINIMAL_SPEC_SCHEMA, SYSTEM_PROMPT, buildRepairMessage, buildSpecMessage } from './prompt'
import { buildChartOption } from './chart'
import { checkOption, extractJson, validateSpec } from './validate'
import { buildTokens, detokenizeSpec, redactLiterals, tokenizeText } from './tokens'
import { enforceNamedFilters } from './guardrails'

export const CLAUDE_MODEL = 'claude-sonnet-4-6'

const RETRYABLE_STATUS = new Set([429, 503, 529])

async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init)
  for (let attempt = 1; attempt <= 3 && RETRYABLE_STATUS.has(res.status); attempt++) {
    await new Promise((r) => setTimeout(r, 1500 * attempt))
    res = await fetch(url, init)
  }
  return res
}

function llmProxyUrl(): string {
  return (import.meta.env.VITE_LLM_PROXY ?? '').trim()
}

async function claudeComplete(system: string, user: Outbound, key: string, schema?: object): Promise<string> {
  const body: Record<string, unknown> = {
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: user }],
  }
  if (schema) body.output_config = { format: { type: 'json_schema', schema } }
  const proxy = llmProxyUrl()
  const res = await fetchRetry(proxy || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: proxy
      ? { 'content-type': 'application/json' }
      : {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const blocks: Array<{ type: string; text?: string }> = data?.content ?? []
  return blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

function buildFrom(raw: string, prompt: string, rows: Row[], toReal: Record<string, string>, allowEmpty = false): { option: EChartsOption } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(raw))
  } catch (e) {
    return { error: `Spec JSON parse failed: ${(e as Error).message}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { error: 'Spec is not a JSON object' }
  const schemaError = validateSpec(parsed)
  if (schemaError) return { error: schemaError }
  let option: EChartsOption
  try {
    option = buildChartOption(enforceNamedFilters(detokenizeSpec(parsed as ChartSpec, toReal), prompt, rows), rows, allowEmpty)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const checked = checkOption(option)
  if (!checked.ok) return { error: checked.error }
  return { option }
}

export function deidentify(prompt: string, rows: Row[]): { message: Outbound; toReal: Record<string, string>; safePrompt: string } {
  const summary = summarizeData(rows)
  const { summary: schema, toReal } = buildTokens(summary, rows)
  const safePrompt = redactLiterals(tokenizeText(prompt, toReal), toReal)
  return { message: buildSpecMessage(safePrompt, schema), toReal, safePrompt }
}

export async function generateOption(req: GenerateRequest): Promise<GenerateResult> {
  const sent: SentRequest[] = []
  const key = import.meta.env.VITE_CLAUDE_API_KEY ?? ''
  if (!key && !llmProxyUrl()) return { status: 'failed', error: 'Missing VITE_CLAUDE_API_KEY in .env', raw: '', sent }
  const { message, toReal } = deidentify(req.prompt, req.rows)

  let raw: string
  try {
    sent.push({ system: SYSTEM_PROMPT, user: message })
    raw = await claudeComplete(SYSTEM_PROMPT, message, key)
  } catch (e) {
    return { status: 'failed', error: (e as Error).message, raw: '', sent }
  }
  const first = buildFrom(raw, req.prompt, req.rows, toReal)
  if ('option' in first) return { status: 'ok', option: first.option, repaired: false, raw, sent }

  let raw2: string
  try {
    const safeRaw = redactLiterals(tokenizeText(raw, toReal), toReal)
    const safeError = redactLiterals(tokenizeText(first.error, toReal), toReal)
    const repair = buildRepairMessage(safeRaw, safeError)
    sent.push({ system: SYSTEM_PROMPT, user: repair })
    raw2 = await claudeComplete(SYSTEM_PROMPT, repair, key)
  } catch (e) {
    return { status: 'failed', error: (e as Error).message, raw, sent }
  }
  const second = buildFrom(raw2, req.prompt, req.rows, toReal, true)
  if ('option' in second) return { status: 'ok', option: second.option, repaired: true, raw: raw2, sent }

  const refused = (e: string): boolean => e.startsWith('Spec JSON parse failed') || e === 'Spec is not a JSON object'
  if (!refused(first.error) && !refused(second.error)) return { status: 'failed', error: second.error, raw: raw2, sent }

  let raw3: string
  try {
    const safeRaw = redactLiterals(tokenizeText(raw2, toReal), toReal)
    const safeError = redactLiterals(tokenizeText(second.error, toReal), toReal)
    const repair = buildRepairMessage(safeRaw, safeError)
    sent.push({ system: SYSTEM_PROMPT, user: repair })
    raw3 = await claudeComplete(SYSTEM_PROMPT, repair, key, MINIMAL_SPEC_SCHEMA)
  } catch (e) {
    return { status: 'failed', error: (e as Error).message, raw: raw2, sent }
  }
  const third = buildFrom(raw3, req.prompt, req.rows, toReal, true)
  if ('option' in third) return { status: 'ok', option: third.option, repaired: true, raw: raw3, sent }
  return { status: 'failed', error: third.error, raw: raw3, sent }
}
