import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateOption } from '../src/ai.ts'
import { datasets } from '../src/data.ts'

const rows = [{ ch: 'A', v: 10 }, { ch: 'B', v: 20 }]
const specOf = (o: object) => JSON.stringify(o)
const good = specOf({ chartType: 'bar', x: 'ch', measure: 'v', aggregate: 'sum' })
const badColumn = specOf({ chartType: 'bar', x: 'nope', measure: 'v', aggregate: 'sum' })

function claude(text: string, ok = true, status = 200) {
  return { ok, status, text: async () => text, json: async () => ({ content: [{ type: 'text', text }] }) }
}

beforeEach(() => {
  vi.stubEnv('VITE_CLAUDE_API_KEY', 'test-key')
  vi.stubEnv('VITE_LLM_PROXY', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
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

test('a single prose refusal is recovered by the schema-free repair', async () => {
  const f = vi.fn().mockResolvedValueOnce(claude("I'm sorry, I don't have data for that request.")).mockResolvedValueOnce(claude(good))
  vi.stubGlobal('fetch', f)
  const r = await generateOption({ prompt: 'x', rows })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') expect(r.repaired).toBe(true)
  expect(f).toHaveBeenCalledTimes(2)
  expect(JSON.parse(String((f.mock.calls[0][1] as RequestInit).body)).output_config).toBeUndefined()
  expect(JSON.parse(String((f.mock.calls[1][1] as RequestInit).body)).output_config).toBeUndefined()
})

test('a double prose refusal is recovered by a final forced-JSON attempt', async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(claude("I'm sorry, I can't do that."))
    .mockResolvedValueOnce(claude('I still cannot produce that chart.'))
    .mockResolvedValueOnce(claude(good))
  vi.stubGlobal('fetch', f)
  const r = await generateOption({ prompt: 'x', rows })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') expect(r.repaired).toBe(true)
  expect(f).toHaveBeenCalledTimes(3)
  const bodies = f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)))
  expect(bodies[0].output_config).toBeUndefined()
  expect(bodies[1].output_config).toBeUndefined()
  expect(bodies[2].output_config).toBeDefined()
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

test('HTTP 429 is retried with backoff, then surfaces as failed', async () => {
  vi.useFakeTimers()
  const f = vi.fn(async () => claude('{"error":{"message":"rate limited"}}', false, 429))
  vi.stubGlobal('fetch', f)
  const p = generateOption({ prompt: 'x', rows })
  await vi.runAllTimersAsync()
  const r = await p
  expect(r.status).toBe('failed')
  if (r.status === 'failed') expect(r.error).toMatch(/Claude 429/)
  expect(f).toHaveBeenCalledTimes(4)
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
  if (r.status === 'ok') {
    const series = (r.option as { series: Array<{ name?: string }> }).series
    expect(series[0].name).toBe('salary')
  }
})

test('the repair request body is also de-identified: redactLiterals runs on the second egress', async () => {
  const bodies: string[] = []
  const badWithLiteral = specOf({ chartType: 'bar', x: 'nope', measure: 'v', aggregate: 'sum', title: 'trend since 2024-03-15 total 987654' })
  const f = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body))
    return bodies.length === 1 ? claude(badWithLiteral) : claude(good)
  })
  vi.stubGlobal('fetch', f)
  const r = await generateOption({ prompt: 'x', rows })
  expect(r.status).toBe('ok')
  expect(f).toHaveBeenCalledTimes(2)
  const repairMsg = JSON.parse(bodies[1]).messages[0].content as string
  expect(repairMsg).not.toContain('987654')
  expect(repairMsg).not.toContain('2024-03-15')
})

const traffic = () => datasets.find((d) => d.id === 'traffic')!.rows
const xAxisOf = (r: Awaited<ReturnType<typeof generateOption>>): string[] =>
  r.status === 'ok' ? (r.option as { xAxis: { data: string[] } }).xAxis.data : []

test('a bucket is kept when an explicit period word is present', async () => {
  const modelSpec = specOf({ chartType: 'line', x: 'col_0', measure: 'col_2', aggregate: 'sum', bucket: 'month' })
  vi.stubGlobal('fetch', vi.fn(async () => claude(modelSpec)))
  const xs = xAxisOf(await generateOption({ prompt: 'monthly visits as a line chart', rows: traffic() }))
  expect(xs.length).toBe(12)
})

test('the model emits groupByPart weekday -> cyclic 7-point breakdown', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'bar', x: 'col_0', measure: 'col_2', aggregate: 'avg', groupByPart: 'weekday' }))))
  const xs = xAxisOf(await generateOption({ prompt: 'average visits by weekday', rows: traffic() }))
  expect(xs.length).toBe(7)
  expect(xs).toContain('Mon')
})

test('the model can emit groupByPart directly (month-of-year grouping)', async () => {
  const modelSpec = specOf({ chartType: 'bar', x: 'col_0', measure: 'col_2', aggregate: 'avg', groupByPart: 'month' })
  vi.stubGlobal('fetch', vi.fn(async () => claude(modelSpec)))
  const xs = xAxisOf(await generateOption({ prompt: 'average visits by calendar month', rows: traffic() }))
  expect(xs.length).toBe(12)
  expect(xs[0]).toBe('Jan')
})

test('a monthly bucket survives when "daily" describes the source, not the target granularity', async () => {
  const modelSpec = specOf({ chartType: 'bar', x: 'col_0', measure: 'col_2', aggregate: 'sum', bucket: 'month' })
  vi.stubGlobal('fetch', vi.fn(async () => claude(modelSpec)))
  expect(xAxisOf(await generateOption({ prompt: 'Bucket the daily traffic into monthly totals', rows: traffic() })).length).toBe(12)
})

test('exclusion: "all channels except Email" keeps the other three', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'bar', x: 'col_1', measure: 'col_2', aggregate: 'sum', filters: [{ column: 'col_1', notIn: ['val_3'] }] }))))
  const r = await generateOption({ prompt: 'total visits by channel for all channels except Email', rows: traffic() })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    const xs = (r.option as { xAxis: { data: string[] } }).xAxis.data
    expect(xs.length).toBe(3)
    expect(xs).not.toContain('Email')
  }
})

test('exclusion: "excluding weekends" keeps only weekday rows', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'line', x: 'col_0', measure: 'col_2', aggregate: 'sum', filters: [{ column: 'col_0', datePart: 'weekday', in: [1, 2, 3, 4, 5] }] }))))
  const xs = xAxisOf(await generateOption({ prompt: 'daily visits excluding weekends', rows: traffic() }))
  expect(xs.length).toBeGreaterThan(250)
  expect(xs.length).toBeLessThan(270)
  for (const d of xs) { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); expect(wd === 0 || wd === 6).toBe(false) }
})

test('weekday FILTER: "restricted to weekdays ... day by day" keeps individual weekday dates (not a 7-point cyclic collapse)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'line', x: 'col_0', measure: 'col_2', aggregate: 'sum', filters: [{ column: 'col_0', datePart: 'quarter', in: [1, 2] }, { column: 'col_0', datePart: 'weekday', in: [1, 2, 3, 4, 5] }] }))))
  const xs = xAxisOf(await generateOption({ prompt: 'daily visits restricted to weekdays in the first half of the year, show the trend day by day', rows: traffic() }))
  expect(xs.length).toBe(130)
  for (const d of xs) { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); expect(wd === 0 || wd === 6).toBe(false) }
})

test('weekend FILTER: "only on weekends" keeps just Saturday/Sunday dates', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'line', x: 'col_0', measure: 'col_2', aggregate: 'sum', filters: [{ column: 'col_0', datePart: 'weekday', in: [0, 6] }] }))))
  const xs = xAxisOf(await generateOption({ prompt: 'daily visits only on weekends over the year', rows: traffic() }))
  expect(xs.length).toBeGreaterThan(95)
  expect(xs.length).toBeLessThan(110)
  for (const d of xs) { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); expect(wd === 0 || wd === 6).toBe(true) }
})

test('engine counts rows per x when the model asks for aggregate "count" (the count decision itself is the model\'s job)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'bar', x: 'col_1', aggregate: 'count', filters: [{ column: 'col_0', datePart: 'month', in: [2] }, { column: 'col_2', op: '>', value: 600 }] }))))
  const r = await generateOption({ prompt: 'count of channels whose visits exceed 600 in February', rows: traffic() })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    const o = r.option as { xAxis: { data: string[] }; series: { data: number[] }[] }
    expect(o.xAxis.data).toEqual(['Organic', 'Paid', 'Social', 'Email'])
    expect(o.series[0].data).toEqual([29, 21, 29, 0])
  }
})

test('single-day range: "just on 2024-08-15" filters to that one date', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'bar', x: 'col_1', measure: 'col_2', aggregate: 'sum' }))))
  const r = await generateOption({ prompt: 'visits by channel just on 2024-08-15', rows: traffic() })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    const xs = (r.option as { xAxis: { data: string[] } }).xAxis.data
    expect(xs.length).toBe(4)
  }
})

test('the AI emits summer as a month datePart filter -> Jun-Aug only', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'line', x: 'col_0', measure: 'col_2', aggregate: 'sum', filters: [{ column: 'col_0', datePart: 'month', in: [6, 7, 8] }] }))))
  const xs = xAxisOf(await generateOption({ prompt: 'daily visits over the summer months', rows: traffic() }))
  expect(xs.length).toBe(92)
  for (const d of xs) expect(['06', '07', '08']).toContain(d.slice(5, 7))
})

test('relative window: "last 30 days" relative to the data max date', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'line', x: 'col_0', measure: 'col_2', aggregate: 'sum', window: { anchor: 'last', count: 30, unit: 'day' } }))))
  const xs = xAxisOf(await generateOption({ prompt: 'show me daily visits for the last 30 days', rows: traffic() }))
  expect(xs.length).toBe(30)
  expect(xs[xs.length - 1]).toBe('2024-12-30')
})

test('relative window: "March and April only" -> two months', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'line', x: 'col_0', measure: 'col_2', aggregate: 'sum', filters: [{ column: 'col_0', datePart: 'month', in: [3, 4] }] }))))
  const xs = xAxisOf(await generateOption({ prompt: 'show visits for March and April only', rows: traffic() }))
  expect(xs.length).toBe(61)
  for (const d of xs) expect(['03', '04']).toContain(d.slice(5, 7))
})

test('impossible filter on both attempts -> ok with an empty chart (no wasted failure)', async () => {
  const impossible = specOf({ chartType: 'bar', x: 'region', measure: 'units', aggregate: 'sum', filter: { column: 'region', in: ['Atlantis'] } })
  const sales = datasets.find((d) => d.id === 'sales')!.rows
  const f = vi.fn(async () => claude(impossible))
  vi.stubGlobal('fetch', f)
  const r = await generateOption({ prompt: 'units in Atlantis', rows: sales })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    expect(r.repaired).toBe(true)
    expect((r.option as { series: { data: unknown[] }[] }).series[0].data.length).toBe(0)
  }
  expect(f).toHaveBeenCalledTimes(2)
})

test('top-N over series: "the 2 regions with the most revenue, month by month" -> 2 series across months', async () => {
  const sales = datasets.find((d) => d.id === 'sales')!.rows
  const tot: Record<string, number> = {}
  for (const r of sales) tot[r.region as string] = (tot[r.region as string] ?? 0) + (r.revenue as number)
  const top2 = Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]).sort()
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'line', x: 'col_0', series: 'col_1', measure: 'col_4', aggregate: 'sum', sort: 'value', order: 'desc', limit: 2 }))))
  const r = await generateOption({ prompt: 'the 2 regions with the most total revenue, plotted month by month', rows: sales })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    const o = r.option as { series: { name: string }[]; xAxis: { data: string[] } }
    expect(o.series.length).toBe(2)
    expect(o.series.map((s) => s.name).sort()).toEqual(top2)
    expect(o.xAxis.data.length).toBe(12)
  }
})

test('pick: the month one channel peaks, signups for EVERY channel (conditional argmax)', async () => {
  const tr = traffic()
  const byMonth: Record<string, number> = {}
  for (const row of tr) if (row.channel === 'Organic' && typeof row.visits === 'number') { const m = (row.date as string).slice(5, 7); byMonth[m] = (byMonth[m] ?? 0) + row.visits }
  const peak = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0][0]
  const modelSpec = specOf({ chartType: 'bar', x: 'col_1', measure: 'col_3', aggregate: 'sum', pick: { column: 'col_0', datePart: 'month', by: 'col_2', extreme: 'max', where: { column: 'col_1', in: ['val_0'] } } })
  vi.stubGlobal('fetch', vi.fn(async () => claude(modelSpec)))
  const r = await generateOption({ prompt: 'in the month organic visits peak, every channel signups as bar', rows: tr })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    const o = r.option as { xAxis: { data: string[] }; series: { data: number[] }[] }
    expect(o.xAxis.data).toEqual(['Organic', 'Paid', 'Social', 'Email'])
    const orgSign = tr.filter((row) => row.channel === 'Organic' && (row.date as string).slice(5, 7) === peak).reduce((a, row) => a + (typeof row.signups === 'number' ? row.signups : 0), 0)
    expect(o.series[0].data[0]).toBe(orgSign)
  }
})

test('over: "best single month per region" charts the max monthly total per region', async () => {
  const sales = datasets.find((d) => d.id === 'sales')!.rows
  vi.stubGlobal('fetch', vi.fn(async () => claude(specOf({ chartType: 'bar', x: 'col_1', measure: 'col_4', aggregate: 'max', over: 'col_0' }))))
  const r = await generateOption({ prompt: 'for every region give me its best single month revenue', rows: sales })
  expect(r.status).toBe('ok')
  if (r.status === 'ok') {
    const o = r.option as { xAxis: { data: string[] }; series: { data: number[] }[] }
    expect(o.xAxis.data.length).toBe(4)
    const monthly: Record<string, number> = {}
    for (const row of sales) if (row.region === 'North') monthly[row.month as string] = (monthly[row.month as string] ?? 0) + (row.revenue as number)
    const best = Object.values(monthly).reduce((a, b) => (b > a ? b : a), -Infinity)
    expect(o.series[0].data[o.xAxis.data.indexOf('North')]).toBe(best)
  }
})

test('a month word does NOT inject a filter when the x-axis is not a date column', async () => {
  const sales = datasets.find((d) => d.id === 'sales')!.rows
  const spec = specOf({ chartType: 'bar', x: 'region', measure: 'revenue', aggregate: 'sum' })
  vi.stubGlobal('fetch', vi.fn(async () => claude(spec)))
  expect(xAxisOf(await generateOption({ prompt: 'revenue by region, you may include everything', rows: sales })).length).toBe(4)
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
  expect(userMsg).toContain('top 5')
})
