import { test, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateOption, deidentify } from '../src/ai'
import { datasets } from '../src/data'

const PROXY = process.env.VITE_LLM_PROXY ?? ''
const LIVE = process.env.RUN_LIVE_API === '1' && PROXY.length > 0
const rowsOf = (id: string) => datasets.find((d) => d.id === id)!.rows
/* eslint-disable @typescript-eslint/no-explicit-any */

beforeAll(() => { if (LIVE) vi.stubEnv('VITE_LLM_PROXY', PROXY) })
afterAll(() => vi.unstubAllEnvs())

function facts(option: any) {
  const xRaw = option?.xAxis, yRaw = option?.yAxis
  const xAxis = Array.isArray(xRaw) ? xRaw[0] : xRaw
  const yAxis = Array.isArray(yRaw) ? yRaw[0] : yRaw
  const catAxis = Array.isArray(xAxis?.data) ? xAxis : Array.isArray(yAxis?.data) ? yAxis : xAxis
  const series: any[] = option?.series ?? []
  const catData = Array.isArray(catAxis?.data) ? catAxis.data : undefined
  return { types: series.map((s) => s.type), xName: String(catAxis?.name ?? '').toLowerCase(), xLen: catData?.length ?? series[0]?.data?.length, seriesCount: series.length }
}

function evaluate(e: any, f: ReturnType<typeof facts>): string[] {
  const fails: string[] = []
  if (e.typesAnyOf && (f.types.length === 0 || !f.types.every((t: string) => e.typesAnyOf.includes(t)))) fails.push(`type[${f.types}]`)
  if (e.xLen != null && f.xLen !== e.xLen) fails.push(`xLen ${f.xLen}!=${e.xLen}`)
  if (e.xLenMin != null && !(f.xLen >= e.xLenMin)) fails.push(`xLen ${f.xLen}<${e.xLenMin}`)
  if (e.xLenMax != null && !(f.xLen <= e.xLenMax)) fails.push(`xLen ${f.xLen}>${e.xLenMax}`)
  if (e.seriesCount != null && f.seriesCount !== e.seriesCount) fails.push(`series ${f.seriesCount}!=${e.seriesCount}`)
  if (e.xNameAnyOf && !e.xNameAnyOf.map((s: string) => s.toLowerCase()).includes(f.xName)) fails.push(`xName ${f.xName}`)
  return fails
}

const isWord = (s: string) => /^\p{L}[\p{L}\p{M}'’\-]*$/u.test(s)
function masksAWord(prompt: string, dataset: string): boolean {
  const { toReal } = deidentify(prompt, rowsOf(dataset))
  return Object.entries(toReal).some(([k, v]) => k.startsWith('lit_') && isWord(v))
}

test.skipIf(!LIVE)('LIVE: gate-changed (typo) prompts — measure accuracy impact', async () => {
  const all: any[] = ['live-cases.json', 'live-cases-edge.json', 'live-cases-edge2.json']
    .flatMap((f) => JSON.parse(readFileSync(new URL('./' + f, import.meta.url), 'utf8')))
  const changed = all.filter((c) => masksAWord(c.prompt, c.dataset) || /typo|fuzzy/i.test(c.name))
  console.log(`\n${changed.length} gate-changed prompts:`)
  let pass = 0
  for (const c of changed) {
    const res = await generateOption({ prompt: c.prompt, rows: rowsOf(c.dataset) })
    if (res.status !== 'ok') { console.log(`  FAIL(${res.status}) ${c.name}`); continue }
    const fails = evaluate(c.expect, facts(res.option))
    if (fails.length === 0) { pass++; console.log(`  ok   ${c.name}`) }
    else console.log(`  MISS ${c.name} :: ${fails.join(', ')}`)
  }
  console.log(`\n=== gate-changed accuracy: ${pass}/${changed.length} ===`)
}, 180000)

test.skipIf(!LIVE)('LIVE control: 10 unchanged prompts still pass (gate is a no-op there)', async () => {
  const all: any[] = ['live-cases.json'].flatMap((f) => JSON.parse(readFileSync(new URL('./' + f, import.meta.url), 'utf8')))
  const unchanged = all.filter((c) => !masksAWord(c.prompt, c.dataset)).slice(0, 10)
  let pass = 0
  for (const c of unchanged) {
    const res = await generateOption({ prompt: c.prompt, rows: rowsOf(c.dataset) })
    const ok = res.status === 'ok' && evaluate(c.expect, facts(res.option)).length === 0
    if (ok) pass++; else console.log(`  control MISS ${c.name}`)
  }
  console.log(`\n=== control accuracy: ${pass}/${unchanged.length} ===`)
  expect(pass).toBeGreaterThanOrEqual(8)
}, 180000)
