import { test, expect, vi, afterEach } from 'vitest'

const { generateOption } = vi.hoisted(() => ({ generateOption: vi.fn() }))
vi.mock('../src/ai', () => ({ generateOption }))

import { chartService } from '../src/service.ts'

afterEach(() => {
  vi.clearAllMocks()
})

test('unknown source -> failed without invoking generateOption', async () => {
  const r = await chartService.getChart({ source: 'does-not-exist', prompt: 'x' })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') {
    expect(r.error).toMatch(/Unknown source/)
    expect(r.raw).toBe('')
  }
  expect(generateOption).not.toHaveBeenCalled()
})

test('ok result maps to ChartResponse ok, drops raw, and forwards the resolved rows', async () => {
  generateOption.mockResolvedValueOnce({ status: 'ok', option: { series: [] }, repaired: true, raw: 'RAW' })
  const r = await chartService.getChart({ source: 'sales', prompt: 'monthly revenue' })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    expect(r.repaired).toBe(true)
    expect('raw' in r).toBe(false)
  }
  const arg = generateOption.mock.calls[0][0]
  expect(arg.prompt).toBe('monthly revenue')
  expect(Array.isArray(arg.rows)).toBe(true)
  expect(arg.rows.length).toBeGreaterThan(0)
})

test('failed result forwards error and raw unchanged', async () => {
  generateOption.mockResolvedValueOnce({ status: 'failed', error: 'boom', raw: 'RAWBODY' })
  const r = await chartService.getChart({ source: 'sales', prompt: 'x' })
  expect(r.status).toBe('failed')
  if (r.status === 'failed') {
    expect(r.error).toBe('boom')
    expect(r.raw).toBe('RAWBODY')
  }
})
