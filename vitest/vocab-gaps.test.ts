import { test } from 'vitest'
import { readFileSync } from 'node:fs'
import { deidentify } from '../src/ai'
import { verifyOutbound } from '../src/gate'
import { datasets } from '../src/data'

const files = ['live-cases.json', 'live-cases-edge.json', 'live-cases-edge2.json']
const rowsOf = (id: string) => datasets.find((d) => d.id === id)!.rows
const isWord = (s: string) => /^\p{L}[\p{L}\p{M}'’\-]*$/u.test(s)

test.skipIf(!process.env.REPORT_VOCAB_GAPS)('REPORT vocab gaps: words masked by default-deny across the 498 live prompts', () => {
  const counts = new Map<string, number>()
  let touched = 0
  let total = 0
  const examples = new Map<string, string>()
  for (const f of files) {
    for (const c of JSON.parse(readFileSync(new URL('./' + f, import.meta.url), 'utf8'))) {
      total++
      const { toReal } = deidentify(c.prompt, rowsOf(c.dataset))
      const masked = Object.entries(toReal).filter(([k, v]) => k.startsWith('lit_') && isWord(v)).map(([, v]) => v)
      if (masked.length) touched++
      for (const w of masked) {
        const k = w.toLowerCase()
        counts.set(k, (counts.get(k) ?? 0) + 1)
        if (!examples.has(k)) examples.set(k, c.prompt)
      }
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  console.log(`\n${touched}/${total} prompts have >=1 word masked by default-deny`)
  console.log(`${ranked.length} distinct masked words:\n`)
  console.log(ranked.map(([w, n]) => `${String(n).padStart(3)}  ${w}   ::  ${examples.get(w)!.slice(0, 70)}`).join('\n'))
})

test.skipIf(!process.env.REPORT_VOCAB_GAPS)('REPORT outbound-frame words: non-allowlisted words in the FULL spec message', () => {
  const rowsOf = (id: string) => datasets.find((d) => d.id === id)!.rows
  const counts = new Map<string, number>()
  for (const f of ['live-cases.json', 'live-cases-edge.json', 'live-cases-edge2.json']) {
    for (const c of JSON.parse(readFileSync(new URL('./' + f, import.meta.url), 'utf8'))) {
      const { message } = deidentify(c.prompt, rowsOf(c.dataset))
      for (const w of verifyOutbound(String(message))) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) ?? 0) + 1)
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  console.log(`\n${ranked.length} distinct non-allowlisted words in full spec messages:\n`)
  console.log(ranked.map(([w, n]) => `${String(n).padStart(4)}  ${w}`).join('\n'))
})
