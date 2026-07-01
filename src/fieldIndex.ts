import type { FieldMeta } from './schema'

const FOLD: Record<string, string> = {
  'İ': 'i', 'I': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ç': 'c', 'ç': 'c',
  'Ğ': 'g', 'ğ': 'g', 'Ö': 'o', 'ö': 'o', 'Ü': 'u', 'ü': 'u',
}

export function fold(s: string): string {
  return s.normalize('NFKC').replace(/[İIıŞşÇçĞğÖöÜü]/g, (c) => FOLD[c] ?? c).toLowerCase()
}

const SUFFIX = /(?:lerinde|larinda|lerin|larin|leri|lari|ndan|nden|deki|daki|sinin|sinin|inde|inda|nin|nun|den|dan|ten|tan|ler|lar|ile|de|da|te|ta|ye|ya|na|ne|yi|yu|si|su|in|un|i|u|e|a)$/

function stem(w: string): string {
  let s = w
  while (s.length > 4) {
    const m = SUFFIX.exec(s)
    if (!m || s.length - m[0].length < 3) break
    s = s.slice(0, s.length - m[0].length)
  }
  return s
}

function phraseKey(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, '')
}

function words(s: string): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
}

function camelWords(s: string): string[] {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map(fold).filter((w) => w.length >= 2)
}

export type Resolution =
  | { status: 'resolved'; field: FieldMeta }
  | { status: 'ambiguous'; candidates: FieldMeta[] }
  | { status: 'unknown' }

export interface FieldIndex {
  resolve(text: string): Resolution
  resolvePhrase(text: string): Resolution
  suggest(query: string, limit: number, ok?: (f: FieldMeta) => boolean): FieldMeta[]
  fields: FieldMeta[]
}

function intersect(sets: Set<number>[]): Set<number> {
  if (sets.length === 0 || sets.some((s) => s.size === 0)) return new Set()
  const [first, ...rest] = [...sets].sort((a, b) => a.size - b.size)
  const out = new Set<number>()
  for (const id of first) if (rest.every((s) => s.has(id))) out.add(id)
  return out
}

function union(sets: Set<number>[]): Set<number> {
  const out = new Set<number>()
  for (const s of sets) for (const id of s) out.add(id)
  return out
}

export function buildFieldIndex(fields: FieldMeta[]): FieldIndex {
  const phrase = new Map<string, number[]>()
  const stemPhrase = new Map<string, number[]>()
  const token = new Map<string, Set<number>>()
  const byId = new Map<number, FieldMeta>()
  const forms: { form: string; id: number }[] = []

  for (const f of fields) {
    byId.set(f.id, f)
    if (!f.resolvable) continue
    const p = phraseKey(f.baslik)
    if (p) {
      const arr = phrase.get(p)
      if (arr) arr.push(f.id)
      else phrase.set(p, [f.id])
      forms.push({ form: p, id: f.id })
    }
    const sp = words(f.baslik).map(stem).join('')
    if (sp) {
      const spArr = stemPhrase.get(sp)
      if (spArr) spArr.push(f.id)
      else stemPhrase.set(sp, [f.id])
    }
    const toks = new Set<string>()
    for (const w of words(f.baslik)) toks.add(stem(w))
    for (const w of camelWords(f.anahtar)) toks.add(stem(w))
    for (const w of camelWords(f.alanIsmi)) toks.add(stem(w))
    for (const t of toks) {
      let s = token.get(t)
      if (!s) { s = new Set(); token.set(t, s) }
      s.add(f.id)
    }
    for (const w of words(f.baslik)) forms.push({ form: w, id: f.id })
    for (const w of camelWords(f.anahtar)) forms.push({ form: w, id: f.id })
  }
  forms.sort((a, b) => (a.form < b.form ? -1 : a.form > b.form ? 1 : 0))

  const asFields = (ids: Iterable<number>): FieldMeta[] => [...ids].map((id) => byId.get(id)!)

  function resolve(text: string): Resolution {
    const p = phraseKey(text)
    const exact = p ? phrase.get(p) : undefined
    if (exact && exact.length === 1) return { status: 'resolved', field: byId.get(exact[0])! }
    if (exact && exact.length > 1) return { status: 'ambiguous', candidates: asFields(exact) }

    const ws = words(text).map(stem)
    if (ws.length === 0) return { status: 'unknown' }
    const sExact = stemPhrase.get(ws.join(''))
    if (sExact && sExact.length === 1) return { status: 'resolved', field: byId.get(sExact[0])! }
    const sets = ws.map((w) => token.get(w) ?? new Set<number>())

    const inter = intersect(sets)
    if (inter.size === 1) return { status: 'resolved', field: byId.get([...inter][0])! }
    if (inter.size > 1) return { status: 'ambiguous', candidates: asFields(inter) }

    const uni = union(sets)
    if (uni.size === 0) return { status: 'unknown' }
    if (uni.size === 1) return { status: 'resolved', field: byId.get([...uni][0])! }
    return { status: 'ambiguous', candidates: asFields(uni) }
  }

  function resolvePhrase(text: string): Resolution {
    const p = phraseKey(text)
    const exact = p ? phrase.get(p) : undefined
    if (exact && exact.length === 1) return { status: 'resolved', field: byId.get(exact[0])! }
    if (exact && exact.length > 1) return { status: 'ambiguous', candidates: asFields(exact) }
    const ws = words(text).map(stem)
    if (ws.length === 0) return { status: 'unknown' }
    const sExact = stemPhrase.get(ws.join(''))
    if (sExact && sExact.length === 1) return { status: 'resolved', field: byId.get(sExact[0])! }
    if (sExact && sExact.length > 1) return { status: 'ambiguous', candidates: asFields(sExact) }
    if (ws.length < 2) return { status: 'unknown' }
    const inter = intersect(ws.map((w) => token.get(w) ?? new Set<number>()))
    if (inter.size === 1) return { status: 'resolved', field: byId.get([...inter][0])! }
    if (inter.size > 1) return { status: 'ambiguous', candidates: asFields(inter) }
    return { status: 'unknown' }
  }

  function suggest(query: string, limit: number, okFn?: (f: FieldMeta) => boolean): FieldMeta[] {
    const q = fold(query.trim())
    const res: FieldMeta[] = []
    const chosen = new Set<number>()
    const push = (id: number): void => {
      if (chosen.has(id)) return
      const f = byId.get(id)!
      if (okFn && !okFn(f)) return
      chosen.add(id)
      res.push(f)
    }
    if (!q) {
      for (const f of fields) { if (f.resolvable) { push(f.id); if (res.length >= limit) break } }
      return res
    }
    let lo = 0
    let hi = forms.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (forms[mid].form < q) lo = mid + 1; else hi = mid }
    for (let i = lo; i < forms.length && forms[i].form.startsWith(q) && res.length < limit; i++) push(forms[i].id)
    return res
  }

  return { resolve, resolvePhrase, suggest, fields }
}
