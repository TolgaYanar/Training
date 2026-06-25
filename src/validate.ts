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
