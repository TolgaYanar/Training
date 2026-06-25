import { test, expect } from 'vitest'
import { checkOption } from '../src/validate.ts'

test('a valid option passes the render gate', () => {
  const r = checkOption({ xAxis: { type: 'category', data: ['a', 'b'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [1, 2] }] } as never)
  expect(r.ok).toBe(true)
})

test('an option with no series is rejected', () => {
  const r = checkOption({ xAxis: { type: 'category', data: ['a'] } } as never)
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error).toMatch(/no series/)
})

test('null-bearing line option passes (gaps render, no rejection)', () => {
  const r = checkOption({ xAxis: { type: 'category', data: ['a', 'b', 'c'] }, yAxis: { type: 'value' }, series: [{ type: 'line', data: [1, null, 3] }] } as never)
  expect(r.ok).toBe(true)
})

test('normalizeLayout pins a horizontal legend to the top and adds grid padding', () => {
  const o = { legend: {}, xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' }, series: [{ type: 'line', data: [1] }] }
  checkOption(o as never)
  expect((o as { legend: { top?: unknown } }).legend.top).toBeDefined()
  const grid = (o as { grid?: { containLabel?: unknown; top?: number } }).grid
  expect(grid?.containLabel).toBe(true)
  expect(grid?.top).toBeGreaterThan(0)
})

test('a vertical (side) legend is not repositioned to the top', () => {
  const o = { legend: { orient: 'vertical' }, xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' }, series: [{ type: 'line', data: [1] }] }
  checkOption(o as never)
  expect((o as { legend: { top?: unknown } }).legend.top).toBeUndefined()
})
