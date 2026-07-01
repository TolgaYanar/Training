export type FieldType = 'number' | 'date' | 'categorical' | 'boolean'

export interface EnumKey {
  label: string
  value: number | string
}

export interface FieldMeta {
  id: number
  anahtar: string
  baslik: string
  alanIsmi: string
  type: FieldType
  enumKeys: EnumKey[] | null
  resolvable: boolean
}

interface RawKolonTanim {
  alanIsmi?: string
  objeTipId?: string
}
interface RawGosterim {
  tur?: string
  enumKeys?: EnumKey[]
  kolonTanim?: RawKolonTanim
}
export interface PropField {
  anahtar: string
  baslik: string
  gizli?: boolean
  gosterimBilgi?: RawGosterim
}

function fromObjeTip(id: string | undefined): FieldType {
  switch (id) {
    case 'coreLib_String': return 'categorical'
    case 'coreLib_DateTime': return 'date'
    case 'coreLib_Boolean': return 'boolean'
    default: return 'number'
  }
}

function classify(g: RawGosterim | undefined): { type: FieldType; nested: boolean } {
  switch (g?.tur) {
    case 'sayi': return { type: 'number', nested: false }
    case 'tarih': return { type: 'date', nested: false }
    case 'enum': return { type: 'categorical', nested: false }
    case 'bit': return { type: 'boolean', nested: false }
    case 'kolon-tanim': return { type: fromObjeTip(g.kolonTanim?.objeTipId), nested: false }
    default: return { type: 'categorical', nested: true }
  }
}

export function buildSchema(fields: PropField[]): FieldMeta[] {
  return fields.map((f, id) => {
    const g = f.gosterimBilgi
    const { type, nested } = classify(g)
    const enumKeys = g?.tur === 'enum' && Array.isArray(g.enumKeys) ? g.enumKeys : null
    return {
      id,
      anahtar: f.anahtar,
      baslik: f.baslik,
      alanIsmi: g?.kolonTanim?.alanIsmi ?? f.anahtar,
      type,
      enumKeys,
      resolvable: !f.gizli && !nested,
    }
  })
}
