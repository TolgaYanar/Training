import { test, expect } from 'vitest'
import { normalizeLite, maskPII, scrub, fuzzyTokenizeResiduals, redactionSummary, looksLikePastedData, nameRiskCandidates } from '../src/gate.ts'

function mask(text: string): { out: string; toReal: Record<string, string> } {
  const toReal: Record<string, string> = {}
  return { out: scrub(text, toReal), toReal }
}

test('maskPII masks a Luhn-valid payment card, leaves a short non-PII number', () => {
  const a: Record<string, string> = {}
  expect(maskPII('pay 4111 1111 1111 1111 now', a)).toMatch(/lit_0/)
  expect(maskPII('pay 4111 1111 1111 1111 now', a)).not.toContain('4111')
  const b: Record<string, string> = {}
  expect(maskPII('reorder item 1234 today', b)).toContain('1234')
})

test('maskPII masks a mod-97-valid IBAN', () => {
  const t: Record<string, string> = {}
  const out = maskPII('send to GB82 WEST 1234 5698 7654 32 please', t)
  expect(out).not.toContain('WEST')
  expect(out).toMatch(/lit_\d/)
})

test('maskPII masks a checksum-valid Turkish national ID', () => {
  const t: Record<string, string> = {}
  expect(maskPII('kimlik 10000000146 numaram', t)).not.toContain('10000000146')
})

test('maskPII masks a phone-length digit run and an IPv4 address', () => {
  const t: Record<string, string> = {}
  expect(maskPII('call 555 123 4567', t)).not.toContain('4567')
  const u: Record<string, string> = {}
  expect(maskPII('host 192.168.1.1 down', u)).not.toContain('192.168')
})

test('default-deny masks a stray proper name, keeps the surrounding vocab', () => {
  const { out } = mask('Show orders for Jonathan')
  expect(out.startsWith('Show')).toBe(true)
  expect(out).not.toContain('Jonathan')
  expect(out).toMatch(/lit_\d/)
})

test('default-deny keeps month and weekday names, incl. plural and Turkish forms', () => {
  expect(mask('compare January and July').out).toBe('compare January and July')
  expect(mask('show visits on Mondays').out).toBe('show visits on Mondays')
})

test('default-deny keeps in-vocabulary chart words (intent preserved)', () => {
  expect(mask('revenue by product? Pie please. Draw it.').out).toBe('revenue by product? Pie please. Draw it.')
  expect(mask('count rows per channel. Bars are fine').out).toBe('count rows per channel. Bars are fine')
})

test('default-deny keeps bare numbers (top-N limits and thresholds are not masked here)', () => {
  expect(mask('the 3 channels with the most visits').out).toBe('the 3 channels with the most visits')
  expect(mask('revenue over 5').out).toBe('revenue over 5')
})

test('default-deny never touches col_/val_/lit_ tokens', () => {
  expect(mask('col_0 by val_1 trend').out).toBe('col_0 by val_1 trend')
})

test('fuzzy tokenizer maps a typo of a column/value to its token, leaves real words', () => {
  const toReal = { col_0: 'temperature', col_1: 'humidity', col_2: 'date', val_0: 'Organic' }
  expect(fuzzyTokenizeResiduals('plot temprature and humidty', toReal)).toBe('plot col_0 and col_1')
  expect(fuzzyTokenizeResiduals('organicc visits', toReal)).toBe('val_0 visits')
  expect(fuzzyTokenizeResiduals('show the data', toReal)).toBe('show the data')
})

test('fuzzy tokenizer does not hijack a distant word (a real name still masks)', () => {
  const toReal = { col_0: 'temperature', val_0: 'Organic' }
  const fuzzed = fuzzyTokenizeResiduals('chart for Jonathan', toReal)
  expect(fuzzed).toContain('Jonathan')
  const t2: Record<string, string> = {}
  expect(scrub(fuzzed, t2)).not.toContain('Jonathan')
})

test('normalizeLite strips zero-width chars but keeps Turkish letters intact', () => {
  expect(normalizeLite('İz​mir')).toBe('İzmir')
  expect(normalizeLite('şehir çgöü')).toBe('şehir çgöü')
})

test('redactionSummary classifies tokens into human categories, most-sensitive first', () => {
  const toReal = {
    col_0: 'region', col_1: 'revenue', val_0: 'North',
    lit_0: '555 123 4567', lit_1: 'Jonathan', lit_2: '2024-03-15', lit_3: 'j@x.io',
  }
  const summary = redactionSummary(toReal)
  expect(summary).toEqual([
    { kind: 'pii', count: 1 },
    { kind: 'emails', count: 1 },
    { kind: 'names', count: 1 },
    { kind: 'dates', count: 1 },
    { kind: 'values', count: 1 },
    { kind: 'columns', count: 2 },
  ])
})

test('maskPII catches separator-evaded grouped digit identifiers (SSN/PIN/middot/NBSP)', () => {
  for (const id of ['531-24-6789', '12 34 56', '078 05 112', '14 03 87']) {
    const t: Record<string, string> = {}
    expect(maskPII(normalizeLite('ssn ' + id + ' on file'), t)).not.toContain(id.replace(/\D/g, '').slice(0, 3))
  }
  // unicode separators normalize first, then mask
  const u: Record<string, string> = {}
  expect(maskPII(normalizeLite('id 12·345·678 here'), u)).not.toContain('345')
})

test('nameRiskCandidates flags consecutive-Title-Case names, not chart phrases or calendar', () => {
  expect(nameRiskCandidates('revenue by region for Mark Day, line chart')).toEqual(['Mark Day'])
  expect(nameRiskCandidates('units for the store at Long Bridge Road')).toEqual(['Long Bridge Road'])
  expect(nameRiskCandidates('For March give me a pie of col_3')).toEqual([])
  expect(nameRiskCandidates('On Mondays show col_2 by col_1')).toEqual([])
  expect(nameRiskCandidates('compare val_1 by col_0 trend')).toEqual([])
})

test('looksLikePastedData flags tabular/CSV pastes but not normal prose', () => {
  expect(looksLikePastedData('monthly revenue by region as a bar chart')).toBe(false)
  expect(looksLikePastedData('show revenue, units, and signups by region, month, product')).toBe(false)
  expect(looksLikePastedData('name,email,phone\nJohn,j@x.io,5551234567\nMary,m@x.io,5559876543\nLee,l@x.io,5551112222')).toBe(true)
  expect(looksLikePastedData('a\tb\tc\td\te\tf')).toBe(true)
})
