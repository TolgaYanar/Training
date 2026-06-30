import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const { generateOption, deidentify } = vi.hoisted(() => ({ generateOption: vi.fn(), deidentify: vi.fn(() => ({ message: 'preview', toReal: {} })) }))
vi.mock('../src/ai', () => ({ generateOption, deidentify, CLAUDE_MODEL: 'claude-sonnet-4-6' }))
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

test('a repeated (dataset, prompt) is served from cache without a second AI call', async () => {
  generateOption.mockResolvedValue({ status: 'ok', option: { series: [] }, repaired: false, raw: '{}' })
  render(<App />)
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value: 'bar of revenue' } })
  fireEvent.click(screen.getByText('Generate chart'))
  await waitFor(() => expect(screen.getByTestId('chart')).toBeTruthy())
  expect(generateOption).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('Generate chart'))
  await waitFor(() => expect(screen.getByTestId('chart')).toBeTruthy())
  expect(generateOption).toHaveBeenCalledTimes(1)
})

test('generate -> repaired shows the auto-repaired tag', async () => {
  generateOption.mockResolvedValue({ status: 'ok', option: { series: [] }, repaired: true, raw: '{}' })
  render(<App />)
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value:'x' } })
  fireEvent.click(screen.getByText('Generate chart'))
  await waitFor(() => expect(screen.getByText(/auto-repaired/i)).toBeTruthy())
})

test('after a run the Sent-to-AI card shows every transmitted request including the repair', async () => {
  generateOption.mockResolvedValue({
    status: 'ok', option: { series: [] }, repaired: true, raw: '{}',
    sent: [
      { system: 'SYS PROMPT', user: 'first user payload' },
      { system: 'SYS PROMPT', user: 'repair user payload' },
    ],
  })
  render(<App />)
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value: 'x' } })
  fireEvent.click(screen.getByText('Generate chart'))
  await waitFor(() => expect(screen.getByText('repair user payload')).toBeTruthy())
  expect(screen.getByText('first user payload')).toBeTruthy()
  expect(screen.getByText(/Request 2 of 2/)).toBeTruthy()
})

test('generate -> failed shows the error result', async () => {
  generateOption.mockResolvedValue({ status: 'failed', error: 'boom-error', raw: '' })
  render(<App />)
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value:'x' } })
  fireEvent.click(screen.getByText('Generate chart'))
  await waitFor(() => expect(screen.getByText(/Could not generate a valid chart/i)).toBeTruthy())
  expect(screen.getByText('boom-error')).toBeTruthy()
})

test('the standalone privacy panel surfaces what was de-identified', () => {
  deidentify.mockReturnValueOnce({ message: 'preview', toReal: { col_0: 'region', val_0: 'North', lit_0: 'Jonathan' } })
  render(<App />)
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value: 'revenue for Jonathan by region' } })
  expect(screen.getByText(/Kept on your device/i)).toBeTruthy()
  expect(screen.getByText(/name.*free-text/i)).toBeTruthy()
  expect(screen.getByText(/1 column name/i)).toBeTruthy()
})

test('the privacy panel warns about possible names that pass through verbatim', () => {
  deidentify.mockReturnValueOnce({ message: 'preview', toReal: {}, safePrompt: 'revenue by region for Mark Day' })
  render(<App />)
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value: 'revenue by region for Mark Day' } })
  expect(screen.getByText(/Possible names will be sent/i)).toBeTruthy()
  expect(screen.getAllByText(/Mark Day/).length).toBeGreaterThan(0)
})

test('a pasted data dump is blocked and disables Generate (gate-independent of the dev card)', () => {
  render(<App />)
  const paste = 'name,email,phone\nJohn,j@x.io,5551234567\nMary,m@x.io,5559876543\nLee,l@x.io,5551112222'
  fireEvent.change(screen.getByPlaceholderText(/monthly revenue/i), { target: { value: paste } })
  expect(screen.getByText(/looks like pasted data/i)).toBeTruthy()
  expect(screen.getByRole('button', { name: /Generate chart/i }).hasAttribute('disabled')).toBe(true)
})
