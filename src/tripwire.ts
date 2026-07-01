import { fold } from './fieldIndex.ts'
import type { FieldMeta } from './schema'
import type { Row } from './types'

export type Outbound = string & { readonly __outbound: unique symbol }

const TOKEN = /^(?:col|val|lit)_\d+$/
const OPS = new Set(['>', '<', '>=', '<=', '=', '!='])

function addWords(deny: Set<string>, text: string): void {
  for (const w of fold(text).split(/[^a-z0-9]+/)) if (w.length >= 2) deny.add(w)
}

export function buildDenySet(fields: FieldMeta[], rows: Row[]): Set<string> {
  const deny = new Set<string>()
  for (const f of fields) if (f.enumKeys) for (const k of f.enumKeys) addWords(deny, k.label)
  for (const row of rows) for (const key in row) {
    const v = row[key]
    if (typeof v === 'string' && v.length >= 2) addWords(deny, v)
  }
  return deny
}

function allowedWord(word: string, tokens: Set<string>, deny: Set<string>): boolean {
  if (TOKEN.test(word)) return tokens.has(word)
  if (OPS.has(word)) return true
  if (/^\d+$/.test(word)) return word.length <= 3
  return !deny.has(fold(word))
}

export function verifyOutbound(text: string, tokens: Set<string>, deny: Set<string>): string[] {
  const bad: string[] = []
  for (const w of text.split(/\s+/)) if (w && !allowedWord(w, tokens, deny)) bad.push(w)
  return bad
}

export function sealOutbound(text: string, tokens: Set<string>, deny: Set<string>): Outbound {
  const bad = verifyOutbound(text, tokens, deny)
  if (bad.length > 0) throw new Error(`tripwire: blocked known-data leak: ${bad.slice(0, 8).join(', ')}`)
  return text as Outbound
}
