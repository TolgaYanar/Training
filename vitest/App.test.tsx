import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const { generateOption, deidentify } = vi.hoisted(() => ({ generateOption: vi.fn(), deidentify: vi.fn(() => ({ message: 'preview', toReal: {} })) }))
vi.mock('../src/ai', () => ({ generateOption, deidentify }))
vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="chart" /> }))

import App from '../src/App.tsx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('idle state shows the empty prompt', () => {
  render(<App />)
  expect(screen.getByText(/Describe a chart to generate/i)).toBeTruthy()
})

test('shows the active dataset row count (default sales = 144)', () => {
  render(<App />)
  expect(screen.getByText(/Data \(144 rows\)/)).toBeTruthy()
})

test('generate -> ok renders the chart and passes the 144 sales rows', async () => {
  generateOption.mockResolvedValue({ status: 'ok', option: { series: [] }, repaired: false, raw: '{}' })
  render(<App />)
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value:'bar of revenue' } })
  fireEvent.click(screen.getByText('Generate chart'))
  await waitFor(() => expect(screen.getByTestId('chart')).toBeTruthy())
  const arg = generateOption.mock.calls[0][0]
  expect(arg.rows.length).toBe(144)
})

test('generate -> repaired shows the auto-repaired tag', async () => {
  generateOption.mockResolvedValue({ status: 'ok', option: { series: [] }, repaired: true, raw: '{}' })
  render(<App />)
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value:'x' } })
  fireEvent.click(screen.getByText('Generate chart'))
  await waitFor(() => expect(screen.getByText(/auto-repaired/i)).toBeTruthy())
})

test('generate -> failed shows the error result', async () => {
  generateOption.mockResolvedValue({ status: 'failed', error: 'boom-error', raw: '' })
  render(<App />)
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value:'x' } })
  fireEvent.click(screen.getByText('Generate chart'))
  await waitFor(() => expect(screen.getByText(/Could not generate a valid chart/i)).toBeTruthy())
  expect(screen.getByText('boom-error')).toBeTruthy()
})
