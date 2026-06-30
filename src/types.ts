import type { EChartsOption } from 'echarts'

export type { EChartsOption }

export type Outbound = string & { readonly __outbound: unique symbol }

export type Row = Record<string, string | number | null>

export type ColumnType = 'number' | 'date' | 'categorical'

export interface ColumnProfile {
  name: string
  type: ColumnType
  cardinality: number
  nullCount: number
  values?: string[]
}

export interface DataSummary {
  rowCount: number
  columns: ColumnProfile[]
}

export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'scatter'

export type AggregateOp = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none'

export interface Filter {
  column: string
  in?: Array<string | number>
  notIn?: Array<string | number>
  datePart?: 'day' | 'weekday' | 'month' | 'quarter'
  op?: '>' | '>=' | '<' | '<=' | '==' | '!='
  value?: number | string
  from?: string
  to?: string
}

export interface Derived {
  name: string
  numerator: string
  denominator: string
}

export interface Pick {
  column: string
  datePart?: 'day' | 'weekday' | 'month' | 'quarter'
  bucket?: 'week' | 'month' | 'quarter' | 'year'
  by: string
  agg?: 'sum' | 'avg'
  where?: Filter
  extreme: 'max' | 'min'
}

export interface Having {
  column: string
  measure: string
  agg: 'sum' | 'avg' | 'count' | 'min' | 'max'
  op: '>' | '>=' | '<' | '<=' | '==' | '!='
  value: number | string
  where?: Filter
}

export interface DisplayOptions {
  stacked?: boolean
  horizontal?: boolean
  step?: boolean
  donut?: boolean
  rose?: boolean
}

export interface ChartSpec {
  chartType: ChartType
  x: string
  measure: string
  measures?: string[]
  series?: string
  over?: string
  pick?: Pick
  having?: Having
  aggregate: AggregateOp
  filter?: Filter
  filters?: Filter[]
  bucket?: 'week' | 'month' | 'quarter' | 'year'
  groupByPart?: 'day' | 'weekday' | 'month' | 'quarter'
  groups?: Record<string, Array<string | number>>
  window?: { anchor?: 'last' | 'first'; date?: string; count: number; unit: 'day' | 'week' }
  derived?: Derived
  title?: string
  sort?: 'value'
  order?: 'asc' | 'desc'
  limit?: number
  display?: DisplayOptions
}

export interface SentRequest {
  system: string
  user: string
}

export interface GenerateRequest {
  prompt: string
  rows: Row[]
}

export type GenerateResult =
  | { status: 'ok'; option: EChartsOption; repaired: boolean; raw: string; sent: SentRequest[] }
  | { status: 'failed'; error: string; raw: string; sent: SentRequest[] }

export interface ChartRequest {
  source: string
  prompt: string
}

export type ChartResponse =
  | { status: 'ok'; option: EChartsOption; repaired: boolean; raw: string; sent: SentRequest[] }
  | { status: 'failed'; error: string; raw: string; sent: SentRequest[] }

export interface ChartService {
  getChart(req: ChartRequest): Promise<ChartResponse>
}
