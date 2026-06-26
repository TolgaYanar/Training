import type { ChartSpec, EChartsOption, GenerateRequest, GenerateResult, Outbound, Row } from './types'
import { summarizeData } from './data'
import { CHART_SPEC_SCHEMA, SYSTEM_PROMPT, buildRepairMessage, buildSpecMessage } from './prompt'
import { buildChartOption } from './chart'
import { checkOption, extractJson } from './validate'
import { buildTokens, detokenizeSpec, redactLiterals, tokenizeText } from './tokens'

const CLAUDE_MODEL = 'claude-haiku-4-5'

async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init)
  for (let attempt = 1; attempt <= 3 && res.status === 503; attempt++) {
    await new Promise((r) => setTimeout(r, 1500 * attempt))
    res = await fetch(url, init)
  }
  return res
}

async function claudeComplete(system: string, user: Outbound, key: string): Promise<string> {
  const res = await fetchRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      temperature: 0,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema: CHART_SPEC_SCHEMA } },
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const blocks: Array<{ type: string; text?: string }> = data?.content ?? []
  return blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

function buildFrom(raw: string, rows: Row[], toReal: Record<string, string>): { option: EChartsOption } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(raw))
  } catch (e) {
    return { error: `Spec JSON parse failed: ${(e as Error).message}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { error: 'Spec is not a JSON object' }
  let option: EChartsOption
  try {
    option = buildChartOption(detokenizeSpec(parsed as ChartSpec, toReal), rows)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const checked = checkOption(option)
  if (!checked.ok) return { error: checked.error }
  return { option }
}

export function deidentify(prompt: string, rows: Row[]): { message: Outbound; toReal: Record<string, string> } {
  const summary = summarizeData(rows)
  const { summary: schema, toReal } = buildTokens(summary, rows)
  const safePrompt = redactLiterals(tokenizeText(prompt, toReal), toReal)
  return { message: buildSpecMessage(safePrompt, schema), toReal }
}

export async function generateOption(req: GenerateRequest): Promise<GenerateResult> {
  const key = import.meta.env.VITE_CLAUDE_API_KEY ?? ''
  if (!key) return { status: 'failed', error: 'Missing VITE_CLAUDE_API_KEY in .env', raw: '' }
  const { message, toReal } = deidentify(req.prompt, req.rows)

  let raw: string
  try {
    raw = await claudeComplete(SYSTEM_PROMPT, message, key)
  } catch (e) {
    return { status: 'failed', error: (e as Error).message, raw: '' }
  }
  const first = buildFrom(raw, req.rows, toReal)
  if ('option' in first) return { status: 'ok', option: first.option, repaired: false, raw }

  let raw2: string
  try {
    raw2 = await claudeComplete(SYSTEM_PROMPT, buildRepairMessage(tokenizeText(raw, toReal), tokenizeText(first.error, toReal)), key)
  } catch (e) {
    return { status: 'failed', error: (e as Error).message, raw }
  }
  const second = buildFrom(raw2, req.rows, toReal)
  if ('option' in second) return { status: 'ok', option: second.option, repaired: true, raw: raw2 }
  return { status: 'failed', error: second.error, raw: raw2 }
}
