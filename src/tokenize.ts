import { fold } from './fieldIndex.ts'
import type { FieldIndex } from './fieldIndex'
import type { Row } from './types'

export type UnresolvedReason = 'unknownField' | 'unknownValue' | 'field' | 'value' | 'name'
export interface Unresolved { text: string; reason: UnresolvedReason; suggestions?: string[] }
export interface Tokenized {
  payload: string
  toReal: Record<string, string>
  unresolved: Unresolved[]
}

function titleCase(w: string): boolean {
  return /^\p{Lu}/u.test(w) && !/^\d/.test(w)
}

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
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
  const enumVal = new Map<string, string>()
  for (const fld of index.fields) if (fld.enumKeys) for (const k of fld.enumKeys) {
    const f = fold(k.label)
    if (f && !enumVal.has(f)) enumVal.set(f, k.label)
  }

  const nearestValues = (f: string): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    const consider = (key: string, canon: string): void => {
      if (out.length >= 3 || seen.has(canon)) return
      if (key.startsWith(f) || f.startsWith(key)) { seen.add(canon); out.push(canon) }
    }
    for (const [k, canon] of enumVal) consider(k, canon)
    for (const [k, canon] of valueReal) { if (out.length >= 3) break; consider(k, canon) }
    return out
  }

  const out: string[] = []
  const unresolved: Unresolved[] = []

  const plain = (text: string): void => {
    const words = text.trim().split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean)
    let i = 0
    while (i < words.length) {
      let bestJ = -1
      for (let j = i; j < Math.min(i + 4, words.length); j++) {
        if (/^\d+$/.test(fold(words[j]))) break
        if (index.resolvePhrase(words.slice(i, j + 1).join(' ')).status === 'resolved') bestJ = j
      }
      if (bestJ >= i) { unresolved.push({ text: words.slice(i, bestJ + 1).join(' '), reason: 'field' }); i = bestJ + 1; continue }

      const w = words[i]
      const f = fold(w)
      if (/^\d+$/.test(f)) { out.push(w); i++; continue }
      if (valueReal.has(f)) { unresolved.push({ text: w, reason: 'value' }); i++; continue }
      if (titleCase(w)) { unresolved.push({ text: w, reason: 'name' }); i++; continue }
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
      else {
        const fc = fold(content)
        const max = Math.min(3, Math.floor(fc.length / 3))
        const fuzzy = index.fields
          .filter((fld) => fld.resolvable)
          .map((fld) => ({ b: fld.baslik, d: lev(fc, fold(fld.baslik), max) }))
          .filter((x) => x.d <= max)
          .sort((a, b) => a.d - b.d)
          .map((x) => x.b)
        const tokenC = r.status === 'ambiguous' ? r.candidates.map((c) => c.baslik) : []
        const pref = index.suggest(content, 3).map((fld) => fld.baslik)
        const suggestions = [...new Set([...fuzzy, ...tokenC, ...pref])].slice(0, 3)
        unresolved.push({ text: content, reason: 'unknownField', suggestions })
      }
    } else if (seg[2] !== undefined) {
      const content = seg[2].trim()
      if (content) {
        const fc = fold(content)
        const canon = valueReal.get(fc) ?? enumVal.get(fc)
        if (canon) out.push(valFor(canon))
        else unresolved.push({ text: content, reason: 'unknownValue', suggestions: nearestValues(fc) })
      }
    } else if (seg[3] !== undefined) {
      plain(seg[3])
    }
  }

  return { payload: out.join(' '), toReal, unresolved }
}
