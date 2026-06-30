import type { ChartSpec, EChartsOption, Row } from './types'
import { buildChartOption } from './chart'
import { checkOption } from './validate'
import { enforceNamedFilters } from './guardrails'

export function assembleOption(spec: ChartSpec, prompt: string, rows: Row[], allowEmpty: boolean): { option: EChartsOption } | { error: string } {
  let option: EChartsOption
  try {
    option = buildChartOption(enforceNamedFilters(spec, prompt, rows), rows, allowEmpty)
  } catch (e) {
    return { error: (e as Error).message }
  }
  const checked = checkOption(option)
  if (!checked.ok) return { error: checked.error }
  return { option }
}
