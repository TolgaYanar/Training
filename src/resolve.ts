import type { FieldMeta, FieldType } from './schema'
import type { FieldIndex } from './fieldIndex'
import type { Bucket, FilterInput, Op, RequestInput } from './request'

export type SlotRole = 'dimension' | 'measure' | 'category' | 'date'

export type Chip =
  | { state: 'green'; field: FieldMeta }
  | { state: 'amber'; candidates: FieldMeta[] }
  | { state: 'red'; reason: 'unknown' | 'type' }

function roleOk(role: SlotRole, t: FieldType): boolean {
  if (role === 'measure') return t === 'number'
  if (role === 'date') return t === 'date'
  if (role === 'category') return t !== 'number'
  return true
}

export function resolveSlot(text: string, index: FieldIndex, role: SlotRole): Chip {
  const r = index.resolve(text.trim())
  if (r.status === 'unknown') return { state: 'red', reason: 'unknown' }
  if (r.status === 'resolved') {
    return roleOk(role, r.field.type) ? { state: 'green', field: r.field } : { state: 'red', reason: 'type' }
  }
  const fit = r.candidates.filter((f) => roleOk(role, f.type))
  if (fit.length === 1) return { state: 'green', field: fit[0] }
  if (fit.length > 1) return { state: 'amber', candidates: fit }
  return { state: 'red', reason: 'type' }
}

export interface ResolvedFilter {
  field: Chip
  op: Op
  value: string
}

export interface ResolvedRequest {
  x?: Chip
  olcu?: Chip
  seri?: Chip
  filtre: ResolvedFilter[]
  grupla?: Bucket
  gruplaOk: boolean
  blocked: boolean
}

export function resolveRequest(req: RequestInput, index: FieldIndex): ResolvedRequest {
  const x = req.x ? resolveSlot(req.x, index, 'dimension') : undefined
  const olcu = req.olcu ? resolveSlot(req.olcu, index, 'measure') : undefined
  const seri = req.seri ? resolveSlot(req.seri, index, 'category') : undefined
  const filtre: ResolvedFilter[] = (req.filtre ?? []).map((f: FilterInput) => ({
    field: resolveSlot(f.field, index, 'dimension'),
    op: f.op,
    value: f.value,
  }))
  const gruplaOk = !req.grupla || (!!x && x.state === 'green' && x.field.type === 'date')
  const chips: Chip[] = [x, olcu, seri, ...filtre.map((f) => f.field)].filter((c): c is Chip => !!c)
  const blocked = !gruplaOk || chips.some((c) => c.state !== 'green')
  return { x, olcu, seri, filtre, grupla: req.grupla, gruplaOk, blocked }
}
