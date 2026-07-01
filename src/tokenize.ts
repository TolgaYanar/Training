import { fold } from './fieldIndex.ts'
import type { FieldIndex } from './fieldIndex'
import type { Row } from './types'

export interface Tokenized {
  payload: string
  toReal: Record<string, string>
  unresolved: string[]
}

function titleCase(w: string): boolean {
  return /^\p{Lu}/u.test(w) && !/^\d/.test(w)
}

const SEGMENT = /"([^"]*)"|\[([^\]]*)\]|([^"[]+)/g

export function tokenizeSentence(sentence: string, index: FieldIndex, rows: Row[]): Tokenized {
  const toReal: Record<string, string> = {}
  let cN = 0
  let vN = 0
  const colFor = (anahtar: string): string => {
    for (const k in toReal) if (k.startsWith('col_') && toReal[k] === anahtar) return k
    const k = `col_${cN++}`
    toReal[k] = anahtar
    return k
  }
  const valFor = (value: string): string => {
    for (const k in toReal) if (k.startsWith('val_') && toReal[k] === value) return k
    const k = `val_${vN++}`
    toReal[k] = value
    return k
  }

  const valueReal = new Map<string, string>()
  for (const row of rows) for (const key in row) {
    const v = row[key]
    if (typeof v === 'string' && v.length >= 2) { const f = fold(v); if (!valueReal.has(f)) valueReal.set(f, v) }
  }

  const out: string[] = []
  const unresolved: string[] = []

  const plain = (text: string): void => {
    const words = text.trim().split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean)
    let i = 0
    while (i < words.length) {
      let bestJ = -1
      for (let j = i; j < Math.min(i + 4, words.length); j++) {
        if (/^\d+$/.test(fold(words[j]))) break
        if (index.resolvePhrase(words.slice(i, j + 1).join(' ')).status === 'resolved') bestJ = j
      }
      if (bestJ >= i) { unresolved.push(words.slice(i, bestJ + 1).join(' ')); i = bestJ + 1; continue }

      const w = words[i]
      const f = fold(w)
      if (/^\d+$/.test(f)) { out.push(w); i++; continue }
      if (valueReal.has(f)) { unresolved.push(w); i++; continue }
      if (titleCase(w)) { unresolved.push(w); i++; continue }
      out.push(w)
      i++
    }
  }

  for (const seg of sentence.matchAll(SEGMENT)) {
    if (seg[1] !== undefined) {
      const content = seg[1].trim()
      if (!content) continue
      const r = index.resolve(content)
      if (r.status === 'resolved') out.push(colFor(r.field.anahtar))
      else unresolved.push(content)
    } else if (seg[2] !== undefined) {
      const content = seg[2].trim()
      if (content) out.push(valFor(content))
    } else if (seg[3] !== undefined) {
      plain(seg[3])
    }
  }

  return { payload: out.join(' '), toReal, unresolved }
}
