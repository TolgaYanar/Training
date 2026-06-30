import type { ChartSpec, EChartsOption, Row } from './types'
import { assembleOption } from './chartCompute'

type Result = { option: EChartsOption } | { error: string }

export const WORKER_THRESHOLD = 100_000

let worker: Worker | null = null
let unavailable = false
let seq = 0
const pending = new Map<number, (r: Result) => void>()

function getWorker(): Worker | null {
  if (unavailable || typeof Worker === 'undefined') return null
  if (!worker) {
    try {
      worker = new Worker(new URL('./chartWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<{ id: number; result: Result }>) => {
        const resolve = pending.get(e.data.id)
        if (resolve) { pending.delete(e.data.id); resolve(e.data.result) }
      }
      worker.onerror = () => { unavailable = true; worker = null; for (const [, r] of pending) r({ error: 'chart worker failed' }); pending.clear() }
    } catch {
      unavailable = true
      worker = null
    }
  }
  return worker
}

export function computeOption(spec: ChartSpec, prompt: string, rows: Row[], allowEmpty: boolean): Promise<Result> {
  if (rows.length < WORKER_THRESHOLD) return Promise.resolve(assembleOption(spec, prompt, rows, allowEmpty))
  const w = getWorker()
  if (!w) return Promise.resolve(assembleOption(spec, prompt, rows, allowEmpty))
  return new Promise<Result>((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    w.postMessage({ id, spec, prompt, rows, allowEmpty })
  })
}
