import type { ChartSpec, EChartsOption, GenerateRequest, GenerateResult, ProviderId, Row } from './types'
import { summarizeData } from './data'
import { SYSTEM_PROMPT, buildRepairMessage, buildSpecMessage } from './prompt'
import { buildChartOption } from './chart'
import { checkOption, extractJson } from './validate'

const GEMINI_MODEL = 'gemini-2.5-flash'
const CLAUDE_MODEL = 'claude-haiku-4-5'

function envKey(provider: ProviderId): string {
  const key = provider === 'gemini' ? import.meta.env.VITE_GEMINI_API_KEY : import.meta.env.VITE_CLAUDE_API_KEY
  return key ?? ''
}

async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init)
  for (let attempt = 1; attempt <= 3 && res.status === 503; attempt++) {
    await new Promise((r) => setTimeout(r, 1500 * attempt))
    res = await fetch(url, init)
  }
  return res
}

async function geminiComplete(system: string, user: string, key: string): Promise<string> {
  const res = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    if (res.status === 429) {
      const wait = body.match(/"retryDelay":\s*"([^"]+)"/)
      throw new Error(`Gemini free-tier quota reached (429).${wait ? ` Retry in ${wait[1]}.` : ''} Wait and retry, or switch GEMINI_MODEL in ai.ts.`)
    }
    throw new Error(`Gemini ${res.status}: ${body}`)
  }
  const data = await res.json()
  const parts: Array<{ text?: string }> = data?.candidates?.[0]?.content?.parts ?? []
  return parts.map((p) => p.text ?? '').join('')
}

async function claudeComplete(system: string, user: string, key: string): Promise<string> {
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
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const blocks: Array<{ type: string; text?: string }> = data?.content ?? []
  return blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}

function complete(provider: ProviderId, system: string, user: string, key: string): Promise<string> {
  return provider === 'gemini' ? geminiComplete(system, user, key) : claudeComplete(system, user, key)
}

function buildFrom(raw: string, rows: Row[]): { option: EChartsOption } | { error: string } {
  let spec: unknown
  try {
    spec = JSON.parse(extractJson(raw))
  } catch (e) {
    return { error: `Spec JSON parse failed: ${(e as Error).message}` }
  }
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return { error: 'Spec is not a JSON object' }
  let option: EChartsOption
  try {
    option = buildChartOption(spec as ChartSpec, rows)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const checked = checkOption(option)
  if (!checked.ok) return { error: checked.error }
  return { option }
}

export async function generateOption(req: GenerateRequest): Promise<GenerateResult> {
  const key = envKey(req.provider)
  if (!key) {
    const name = req.provider === 'gemini' ? 'VITE_GEMINI_API_KEY' : 'VITE_CLAUDE_API_KEY'
    return { status: 'failed', error: `Missing ${name} in .env`, raw: '' }
  }
  const summary = summarizeData(req.rows)
  const message = buildSpecMessage(req.prompt, summary)

  let raw: string
  try {
    raw = await complete(req.provider, SYSTEM_PROMPT, message, key)
  } catch (e) {
    return { status: 'failed', error: (e as Error).message, raw: '' }
  }
  const first = buildFrom(raw, req.rows)
  if ('option' in first) return { status: 'ok', option: first.option, repaired: false, raw }

  let raw2: string
  try {
    raw2 = await complete(req.provider, SYSTEM_PROMPT, buildRepairMessage(raw, first.error), key)
  } catch (e) {
    return { status: 'failed', error: (e as Error).message, raw }
  }
  const second = buildFrom(raw2, req.rows)
  if ('option' in second) return { status: 'ok', option: second.option, repaired: true, raw: raw2 }
  return { status: 'failed', error: second.error, raw: raw2 }
}
