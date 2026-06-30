import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { deidentify } from '../src/ai.ts'
import { verifyAllowlist, verifyOutbound, enforceOutbound } from '../src/gate.ts'
import { datasets } from '../src/data.ts'

test('deidentify closes a name + phone leak and round-trips via toReal', () => {
  const rows = [
    { region: 'North', sales: 5 },
    { region: 'South', sales: 9 },
  ]
  const { safePrompt, toReal } = deidentify('show sales for North, ping Jonathan at 555 123 4567', rows)
  expect(safePrompt).not.toContain('Jonathan')
  expect(safePrompt).not.toContain('5551234567')
  expect(safePrompt).not.toContain('4567')
  expect(/\bNorth\b/.test(safePrompt)).toBe(false)
  const lit = Object.entries(toReal).find(([, v]) => v.replace(/\D/g, '') === '5551234567')
  expect(lit).toBeTruthy()
})

test('deidentify is stable across calls on the same dataset (memoized index)', () => {
  const rows = [
    { channel: 'Organic', visits: 100 },
    { channel: 'Paid', visits: 60 },
  ]
  const a = deidentify('visits by channel', rows)
  const b = deidentify('visits by channel', rows)
  expect(a.safePrompt).toBe(b.safePrompt)
  expect(a.safePrompt).not.toContain('Organic')
})

test('a clean chart prompt is unchanged by the gate (no false masking)', () => {
  const rows = [
    { region: 'North', revenue: 100 },
    { region: 'South', revenue: 80 },
  ]
  const { safePrompt } = deidentify('monthly revenue by region as a line chart', rows)
  expect(safePrompt).not.toMatch(/lit_/)
})

test('tripwire: the FULL outbound message is token/vocab/frame-only for ALL 498 live prompts', () => {
  const rowsOf = (id: string) => datasets.find((d) => d.id === id)!.rows
  const violations: string[] = []
  for (const f of ['live-cases.json', 'live-cases-edge.json', 'live-cases-edge2.json']) {
    for (const c of JSON.parse(readFileSync(new URL('./' + f, import.meta.url), 'utf8'))) {
      const { message, safePrompt } = deidentify(c.prompt, rowsOf(c.dataset))
      const bad = [...verifyAllowlist(safePrompt), ...verifyOutbound(String(message))]
      if (bad.length) violations.push(`${c.name}: ${bad.join(', ')}`)
    }
  }
  expect(violations).toEqual([])
})

test('tripwire holds on an adversarial mixed prompt (name + PII + free text)', () => {
  const rows = [{ region: 'North', revenue: 100 }, { region: 'South', revenue: 80 }]
  const { message, safePrompt } = deidentify('hey, Jonathan Okonkwo (tckn 10000000146) wants Acme revenue by region, email j@x.io', rows)
  expect(verifyAllowlist(safePrompt)).toEqual([])
  expect(verifyOutbound(String(message))).toEqual([])
  for (const leak of ['Jonathan', 'Okonkwo', 'Acme', '10000000146', 'j@x.io']) {
    expect(String(message)).not.toContain(leak)
  }
})

test('egress enforce masks a stray (e.g. model-authored) word that slips into a repair payload', () => {
  const toReal: Record<string, string> = {}
  const repairish = 'Your previous chart spec {"chartType":"bar","x":"col_0","title":"Zyzzyx breakdown"} was rejected'
  const cleaned = enforceOutbound(repairish, toReal)
  expect(cleaned).not.toContain('Zyzzyx')
  expect(verifyOutbound(cleaned)).toEqual([])
  expect(cleaned).toContain('col_0')
  expect(cleaned).toContain('chartType')
})
