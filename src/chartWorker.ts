import { assembleOption } from './chartCompute'
import type { ChartSpec, Row } from './types'

interface Job { id: number; spec: ChartSpec; prompt: string; rows: Row[]; allowEmpty: boolean }

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, spec, prompt, rows, allowEmpty } = e.data
  const result = assembleOption(spec, prompt, rows, allowEmpty)
  ;(self as unknown as Worker).postMessage({ id, result })
}
