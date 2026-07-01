import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Row } from '../src/types'
import { buildSchema, type PropField } from '../src/schema'
import { buildFieldIndex } from '../src/fieldIndex'
import { generateChartAI } from '../src/aiChart'

const prop = JSON.parse(readFileSync('formats/propGosterim.json', 'utf8')) as PropField[]
const rows = JSON.parse(readFileSync('formats/response.json', 'utf8')) as Row[]
const index = buildFieldIndex(buildSchema(prop))

function claude(spec: object) {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(spec) }] }), text: async () => '' }
}

beforeEach(() => {
  vi.stubEnv('VITE_CLAUDE_API_KEY', 'test-key')
  vi.stubEnv('VITE_LLM_PROXY', '')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

test('AI path: tokenized request -> spec -> chart; payload carries no raw field/value', async () => {
  let body = ''
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    body = String(init.body)
    return claude({ chartType: 'bar', x: 'col_0', measure: 'col_1', aggregate: 'sum' })
  }))
  const r = await generateChartAI('"Depo İsmi" bazında toplam "Miktar" çubuk', index, rows, 'test-key')
  expect('option' in r).toBe(true)
  const sent = JSON.parse(body).messages[0].content as string
  expect(sent).toMatch(/col_0/)
  expect(sent).toMatch(/col_1/)
  expect(sent).not.toMatch(/depo|ismi|miktar|deneme/i)
})

test('block+ask: an unresolved name returns ask and never calls the network', async () => {
  const f = vi.fn()
  vi.stubGlobal('fetch', f)
  const r = await generateChartAI('Ahmet Yılmaz için miktar', index, rows, 'test-key')
  expect('ask' in r).toBe(true)
  if ('ask' in r) expect(r.ask.some((u) => u.text === 'Ahmet')).toBe(true)
  expect(f).not.toHaveBeenCalled()
})

test('the enum relabel still applies through the AI path', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude({ chartType: 'bar', x: 'col_0', measure: 'col_1', aggregate: 'sum' })))
  const r = await generateChartAI('"Depo Tipi" bazında toplam "Miktar"', index, rows, 'test-key')
  expect('option' in r).toBe(true)
  if ('option' in r) {
    const xs = (r.option as { xAxis: { data: unknown[] } }).xAxis.data
    expect(xs.every((v) => typeof v === 'string')).toBe(true)
    expect(xs.includes(999)).toBe(false)
  }
})
