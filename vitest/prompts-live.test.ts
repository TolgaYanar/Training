import { test, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ChartSpec, Row } from '../src/types'
import { buildSchema, type PropField } from '../src/schema'
import { buildFieldIndex } from '../src/fieldIndex'
import { buildDenySet, verifyOutbound } from '../src/tripwire'
import { previewTokens, generateChartAI } from '../src/aiChart'

const LIVE = process.env.RUN_LIVE_API === '1'
const prop = JSON.parse(readFileSync('formats/propGosterim.json', 'utf8')) as PropField[]
const rows = JSON.parse(readFileSync('formats/response.json', 'utf8')) as Row[]
const index = buildFieldIndex(buildSchema(prop))
const deny = buildDenySet(index.fields, rows)
const title = (a?: string): string => (a ? index.fields.find((f) => f.anahtar === a)?.baslik ?? a : '—')

interface Case { lvl: string; p: string; x?: string; m?: string; agg?: string; bucket?: string; series?: string; limit?: number }
const CASES: Case[] = [
  { lvl: 'basic', p: '"Depo İsmi" bazında toplam "Miktar"', x: 'depoIsmi', m: 'miktar', agg: 'sum' },
  { lvl: 'basic', p: '"Malzeme İsmi" bazında kaç kayıt var', x: 'malzemeIsmi', agg: 'count' },
  { lvl: 'basic', p: '"Birim" bazında toplam "Rezerve Miktar" pasta', x: 'birim', m: 'miktarRezerve', agg: 'sum' },
  { lvl: 'medium', p: '"Malzeme İsmi" bazında "Ortalama Ağırlık", en çok 5', x: 'malzemeIsmi', m: 'agirlikOrtalama', limit: 5 },
  { lvl: 'medium', p: '"İlk Giriş Tarihi" bazında aylık toplam "Miktar" çizgi', x: 'girisTarihi', m: 'miktar', agg: 'sum', bucket: 'month' },
  { lvl: 'medium', p: '"Depo Tipi" bazında en yüksek "Rezerve Miktar"', x: 'enumDepoTipi', m: 'miktarRezerve', agg: 'max' },
  { lvl: 'hard', p: '"Depo İsmi" bazında toplam "Miktar", "Depo Tipi" bazında ayır', x: 'depoIsmi', m: 'miktar', series: 'enumDepoTipi' },
  { lvl: 'hard', p: '"Raf İsmi" bazında ortalama "Rezervesiz Miktar", en az 3', x: 'rafIsmi', m: 'rezervesizMiktar', agg: 'avg', limit: 3 },
  { lvl: 'complex', p: '"Malzeme İsmi" bazında "Ortalama Ağırlık", en ağır 10 çubuk', x: 'malzemeIsmi', m: 'agirlikOrtalama', limit: 10 },
  { lvl: 'complex', p: '"İlk Giriş Tarihi" bazında aylık toplam "Miktar", "Depo İsmi" bazında ayrı ayrı', x: 'girisTarihi', m: 'miktar', agg: 'sum', bucket: 'month', series: 'depoIsmi' },
]

beforeAll(() => { vi.stubEnv('VITE_LLM_PROXY', 'http://localhost:8787'); vi.stubEnv('VITE_CLAUDE_API_KEY', '') })

test.skipIf(!LIVE)('basic→complex Turkish prompts: privacy + render + interpretation', { timeout: 180000 }, async () => {
  const fails: string[] = []
  const lines: string[] = []
  for (const c of CASES) {
    const { payload, toReal, unresolved } = previewTokens(c.p, index, rows)
    const leaks = verifyOutbound(payload, new Set(Object.keys(toReal)), deny)
    const r = await generateChartAI(c.p, index, rows, '')
    const s = 'option' in r ? (r.spec as ChartSpec) : null
    const got = s
      ? `${s.chartType} · x=${title(s.x)} · ölçü=${title(s.measure)}·${s.aggregate}${s.series ? ` · seri=${title(s.series)}` : ''}${s.bucket ? ` · ${s.bucket}` : ''}${s.limit ? ` · ilk${s.limit}` : ''}`
      : 'ask' in r ? `ASK: ${r.ask.join(',')}` : `ERR: ${r.error}`

    const bad: string[] = []
    if (unresolved.length) bad.push(`unresolved:${unresolved.join(',')}`)
    if (leaks.length) bad.push(`LEAK:${leaks.join(',')}`)
    if (!s) bad.push('no-chart')
    if (s && c.x && s.x !== c.x) bad.push(`x=${s.x}≠${c.x}`)
    if (s && c.m && s.measure !== c.m) bad.push(`ölçü=${s.measure}≠${c.m}`)
    if (s && c.agg && s.aggregate !== c.agg) bad.push(`agg=${s.aggregate}≠${c.agg}`)
    if (s && c.bucket && s.bucket !== c.bucket) bad.push(`bucket=${s.bucket}≠${c.bucket}`)
    if (s && c.series && s.series !== c.series) bad.push(`seri=${s.series}≠${c.series}`)
    if (s && c.limit && s.limit !== c.limit) bad.push(`limit=${s.limit}≠${c.limit}`)

    const ok = bad.length === 0
    lines.push(`[${ok ? 'OK ' : 'XX '}] ${c.lvl.padEnd(7)} "${c.p}"\n         → ${got}${ok ? '' : `\n         ⚠ ${bad.join(' | ')}`}`)
    if (leaks.length || (s === null && !('ask' in r))) fails.push(`${c.p}: ${bad.join(' | ')}`)
  }
  console.log('\n===== PROMPT SUITE =====\n' + lines.join('\n') + '\n')
  expect(fails, `hard failures (privacy/render):\n${fails.join('\n')}`).toEqual([])
})
