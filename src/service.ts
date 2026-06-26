import type { ChartRequest, ChartResponse, ChartService } from './types'
import { datasets } from './data'
import { generateOption } from './ai'

export const chartService: ChartService = {
  async getChart(req: ChartRequest): Promise<ChartResponse> {
    const dataset = datasets.find((d) => d.id === req.source)
    if (!dataset) return { status: 'failed', error: `Unknown source "${req.source}"`, raw: '' }
    const result = await generateOption({ prompt: req.prompt, rows: dataset.rows })
    if (result.status === 'ok') return { status: 'ok', option: result.option, repaired: result.repaired }
    return { status: 'failed', error: result.error, raw: result.raw }
  },
}
