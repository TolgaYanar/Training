import { test, expect } from 'vitest'
import { deidentify } from '../src/ai'
import { datasets } from '../src/data'
const rows = datasets.find((d) => d.id === 'sales')!.rows
const inputs: [string, string][] = [
  ['digits+fail', '9'.repeat(20000) + 'x'],
  ['email-bait', 'a'.repeat(50000)],
  ['grouped-crash', '123 456 '.repeat(5000)],
  ['iban-ish', 'TR12 ' + 'AB12 '.repeat(4000)],
  ['parens-phone', '(' + '1'.repeat(20000) + ')'],
  ['mixed-sep', '1 2-3.4,5 '.repeat(5000)],
  ['email-runs', ('x._%+-'.repeat(8000)) + ' chart'],
]
test('ReDoS + crash guard: gate stays fast and never throws on pathological single-line input', () => {
  for (const [name, inp] of inputs) {
    const t0 = performance.now()
    expect(() => deidentify(inp, rows), `${name} threw`).not.toThrow()
    const ms = performance.now() - t0
    console.log(`${name} (len ${inp.length}): ${ms.toFixed(1)}ms`)
    expect(ms, `${name} too slow: ${ms.toFixed(0)}ms`).toBeLessThan(150)
  }
})
