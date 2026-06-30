import type { ColumnProfile, DataSummary, Row } from './types'

export interface Dataset {
  id: string
  label: string
  lang: 'en' | 'tr'
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

const AYLAR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const SEHIRLER = ['İstanbul', 'Ankara', 'İzmir', 'Bursa']
const URUNLER = ['Telefon', 'Tablet', 'Saat']

function buildSatis(): Row[] {
  const rows: Row[] = []
  for (let m = 0; m < AYLAR.length; m++) {
    for (let s = 0; s < SEHIRLER.length; s++) {
      for (let u = 0; u < URUNLER.length; u++) {
        const adet = Math.round(SEASONAL[m] * REGION_WEIGHT[s] * PRODUCT_WEIGHT[u])
        rows.push({ ay: AYLAR[m], şehir: SEHIRLER[s], ürün: URUNLER[u], adet, gelir: adet * UNIT_PRICE[u] })
      }
    }
  }
  return rows
}

function buildEticaret(): Row[] {
  const kategoriler = ['Elektronik', 'Giyim', 'Kitap', 'Ev']
  const agirlik = [1, 0.6, 0.8, 0.4]
  const rows: Row[] = []
  for (let i = 0; i < 365; i++) {
    const gun = (i + 1) % 7
    const haftaSonu = gun === 0 || gun === 6 ? 0.7 : 1
    const mevsim = 1000 + Math.round(300 * Math.sin(i / 30))
    for (let k = 0; k < kategoriler.length; k++) {
      const ziyaret = Math.round(mevsim * agirlik[k] * haftaSonu)
      const sip = (i * 4 + k) % 13 === 0 ? null : Math.round(ziyaret * 0.04)
      rows.push({ tarih: isoDate(2024, 0, 1 + i), kategori: kategoriler[k], ziyaret, sipariş: sip })
    }
  }
  return rows
}

export const datasets: Dataset[] = [
  { id: 'sales', label: 'Monthly sales — small, clean', lang: 'en', rows: buildSales() },
  { id: 'readings', label: 'Daily readings — small, with gaps', lang: 'en', rows: buildReadings() },
  { id: 'traffic', label: 'Daily traffic — large, with gaps', lang: 'en', rows: buildTraffic() },
  { id: 'satis', label: 'Aylık satış — küçük, temiz', lang: 'tr', rows: buildSatis() },
  { id: 'eticaret', label: 'Günlük e-ticaret — büyük, boşluklu', lang: 'tr', rows: buildEticaret() },
]

const PROFILE_SAMPLE = 5000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

export function summarizeData(rows: Row[]): DataSummary {
  const keys = Object.keys(rows[0] ?? {})
  const sample = rows.length > PROFILE_SAMPLE ? rows.slice(0, PROFILE_SAMPLE) : rows
  const columns: ColumnProfile[] = keys.map((name) => {
    const present = sample
      .map((row) => row[name])
      .filter((v): v is string | number => v !== null && v !== undefined && v !== '')
    const nums = present.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const numeric = present.length > 0 && nums.length === present.length
    const isDate = !numeric && present.length > 0 && present.every((v) => typeof v === 'string' && ISO_DATE.test(v))
    return {
      name,
      type: numeric ? 'number' : isDate ? 'date' : 'categorical',
      cardinality: new Set(present).size,
      nullCount: sample.length - present.length,
    }
  })
  return { rowCount: rows.length, columns }
}
