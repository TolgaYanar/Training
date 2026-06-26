import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateOption } from '../src/ai.ts'

const rows = [{ ch: 'A', v: 10 }, { ch: 'B', v: 20 }]
const specOf = (o: object) => JSON.stringify(o)
const good = specOf({ chartType: 'bar', x: 'ch', measure: 'v', aggregate: 'sum' })
const badColumn = specOf({ chartType: 'bar', x: 'nope', measure: 'v', aggregate: 'sum' })

function claude(text: string, ok = true, status = 200) {
  return { ok, status, text: async () => text, json: async () => ({ content: [{ type: 'text', text }] }) }
}

beforeEach(() => {
  vi.stubEnv('VITE_CLAUDE_API_KEY', 'test-key')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('success on first try returns a built option', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(good)))
  const r = await generateOption({ prompt: 'bar', rows })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    expect(r.repaired).toBe(false)
    expect(Array.isArray((r.option as { series: unknown[] }).series)).toBe(true)
  }
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('repairs after a bad-column spec, then succeeds', async () => {
  const f = vi.fn().mockResolvedValueOnce(claude(badColumn)).mockResolvedValueOnce(claude(good))
  vi.stubGlobal('fetch', f)
  const r = await generateOption({ prompt: 'x', rows })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') expect(r.repaired).toBe(true)
  expect(f).toHaveBeenCalledTimes(2)
})

test('both attempts bad -> failed with the column error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(badColumn)))
  const r = await generateOption({ prompt: 'x', rows })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') expect(r.error).toMatch(/unknown column/)
})

test('missing key -> failed, fetch never called', async () => {
  vi.stubEnv('VITE_CLAUDE_API_KEY', '')
  const f = vi.fn()
  vi.stubGlobal('fetch', f)
  const r = await generateOption({ prompt: 'x', rows })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') expect(r.error).toMatch(/Missing VITE_CLAUDE_API_KEY/)
  expect(f).not.toHaveBeenCalled()
})

test('HTTP 500 surfaces as failed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude('{"error":{"message":"boom"}}', false, 500)))
  const r = await generateOption({ prompt: 'x', rows })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') expect(r.error).toMatch(/Claude 500/)
})

test('HTTP 429 surfaces as failed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude('{"error":{"message":"rate limited"}}', false, 429)))
  const r = await generateOption({ prompt: 'x', rows })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') expect(r.error).toMatch(/Claude 429/)
})

test('spec wrapped in code fences is still parsed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude('```json\n' + good + '\n```')))
  const r = await generateOption({ prompt: 'x', rows })
  expect(r.status).toBe('ok')
})

test('outbound payload is de-identified: no real column names or values leave the device', async () => {
  const sensitive = [{ department: 'Engineering', salary: 100 }, { department: 'Sales', salary: 200 }]
  let body = ''
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    body = String(init.body)
    return claude(specOf({ chartType: 'bar', x: 'col_0', measure: 'col_1', aggregate: 'sum' }))
  }))
  const r = await generateOption({ prompt: 'salary by department for Engineering', rows: sensitive })
  expect(r.status).toBe('ok')
  const userMsg = JSON.parse(body).messages[0].content as string
  expect(userMsg).not.toMatch(/salary|department|Engineering|Sales/)
  expect(userMsg).toMatch(/col_0|col_1/)
  // and the real names still come back for rendering
  if (r.status === 'ok') {
    const series = (r.option as { series: Array<{ name?: string }> }).series
    expect(series[0].name).toBe('salary')
  }
})

test('numeric and date literals typed in the prompt are redacted before egress', async () => {
  const rows = [{ region: 'North', revenue: 100 }]
  let body = ''
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    body = String(init.body)
    return claude(specOf({ chartType: 'bar', x: 'col_0', measure: 'col_1', aggregate: 'sum' }))
  }))
  await generateOption({ prompt: 'revenue over 99999 on 2024-01-15, top 5', rows })
  const userMsg = JSON.parse(body).messages[0].content as string
  expect(userMsg).not.toContain('99999')
  expect(userMsg).not.toContain('2024-01-15')
  expect(userMsg).toContain('top 5') // small control numbers survive
})
