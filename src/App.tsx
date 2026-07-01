import { useMemo, useState } from 'react'
import { App as AntApp, Alert, AutoComplete, Button, Card, ConfigProvider, Empty, Flex, Input, Layout, Modal, Segmented, Select, Space, Spin, Tag, Typography } from 'antd'
import ReactECharts from 'echarts-for-react'
import propRaw from '../formats/propGosterim.json'
import rowsRaw from '../formats/response.json'
import type { ChartSpec, EChartsOption, Row } from './types'
import { buildSchema, type FieldMeta, type PropField } from './schema'
import { buildFieldIndex } from './fieldIndex'
import { resolveRequest, type Chip } from './resolve'
import type { Agg, Bucket, ChartKind, RequestInput } from './request'
import { buildRequestChart, describeSpec, requestToSpec } from './toChart'
import { generateChartAI, previewTokens } from './aiChart'

const schema = buildSchema(propRaw as unknown as PropField[])
const index = buildFieldIndex(schema)
const rows = rowsRaw as unknown as Row[]
const byAnahtar = new Map(schema.map((f) => [f.anahtar, f]))
const API_KEY = import.meta.env.VITE_CLAUDE_API_KEY ?? ''

const isDim = (f: FieldMeta): boolean => f.type !== 'number'
const isNum = (f: FieldMeta): boolean => f.type === 'number'
const isCat = (f: FieldMeta): boolean => f.type === 'categorical'
const opts = (query: string, ok: (f: FieldMeta) => boolean): { value: string }[] => index.suggest(query, 30, ok).map((f) => ({ value: f.baslik }))
const TIP_TR: Record<string, string> = { number: 'sayı', categorical: 'kategori', date: 'tarih', boolean: 'evet/hayır' }
const ROLE_COLOR: Record<string, string> = { 'X ekseni': 'blue', 'Y ekseni': 'green', 'Seri': 'cyan', 'Filtre': 'magenta' }
const REASON_TR: Record<string, string> = {
  unknownField: 'böyle bir alan yok',
  unknownValue: 'veride böyle bir değer yok',
  field: 'alan → "tırnak" içine alın',
  value: 'değer → [parantez] içine alın',
  name: 'isim/serbest metin',
}
const REASON_COLOR: Record<string, string> = { unknownField: 'red', unknownValue: 'red', field: 'blue', value: 'geekblue', name: 'orange' }
function unresolvedMsg(u: { reason: string; suggestions?: string[] }): string {
  const base = REASON_TR[u.reason] ?? 'işaretlenmeli'
  return (u.reason === 'unknownField' || u.reason === 'unknownValue') && u.suggestions?.length
    ? `${base} — bunu mu: ${u.suggestions.join(' / ')}?`
    : base
}
function roleOf(a: string, spec: ChartSpec | null): string {
  if (!spec) return ''
  if (spec.x === a) return 'X ekseni'
  if (spec.series === a) return 'Seri'
  if (spec.measure === a && spec.aggregate !== 'count') return 'Y ekseni'
  if (spec.filters?.some((f) => f.column === a)) return 'Filtre'
  return ''
}

const { Header, Content } = Layout
const { Title, Text } = Typography

const GRAFIK_OPTS = [
  { label: 'otomatik seç', value: '' }, { label: 'çubuk', value: 'çubuk' }, { label: 'çizgi', value: 'çizgi' },
  { label: 'alan', value: 'alan' }, { label: 'pasta', value: 'pasta' }, { label: 'dağılım', value: 'dağılım' },
]
const TOPLA_OPTS = [
  { label: 'otomatik (toplam)', value: '' }, { label: 'toplam', value: 'toplam' }, { label: 'ortalama', value: 'ortalama' },
  { label: 'adet (kayıt say)', value: 'adet' }, { label: 'en az (min)', value: 'min' }, { label: 'en çok (maks)', value: 'maks' },
]
const GRUPLA_OPTS = [
  { label: 'yok', value: '' }, { label: 'günlük', value: 'gün' }, { label: 'haftalık', value: 'hafta' },
  { label: 'aylık', value: 'ay' }, { label: 'çeyrek', value: 'çeyrek' }, { label: 'yıllık', value: 'yıl' },
]

function Slot({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <Flex vertical gap={2}>
      <Text strong style={{ fontSize: 12 }}>{label}</Text>
      {children}
      <Text type="secondary" style={{ fontSize: 11 }}>{hint}</Text>
    </Flex>
  )
}

function ChipRow({ label, chip, onPick }: { label: string; chip?: Chip; onPick: (baslik: string) => void }) {
  if (!chip) return null
  if (chip.state === 'green') return <Tag color="green">{label}: {chip.field.baslik} · {TIP_TR[chip.field.type]}</Tag>
  if (chip.state === 'red') return <Tag color="red">{label}: {chip.reason === 'unknown' ? 'bilinmeyen alan' : 'tip uyumsuz'}</Tag>
  return (
    <Space size={4} wrap>
      <Tag color="orange">{label}: belirsiz →</Tag>
      {chip.candidates.map((c) => <Button key={c.id} size="small" onClick={() => onPick(c.baslik)}>{c.baslik}</Button>)}
    </Space>
  )
}

const SUM_COLOR: Record<string, string> = {
  'Grafik türü': 'purple', 'X ekseni': 'blue', 'Y ekseni (ölçü)': 'green', 'Seri (ayrım)': 'cyan',
  'Zaman gruplama': 'gold', 'Sıralama': 'orange', 'Filtre': 'magenta',
}
function SpecSummary({ spec, title }: { spec: ChartSpec; title: string }) {
  return (
    <Card size="small" title={title} styles={{ body: { padding: 8 } }}>
      <Space size={[6, 6]} wrap>
        {describeSpec(spec, byAnahtar).map((d, i) => (
          <Tag key={i} color={SUM_COLOR[d.etiket] ?? 'default'}>{d.etiket}: {d.deger}</Tag>
        ))}
      </Space>
    </Card>
  )
}

function Main() {
  const [mode, setMode] = useState<'cumle' | 'alanlar'>('cumle')
  const [sentence, setSentence] = useState('')
  const [fieldQuery, setFieldQuery] = useState('')
  const [grafik, setGrafik] = useState<ChartKind | ''>('')
  const [x, setX] = useState('')
  const [olcu, setOlcu] = useState('')
  const [seri, setSeri] = useState('')
  const [topla, setTopla] = useState<Agg | ''>('')
  const [grupla, setGrupla] = useState<Bucket | ''>('')
  const [option, setOption] = useState<EChartsOption | null>(null)
  const [spec, setSpec] = useState<ChartSpec | null>(null)
  const [pending, setPending] = useState<{ spec: ChartSpec; option: EChartsOption } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const request: RequestInput = useMemo(() => ({
    grafik: grafik || undefined, x: x.trim() || undefined, olcu: olcu.trim() || undefined,
    seri: seri.trim() || undefined, topla: topla || undefined, grupla: grupla || undefined,
  }), [grafik, x, olcu, seri, topla, grupla])
  const resolved = useMemo(() => resolveRequest(request, index), [request])
  const preview = useMemo(() => (sentence.trim() ? previewTokens(sentence, index, rows) : null), [sentence])
  const liveSpec = useMemo(() => {
    if (mode !== 'alanlar') return null
    const s = requestToSpec(request, resolved)
    return 'spec' in s ? s.spec : null
  }, [mode, request, resolved])

  const hasField = !!preview && Object.keys(preview.toReal).some((k) => k.startsWith('col_'))
  const blocked = mode === 'cumle'
    ? !sentence.trim() || !preview || preview.unresolved.length > 0 || !hasField
    : resolved.blocked

  async function generate() {
    setError('')
    if (mode === 'cumle') {
      setLoading(true)
      try {
        const r = await generateChartAI(sentence, index, rows, API_KEY)
        if ('option' in r) setPending({ spec: r.spec, option: r.option })
        else if ('ask' in r) setError(`Gönderilmedi — ${r.ask.map((u) => `${u.text}: ${unresolvedMsg(u)}`).join(' · ')}`)
        else setError(r.error)
      } finally {
        setLoading(false)
      }
      return
    }
    const r = buildRequestChart(request, resolved, rows)
    if ('option' in r) setPending({ spec: r.spec, option: r.option })
    else setError(r.error)
  }

  function confirmPending() {
    if (!pending) return
    setOption(pending.option)
    setSpec(pending.spec)
    setPending(null)
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header><Title level={4} style={{ color: '#fff', margin: 0, lineHeight: '64px' }}>İstem → Grafik</Title></Header>
      <Content style={{ padding: 16 }}>
        <Flex gap={16} align="flex-start">
          <Flex vertical gap={12} style={{ width: 400, flexShrink: 0 }}>
            <Segmented value={mode} onChange={(v) => setMode(v as 'cumle' | 'alanlar')} options={[{ label: 'Cümle (AI)', value: 'cumle' }, { label: 'Alanlar', value: 'alanlar' }]} block />

            {mode === 'cumle' ? (
              <>
                <Input.TextArea value={sentence} onChange={(e) => { setSentence(e.target.value); setSpec(null); setOption(null); setError('') }} placeholder={'örn. "Depo İsmi" bazında toplam "Miktar" çubuk'} autoSize={{ minRows: 3, maxRows: 6 }} />
                <Flex gap={8} align="center">
                  <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>+ Alan ekle</Text>
                  <AutoComplete
                    value={fieldQuery}
                    onChange={setFieldQuery}
                    onSelect={(v: string) => { setSentence((s) => (s.trim() ? s.trimEnd() + ' ' : '') + `"${v}"`); setFieldQuery(''); setSpec(null); setOption(null); setError('') }}
                    options={opts(fieldQuery, () => true)}
                    filterOption={false}
                    allowClear
                    style={{ flex: 1 }}
                    placeholder="alan adı yazın — tırnaklı eklenir"
                  />
                </Flex>
                <Text type="secondary" style={{ fontSize: 11 }}>Kural: alanlar <Text code style={{ fontSize: 11 }}>"tırnak"</Text>, değerler <Text code style={{ fontSize: 11 }}>[köşeli parantez]</Text> içinde. Gerisi serbest yazılır.</Text>
                {preview ? (
                  <Card size="small" title="Cihazda çözüldü (AI'ya gidecek)" styles={{ body: { padding: 8 } }}>
                    <Space size={[4, 4]} wrap>
                      {Object.entries(preview.toReal).map(([k, a]) => {
                        if (k.startsWith('col_')) {
                          const f = byAnahtar.get(a)
                          const role = roleOf(a, spec)
                          return <Tag key={k} color={role ? (ROLE_COLOR[role] ?? 'green') : 'green'}>{k} · {f?.baslik ?? a} · {role || (f ? TIP_TR[f.type] : '')}</Tag>
                        }
                        return <Tag key={k} color="blue">{k} · değer: {a}</Tag>
                      })}
                      {preview.unresolved.map((u) => <Tag key={`u-${u.text}-${u.reason}`} color={REASON_COLOR[u.reason] ?? 'red'}>{u.text} · {unresolvedMsg(u)}</Tag>)}
                    </Space>
                    {preview.unresolved.length > 0 ? (
                      <Text type="danger" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>Bunlar işaretlenmeden gönderilmez — alanları <Text code style={{ fontSize: 11 }}>"tırnak"</Text>, değerleri <Text code style={{ fontSize: 11 }}>[parantez]</Text> içine alın.</Text>
                    ) : !hasField ? (
                      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>En az bir alanı <Text code style={{ fontSize: 11 }}>"tırnak"</Text> içine alın (örn. "Miktar").</Text>
                    ) : null}
                    <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6, wordBreak: 'break-word' }}>yük: {preview.payload || '—'}</Text>
                  </Card>
                ) : null}
              </>
            ) : (
              <Flex vertical gap={10}>
                <Slot label="Grafik türü" hint="boş bırakılırsa veriye göre seçilir">
                  <Select value={grafik} onChange={(v) => setGrafik(v as ChartKind | '')} options={GRAFIK_OPTS} style={{ width: '100%' }} />
                </Slot>
                <Slot label="1) Neye göre? — kırılım (x ekseni)" hint="kategori veya tarih alanı · ör. Depo İsmi, Giriş Tarihi">
                  <AutoComplete value={x} onChange={setX} options={opts(x, isDim)} filterOption={false} allowClear style={{ width: '100%' }} placeholder="alan seçin veya yazın" />
                </Slot>
                <Slot label="2) Hangi sayı? — ölçü" hint="toplanıp/ortalanıp çizilecek sayısal alan · ör. Miktar">
                  <AutoComplete value={olcu} onChange={setOlcu} options={opts(olcu, isNum)} filterOption={false} allowClear style={{ width: '100%' }} placeholder="sayısal alan (boşsa: kayıt adedi)" />
                </Slot>
                <Slot label="3) Nasıl birleşsin? — birleştirme" hint="aynı kırılımdaki satırlar nasıl toplanır">
                  <Select value={topla} onChange={(v) => setTopla(v as Agg | '')} options={TOPLA_OPTS} style={{ width: '100%' }} />
                </Slot>
                <Slot label="İkinci ayrım — seri (isteğe bağlı)" hint="her değeri ayrı çizgi/çubuk yapar · ör. Depo Tipi">
                  <AutoComplete value={seri} onChange={setSeri} options={opts(seri, isCat)} filterOption={false} allowClear style={{ width: '100%' }} placeholder="(boş bırakılabilir)" />
                </Slot>
                <Slot label="Zaman gruplama (isteğe bağlı)" hint="yalnız tarih ekseninde: günlük/aylık…">
                  <Select value={grupla} onChange={(v) => setGrupla(v as Bucket | '')} options={GRUPLA_OPTS} style={{ width: '100%' }} />
                </Slot>
                <Card size="small" title="Cihazda çözüldü" styles={{ body: { padding: 8 } }}>
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <ChipRow label="x" chip={resolved.x} onPick={setX} />
                    <ChipRow label="ölçü" chip={resolved.olcu} onPick={setOlcu} />
                    <ChipRow label="seri" chip={resolved.seri} onPick={setSeri} />
                    {resolved.grupla && !resolved.gruplaOk ? <Tag color="red">grupla: tarih ekseni gerekir</Tag> : null}
                    {resolved.x?.state !== 'green' && resolved.olcu?.state !== 'green' ? <Text type="secondary" style={{ fontSize: 12 }}>En az bir alan girin…</Text> : null}
                  </Space>
                </Card>
              </Flex>
            )}

            {(spec ?? liveSpec) ? <SpecSummary spec={(spec ?? liveSpec)!} title={spec ? 'Grafik özeti' : 'Önizleme'} /> : null}
            <Button type="primary" loading={loading} disabled={blocked} onClick={generate}>Grafik oluştur</Button>
            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>🔒 Veri cihazda kalır. AI yalnızca alan/değer token'larını (col_/val_) ve niyet sözcüklerini görür; hiçbir alan adı veya değer ham gitmez.</Text>
          </Flex>

          <Flex flex={1} vertical>
            {loading ? (
              <Spin size="large"><div style={{ height: '55vh' }} /></Spin>
            ) : error ? (
              <Alert type="warning" showIcon message="Grafik oluşturulamadı" description={error} />
            ) : option ? (
              <Card styles={{ body: { padding: 8 } }}><ReactECharts option={option} notMerge lazyUpdate style={{ height: '55vh' }} /></Card>
            ) : (
              <Empty description="Bir istem girin ve grafik oluşturun" style={{ marginTop: '18vh' }} />
            )}
          </Flex>
        </Flex>
      </Content>
      <Modal
        open={!!pending}
        title="Grafiği onaylayın"
        okText="Onayla ve oluştur"
        cancelText="İptal"
        onOk={confirmPending}
        onCancel={() => setPending(null)}
      >
        {pending ? (
          <Flex vertical gap={10}>
            <Text>Aşağıdaki grafik oluşturulacak — onaylıyor musunuz?</Text>
            <Space size={[6, 6]} wrap>
              {describeSpec(pending.spec, byAnahtar).map((d, i) => (
                <Tag key={i} color={SUM_COLOR[d.etiket] ?? 'default'}>{d.etiket}: {d.deger}</Tag>
              ))}
            </Space>
          </Flex>
        ) : null}
      </Modal>
    </Layout>
  )
}

export default function App() {
  return (
    <ConfigProvider>
      <AntApp><Main /></AntApp>
    </ConfigProvider>
  )
}
