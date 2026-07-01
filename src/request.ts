export type ChartKind = 'çizgi' | 'çubuk' | 'alan' | 'pasta' | 'dağılım'
export type Agg = 'toplam' | 'ortalama' | 'adet' | 'min' | 'maks'
export type Bucket = 'gün' | 'hafta' | 'ay' | 'çeyrek' | 'yıl'
export type Op = '>' | '>=' | '<' | '<=' | '=' | '!='

export interface FilterInput {
  field: string
  op: Op
  value: string
}

export interface RequestInput {
  grafik?: ChartKind
  x?: string
  olcu?: string
  topla?: Agg
  seri?: string
  filtre?: FilterInput[]
  grupla?: Bucket
  sirala?: { yon: 'artan' | 'azalan'; ilk?: number }
  gorunum?: string[]
}
