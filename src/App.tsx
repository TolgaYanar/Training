import { useMemo, useState } from 'react'
import { App as AntApp, Button, Card, Collapse, ConfigProvider, Empty, Input, Layout, Result, Select, Spin, Table, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption, Row, SentRequest } from './types'
import { datasets } from './data'
import { deidentify } from './ai'
import { SYSTEM_PROMPT } from './prompt'
import { chartService } from './service'

const { Header, Content } = Layout
const { Title } = Typography
const { TextArea } = Input

type Status = 'idle' | 'loading' | 'ok' | 'failed'

function ChartStage(props: { status: Status; option: EChartsOption | null; repaired: boolean; error: string; raw: string }) {
  const { status, option, repaired, error, raw } = props
  if (status === 'idle') return <Empty description="Describe a chart to generate" />
  if (status === 'loading') {
    return (
      <Spin tip="Generating chart..." size="large">
        <div style={{ height: '60vh' }} />
      </Spin>
    )
  }
  if (status === 'failed') {
    return (
      <Result status="warning" title="Could not generate a valid chart" subTitle={error}>
        {raw ? <pre style={{ maxHeight: 240, overflow: 'auto', textAlign: 'left' }}>{raw}</pre> : null}
      </Result>
    )
  }
  return (
    <Card title={repaired ? <Tag color="gold">auto-repaired</Tag> : 'Chart'} styles={{ body: { padding: 8 } }}>
      <ReactECharts option={option ?? {}} notMerge lazyUpdate style={{ height: '60vh' }} />
      <Collapse
        size="small"
        ghost
        items={[{ key: 'json', label: 'View generated option (JSON)', children: <pre style={{ maxHeight: 260, overflow: 'auto', margin: 0 }}>{option ? JSON.stringify(option, null, 2) : raw}</pre> }]}
      />
    </Card>
  )
}

function Main() {
  const { message } = AntApp.useApp()
  const [datasetId, setDatasetId] = useState(datasets[0].id)
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [option, setOption] = useState<EChartsOption | null>(null)
  const [repaired, setRepaired] = useState(false)
  const [error, setError] = useState('')
  const [raw, setRaw] = useState('')
  const [sent, setSent] = useState<SentRequest[]>([])
  const [sentPrompt, setSentPrompt] = useState('')

  const active = datasets.find((d) => d.id === datasetId) ?? datasets[0]
  const dataColumns: TableColumnsType<Row> = Object.keys(active.rows[0]).map((key) => ({ title: key, dataIndex: key, key }))
  const requests = useMemo<Array<{ key: string; label: string; system: string; user: string }>>(() => {
    const trimmed = prompt.trim()
    if (sent.length > 0 && trimmed === sentPrompt) {
      return sent.map((s, i) => ({
        key: `sent-${i}`,
        label: sent.length > 1 ? `Request ${i + 1} of ${sent.length} — ${i === 0 ? 'initial' : 'auto-repair'}` : 'Request sent',
        system: s.system,
        user: s.user,
      }))
    }
    if (!trimmed) return []
    return [{ key: 'preview', label: 'Request preview (will be sent on Generate)', system: SYSTEM_PROMPT, user: deidentify(trimmed, active.rows).message }]
  }, [prompt, sent, sentPrompt, active.rows])

  async function run() {
    if (!prompt.trim()) {
      message.warning('Enter a prompt first')
      return
    }
    setStatus('loading')
    const trimmed = prompt.trim()
    const result = await chartService.getChart({ source: datasetId, prompt: trimmed })
    setSent(result.sent ?? [])
    setSentPrompt(trimmed)
    if (result.status === 'ok') {
      setOption(result.option)
      setRepaired(result.repaired)
      setStatus('ok')
    } else {
      setError(result.error)
      setRaw(result.raw)
      setStatus('failed')
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center' }}>
        <Title level={4} style={{ color: '#fff', margin: 0 }}>Prompt &rarr; Chart</Title>
      </Header>
      <Content style={{ display: 'flex', gap: 16, padding: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 360, flex: '0 0 360px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select
            value={datasetId}
            onChange={(value) => setDatasetId(value)}
            options={datasets.map((d) => ({ label: d.label, value: d.id }))}
            style={{ width: '100%' }}
          />
          <TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. monthly revenue by region as a line chart"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>
            🔒 Column names, category values, dates, long numbers, emails and links are replaced with placeholders before your request is sent — your data stays on this device. Other free text (names, notes in a sentence) is sent as written, so review the exact payload below before generating.
          </Typography.Text>
          {requests.length > 0 ? (
            <Card size="small" title="🔍 Sent to the AI (de-identified)" styles={{ body: { padding: 8 } }}>
              <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                model claude-haiku-4-5 · output constrained to a JSON chart-spec schema{requests.length > 1 ? ` · ${requests.length} requests this run (initial + auto-repair)` : ''}
              </Typography.Text>
              {requests.map((r) => (
                <div key={r.key} style={{ marginBottom: 10 }}>
                  <Typography.Text strong style={{ fontSize: 12 }}>{r.label}</Typography.Text>
                  <Collapse
                    size="small"
                    ghost
                    items={[{ key: 'sys', label: 'System prompt', children: <pre style={{ margin: 0, maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.system}</pre> }]}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>User message</Typography.Text>
                  <pre style={{ margin: 0, maxHeight: 160, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.user}</pre>
                </div>
              ))}
            </Card>
          ) : null}
          <Button type="primary" loading={status === 'loading'} onClick={run}>Generate chart</Button>
          <Card size="small" title={`Data (${active.rows.length} rows)`}>
            <Table<Row>
              size="small"
              rowKey={(row) => JSON.stringify(row)}
              columns={dataColumns}
              dataSource={active.rows}
              pagination={{ pageSize: 6, size: 'small' }}
              scroll={{ x: true }}
            />
          </Card>
        </div>
        <div style={{ flex: 1 }}>
          <ChartStage status={status} option={option} repaired={repaired} error={error} raw={raw} />
        </div>
      </Content>
    </Layout>
  )
}

export default function App() {
  return (
    <ConfigProvider>
      <AntApp>
        <Main />
      </AntApp>
    </ConfigProvider>
  )
}
