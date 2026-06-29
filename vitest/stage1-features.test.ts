import { test, expect } from 'vitest'
import { buildChartOption } from '../src/chart.ts'
import { checkOption } from '../src/validate.ts'
import type { ChartSpec } from '../src/types.ts'

const rows = [
  { day: 'Mon', team: 'A', score: 10 },
  { day: 'Mon', team: 'B', score: 20 },
  { day: 'Tue', team: 'A', score: 15 },
  { day: 'Tue', team: 'B', score: 30 },
  { day: 'Wed', team: 'A', score: 5 },
  { day: 'Wed', team: 'B', score: 25 },
]
const pieRows = [{ k: 'A', v: 10 }, { k: 'B', v: 20 }, { k: 'C', v: 5 }]

function renders(spec: ChartSpec, data: unknown[]) {
  const r = checkOption(buildChartOption(spec, data as never))
  if (!r.ok) throw new Error(r.error)
  expect(r.ok).toBe(true)
}

test('stacked grouped bar passes the render gate', () => {
  renders({ chartType: 'bar', x: 'day', series: 'team', measure: 'score', aggregate: 'sum', display: { stacked: true } }, rows)
})

test('stacked area passes the render gate', () => {
  renders({ chartType: 'area', x: 'day', series: 'team', measure: 'score', aggregate: 'sum', display: { stacked: true } }, rows)
})

test('horizontal bar passes the render gate', () => {
  renders({ chartType: 'bar', x: 'day', measure: 'score', aggregate: 'sum', display: { horizontal: true } }, rows)
})

test('step line passes the render gate', () => {
  renders({ chartType: 'line', x: 'day', measure: 'score', aggregate: 'sum', display: { step: true } }, rows)
})

test('doughnut pie passes the render gate', () => {
  renders({ chartType: 'pie', x: 'k', measure: 'v', aggregate: 'sum', display: { donut: true } }, pieRows)
})

test('nightingale pie passes the render gate', () => {
  renders({ chartType: 'pie', x: 'k', measure: 'v', aggregate: 'sum', display: { rose: true } }, pieRows)
})

test('doughnut + nightingale combined passes the render gate', () => {
  renders({ chartType: 'pie', x: 'k', measure: 'v', aggregate: 'sum', display: { donut: true, rose: true } }, pieRows)
})
