import type { EChartsOption } from 'echarts'

export type { EChartsOption }

export type ProviderId = 'gemini' | 'claude'

export type Row = Record<string, string | number | null>

export type ColumnType = 'number' | 'date' | 'categorical'

export interface ColumnProfile {
  name: string
  type: ColumnType
  cardinality: number
  nullCount: number
}

export interface DataSummary {
  rowCount: number
  columns: ColumnProfile[]
}

export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'scatter'

export type AggregateOp = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none'

export interface Filter {
  column: string
  in: Array<string | number>
  datePart?: 'day' | 'weekday' | 'month' | 'quarter'
}

export interface Derived {
  name: string
  numerator: string
  denominator: string
}

export interface ChartSpec {
  chartType: ChartType
  x: string
  measure: string
  measures?: string[]
  series?: string
  aggregate: AggregateOp
  filter?: Filter
  bucket?: 'week' | 'month' | 'quarter' | 'year'
  derived?: Derived
  title?: string
  sort?: 'value'
  order?: 'asc' | 'desc'
  limit?: number
}

export interface GenerateRequest {
  prompt: string
  provider: ProviderId
  rows: Row[]
}

export type GenerateResult =
  | { status: 'ok'; option: EChartsOption; repaired: boolean; raw: string }
  | { status: 'failed'; error: string; raw: string }
