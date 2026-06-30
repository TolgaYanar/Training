import { test, expect } from 'vitest'
import { assembleOption } from '../src/chartCompute'
import { computeOption, WORKER_THRESHOLD } from '../src/workerClient'
import type { ChartSpec, Row } from '../src/types'

const rows: Row[] = [
  { region: 'North', revenue: 10 },
  { region: 'South', revenue: 20 },
  { region: 'North', revenue: 5 },
]
const spec = { chartType: 'bar', x: 'region', measure: 'revenue', aggregate: 'sum' } as unknown as ChartSpec

test('assembleOption builds an option for a valid spec', () => {
  const r = assembleOption(spec, 'revenue by region', rows, false)
  expect('option' in r).toBe(true)
  if ('option' in r) expect(r.option.series).toBeTruthy()
})

test('assembleOption returns an error for an unknown column (no throw escapes)', () => {
  const bad = { chartType: 'bar', x: 'nope', measure: 'revenue' } as unknown as ChartSpec
  const r = assembleOption(bad, 'x', rows, false)
  expect('error' in r).toBe(true)
})

test('computeOption runs synchronously below the worker threshold and matches assembleOption', async () => {
  expect(rows.length).toBeLessThan(WORKER_THRESHOLD)
  const viaCompute = await computeOption(spec, 'revenue by region', rows, false)
  const direct = assembleOption(spec, 'revenue by region', rows, false)
  expect(viaCompute).toEqual(direct)
})

test('computeOption always returns a Promise (uniform async contract)', () => {
  expect(computeOption(spec, 'x', rows, false)).toBeInstanceOf(Promise)
})
