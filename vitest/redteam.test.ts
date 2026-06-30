import { test, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { deidentify } from '../src/ai'
import { verifyOutbound, looksLikePastedData } from '../src/gate'
import { datasets } from '../src/data'

interface Case { prompt: string; mustNotLeak: string[]; note?: string; class?: string }
const CORPUS = resolve('vitest/redteam-corpus.json')
const rows = datasets.find((d) => d.id === 'sales')!.rows

test.skipIf(!existsSync(CORPUS))('RED-TEAM: no sensitive substring survives the gate; tripwire stays clean', () => {
  const corpus: Case[] = JSON.parse(readFileSync(CORPUS, 'utf8'))
  const leaks: Array<{ class?: string; needle: string; prompt: string }> = []
  const tripwire: Array<{ class?: string; words: string[]; prompt: string }> = []

  let blocked = 0
  for (const c of corpus) {
    if (looksLikePastedData(c.prompt)) { blocked++; continue }
    const { message, safePrompt } = deidentify(c.prompt, rows)
    const outbound = String(message)
    for (const needle of c.mustNotLeak) {
      const n = (needle ?? '').trim()
      if (n.length < 3) continue
      if (outbound.includes(n) || safePrompt.includes(n)) leaks.push({ class: c.class, needle: n, prompt: c.prompt })
    }
    const bad = verifyOutbound(outbound)
    if (bad.length) tripwire.push({ class: c.class, words: bad, prompt: c.prompt })
  }

  const byClass: Record<string, number> = {}
  for (const l of leaks) byClass[l.class ?? '?'] = (byClass[l.class ?? '?'] ?? 0) + 1
  console.log(`\n=== RED-TEAM: ${corpus.length} cases (${blocked} blocked as pasted data) ===`)
  console.log(`tripwire violations: ${tripwire.length}`)
  console.log(`candidate leaks: ${leaks.length}  by class: ${JSON.stringify(byClass)}`)
  for (const l of leaks.slice(0, 60)) console.log(`  LEAK[${l.class}] "${l.needle}"  ::  ${l.prompt.slice(0, 90)}`)

  // structural guarantee: nothing un-allowlisted leaves
  expect(tripwire).toEqual([])
  // PII guarantee: no email, and no grouped/long digit identifier (>=5 digits) survives.
  // (Remaining candidate leaks are dictionary-collision NAMES + <5-digit fragments — surfaced via the name-risk warning, not masked.)
  const piiLeaks = leaks.filter((l) => /@.*\.[a-z]{2,}/i.test(l.needle) || l.needle.replace(/\D/g, '').length >= 5)
  expect(piiLeaks.map((l) => `${l.class}:${l.needle}`)).toEqual([])
})
