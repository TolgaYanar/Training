import type { ColumnProfile, DataSummary, Row } from './types'

export interface Dataset {
  id: string
  label: string
  rows: Row[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const REGIONS = ['North', 'South', 'East', 'West']
const PRODUCTS = ['Widget', 'Gadget', 'Gizmo']
const SEASONAL = [80, 75, 90, 100, 110, 130, 140, 135, 120, 105, 95, 150]
const REGION_WEIGHT = [1.2, 0.9, 1.0, 0.8]
const PRODUCT_WEIGHT = [1, 0.7, 0.5]
const UNIT_PRICE = [25, 40, 60]

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
}

function buildSales(): Row[] {
  const rows: Row[] = []
  for (let m = 0; m < MONTHS.length; m++) {
    for (let r = 0; r < REGIONS.length; r++) {
      for (let p = 0; p < PRODUCTS.length; p++) {
        const units = Math.round(SEASONAL[m] * REGION_WEIGHT[r] * PRODUCT_WEIGHT[p])
        rows.push({ month: MONTHS[m], region: REGIONS[r], product: PRODUCTS[p], units, revenue: units * UNIT_PRICE[p] })
      }
    }
  }
  return rows
}

function buildReadings(): Row[] {
  const sensors = ['Sensor A', 'Sensor B']
  const rows: Row[] = []
  for (let d = 0; d < 14; d++) {
    for (let s = 0; s < sensors.length; s++) {
      const temperature = (d + s) % 5 === 0 ? null : 12 + Math.round(6 * Math.sin(d / 3)) + s * 2
      const humidity = (d + s) % 7 === 0 ? null : 50 + ((d * 3 + s * 7) % 30)
      rows.push({ date: isoDate(2024, 2, 1 + d), sensor: sensors[s], temperature, humidity })
    }
  }
  return rows
}

function buildTraffic(): Row[] {
  const channels = ['Organic', 'Paid', 'Social', 'Email']
  const weight = [1, 0.6, 0.8, 0.4]
  const rows: Row[] = []
  for (let i = 0; i < 365; i++) {
    const weekday = (i + 1) % 7
    const weekend = weekday === 0 || weekday === 6 ? 0.7 : 1
    const seasonal = 1000 + Math.round(300 * Math.sin(i / 30))
    for (let c = 0; c < channels.length; c++) {
      const visits = Math.round(seasonal * weight[c] * weekend)
      const signups = (i * 4 + c) % 13 === 0 ? null : Math.round(visits * 0.04)
      rows.push({ date: isoDate(2024, 0, 1 + i), channel: channels[c], visits, signups })
    }
  }
  return rows
}

export const datasets: Dataset[] = [
  { id: 'sales', label: 'Monthly sales — small, clean', rows: buildSales() },
  { id: 'readings', label: 'Daily readings — small, with gaps', rows: buildReadings() },
  { id: 'traffic', label: 'Daily traffic — large, with gaps', rows: buildTraffic() },
]

export function summarizeData(rows: Row[]): DataSummary {
  const keys = Object.keys(rows[0] ?? {})
  const columns: ColumnProfile[] = keys.map((name) => {
    const all = rows.map((row) => row[name])
    const present = all.filter((v): v is string | number => v !== null && v !== undefined && v !== '')
    const nullCount = all.length - present.length
    const nums = present.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const numeric = present.length > 0 && nums.length === present.length
    const distinct = Array.from(new Set(present))
    const column: ColumnProfile = {
      name,
      type: numeric ? 'number' : 'categorical',
      cardinality: distinct.length,
      nullCount,
      sampleValues: distinct.slice(0, 6),
    }
    if (numeric && nums.length > 0) {
      column.min = Math.min(...nums)
      column.max = Math.max(...nums)
    }
    return column
  })
  return { rowCount: rows.length, columns, sampleRows: rows.slice(0, 5) }
}
