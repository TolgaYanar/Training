import * as echarts from 'echarts'
import type { EChartsOption } from './types'

export function extractJson(text: string): string {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()
  }
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first !== -1 && last > first) t = t.slice(first, last + 1)
  return t
}

type JsonSchema = {
  type?: string
  enum?: readonly unknown[]
  required?: readonly string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  anyOf?: readonly JsonSchema[]
}

function checkSchema(schema: JsonSchema, value: unknown, path: string): string | null {
  if (schema.anyOf) {
    return schema.anyOf.some((s) => checkSchema(s, value, path) === null) ? null : `${path} has an unexpected type`
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of: ${schema.enum.join(', ')}`
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path} must be an object`
      const obj = value as Record<string, unknown>
      for (const key of schema.required ?? []) if (obj[key] === undefined) return `${path}.${key} is required`
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (obj[key] !== undefined) {
          const err = checkSchema(sub, obj[key], `${path}.${key}`)
          if (err) return err
        }
      }
      return null
    }
    case 'array': {
      if (!Array.isArray(value)) return `${path} must be an array`
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const err = checkSchema(schema.items, value[i], `${path}[${i}]`)
          if (err) return err
        }
      }
      return null
    }
    case 'string': return typeof value === 'string' ? null : `${path} must be a string`
    case 'number': return typeof value === 'number' ? null : `${path} must be a number`
    case 'integer': return typeof value === 'number' && Number.isInteger(value) ? null : `${path} must be an integer`
    case 'boolean': return typeof value === 'boolean' ? null : `${path} must be a boolean`
    default: return null
  }
}

const FILTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    column: { type: 'string' },
    in: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
    notIn: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
    op: { type: 'string', enum: ['>', '>=', '<', '<=', '==', '!='] },
    value: { anyOf: [{ type: 'number' }, { type: 'string' }] },
    datePart: { type: 'string', enum: ['day', 'weekday', 'month', 'quarter'] },
  },
  required: ['column'],
}

export const CHART_SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chartType: { type: 'string', enum: ['line', 'bar', 'area', 'pie', 'scatter'] },
    x: { type: 'string' },
    measure: { type: 'string' },
    measures: { type: 'array', items: { type: 'string' } },
    series: { type: 'string' },
    over: { type: 'string' },
    pick: {
      type: 'object',
      additionalProperties: false,
      properties: {
        column: { type: 'string' },
        datePart: { type: 'string', enum: ['day', 'weekday', 'month', 'quarter'] },
        bucket: { type: 'string' },
        by: { type: 'string' },
        agg: { type: 'string', enum: ['sum', 'avg'] },
        extreme: { type: 'string', enum: ['max', 'min'] },
        where: FILTER_SCHEMA,
      },
      required: ['column', 'by', 'extreme'],
    },
    having: {
      type: 'object',
      additionalProperties: false,
      properties: {
        column: { type: 'string' },
        measure: { type: 'string' },
        agg: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max'] },
        op: { type: 'string', enum: ['>', '>=', '<', '<=', '==', '!='] },
        value: { anyOf: [{ type: 'number' }, { type: 'string' }] },
        where: FILTER_SCHEMA,
      },
      required: ['column', 'measure', 'op', 'value'],
    },
    aggregate: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max', 'none'] },
    filters: { type: 'array', items: FILTER_SCHEMA },
    bucket: { type: 'string' },
    groupByPart: { type: 'string' },
    groups: { type: 'object' },
    window: { type: 'object' },
    derived: {
      type: 'object',
      additionalProperties: false,
      properties: { name: { type: 'string' }, numerator: { type: 'string' }, denominator: { type: 'string' } },
      required: ['name', 'numerator', 'denominator'],
    },
    title: { type: 'string' },
    sort: { type: 'string', enum: ['value'] },
    order: { type: 'string', enum: ['asc', 'desc'] },
    limit: { type: 'integer' },
    display: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stacked: { type: 'boolean' },
        horizontal: { type: 'boolean' },
        step: { type: 'boolean' },
        donut: { type: 'boolean' },
        rose: { type: 'boolean' },
      },
    },
  },
  required: ['chartType', 'x'],
}

export function validateSpec(spec: unknown): string | null {
  return checkSchema(CHART_SPEC_SCHEMA as unknown as JsonSchema, spec, 'spec')
}

function normalizeLayout(option: EChartsOption): void {
  const o = option as Record<string, unknown>
  const title = o.title as Record<string, unknown> | undefined
  const hasTitle = !!title && !Array.isArray(title) && typeof title.text === 'string' && title.text.length > 0
  const legend = o.legend && !Array.isArray(o.legend) && typeof o.legend === 'object' ? (o.legend as Record<string, unknown>) : null
  const sideLegend = legend ? legend.orient === 'vertical' : false
  if (legend && !sideLegend) {
    delete legend.bottom
    legend.top = hasTitle ? 46 : 10
  }
  if (!Array.isArray(o.grid) && (o.xAxis !== undefined || o.yAxis !== undefined)) {
    const grid = (o.grid && typeof o.grid === 'object' ? o.grid : {}) as Record<string, unknown>
    grid.containLabel = true
    if (grid.left === undefined) grid.left = 16
    if (grid.right === undefined) grid.right = 24
    if (grid.bottom === undefined) grid.bottom = 24
    grid.top = (hasTitle ? 46 : 0) + (legend && !sideLegend ? 34 : 0) + 16
    o.grid = grid
  }
}

export function checkOption(option: EChartsOption): { ok: true } | { ok: false; error: string } {
  if (typeof option !== 'object' || option === null || Array.isArray(option)) return { ok: false, error: 'Option is not an object' }
  const o = option as Record<string, unknown>
  if (!Array.isArray(o.series) || (o.series as unknown[]).length === 0) return { ok: false, error: 'Option has no series' }
  normalizeLayout(option)
  const probe = document.createElement('div')
  const messages: string[] = []
  const origError = console.error
  const origWarn = console.warn
  console.error = (...args: unknown[]) => { messages.push(args.map(String).join(' ')) }
  console.warn = (...args: unknown[]) => { messages.push(args.map(String).join(' ')) }
  let instance: echarts.ECharts | null = null
  try {
    instance = echarts.init(probe, undefined, { width: 600, height: 400 })
    instance.setOption(option, { notMerge: true })
  } catch (e) {
    return { ok: false, error: `ECharts threw: ${(e as Error).message}` }
  } finally {
    console.error = origError
    console.warn = origWarn
    if (instance) instance.dispose()
  }
  const rejected = messages.find((m) => m.includes('[ECharts]'))
  if (rejected) return { ok: false, error: `ECharts rejected the option: ${rejected}` }
  return { ok: true }
}
