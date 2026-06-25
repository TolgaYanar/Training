import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateOption } from '../src/ai.ts'

const rows = [{ ch: 'A', v: 10 }, { ch: 'B', v: 20 }]
const specOf = (o: object) => JSON.stringify(o)
const good = specOf({ chartType: 'bar', x: 'ch', measure: 'v', aggregate: 'sum' })
const badColumn = specOf({ chartType: 'bar', x: 'nope', measure: 'v', aggregate: 'sum' })

function gemini(text: string, ok = true, status = 200) {
  return { ok, status, text: async () => text, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }
}

beforeEach(() => {
  vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('success on first try returns a built option', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => gemini(good)))
  const r = await generateOption({ prompt: 'bar', provider: 'gemini', rows })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    expect(r.repaired).toBe(false)
    expect(Array.isArray((r.option as { series: unknown[] }).series)).toBe(true)
  }
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('repairs after a bad-column spec, then succeeds', async () => {
  const f = vi.fn().mockResolvedValueOnce(gemini(badColumn)).mockResolvedValueOnce(gemini(good))
  vi.stubGlobal('fetch', f)
  const r = await generateOption({ prompt: 'x', provider: 'gemini', rows })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') expect(r.repaired).toBe(true)
  expect(f).toHaveBeenCalledTimes(2)
})

test('both attempts bad -> failed with the column error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => gemini(badColumn)))
  const r = await generateOption({ prompt: 'x', provider: 'gemini', rows })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') expect(r.error).toMatch(/unknown column/)
})

test('missing key -> failed, fetch never called', async () => {
  vi.stubEnv('VITE_GEMINI_API_KEY', '')
  const f = vi.fn()
  vi.stubGlobal('fetch', f)
  const r = await generateOption({ prompt: 'x', provider: 'gemini', rows })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') expect(r.error).toMatch(/Missing VITE_GEMINI_API_KEY/)
  expect(f).not.toHaveBeenCalled()
})

test('HTTP 500 surfaces as failed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => gemini('{"error":{"message":"boom"}}', false, 500)))
  const r = await generateOption({ prompt: 'x', provider: 'gemini', rows })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') expect(r.error).toMatch(/Gemini 500/)
})

test('429 surfaces the quota message with retry delay', async () => {
  const body = JSON.stringify({ error: { code: 429, message: 'quota', details: [{ retryDelay: '25s' }] } })
  vi.stubGlobal('fetch', vi.fn(async () => gemini(body, false, 429)))
  const r = await generateOption({ prompt: 'x', provider: 'gemini', rows })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') {
    expect(r.error).toMatch(/quota reached/)
    expect(r.error).toMatch(/25s/)
  }
})

test('spec wrapped in code fences is still parsed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => gemini('```json\n' + good + '\n```')))
  const r = await generateOption({ prompt: 'x', provider: 'gemini', rows })
  expect(r.status).toBe('ok')
})
