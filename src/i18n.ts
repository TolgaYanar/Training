export type Lang = 'en' | 'tr'

export interface Strings {
  title: string
  promptPlaceholder: string
  privacy: string
  generate: string
  enterPrompt: string
  dataTitle: (n: number) => string
  redactedTitle: string
  redactionLabel: (kind: string, n: number) => string
  blockedTitle: string
  blockedBody: string
  nameRiskTitle: string
  sentCard: string
  modelLine: (m: string) => string
  requestsSuffix: (n: number) => string
  systemPrompt: string
  userMessage: string
  viewRaw: string
  viewOption: string
  reqOf: (i: number, n: number) => string
  reqSent: string
  reqPreview: string
  idle: string
  loading: string
  failTitle: string
  repaired: string
  chart: string
}

export const STRINGS: Record<Lang, Strings> = {
  en: {
    title: 'Prompt → Chart',
    promptPlaceholder: 'e.g. monthly revenue by region as a line chart',
    privacy: '🔒 Your request is de-identified on this device before anything leaves it. Column names, values, dates, numbers, emails, links — and any names, IDs or text that isn’t standard chart vocabulary — become opaque placeholders. Only chart words and those placeholders are ever sent.',
    generate: 'Generate chart',
    enterPrompt: 'Enter a prompt first',
    dataTitle: (n) => `Data (${n} rows)`,
    redactedTitle: '🔒 Kept on your device',
    redactionLabel: (kind, n) => {
      const s = n > 1 ? 's' : ''
      const m: Record<string, string> = {
        columns: `${n} column name${s}`, values: `${n} value${s}`, emails: `${n} email${s}`,
        links: `${n} link${s}`, pii: `${n} phone/ID number${s}`, dates: `${n} date${s}`,
        numbers: `${n} number${s}`, names: `${n} name${s} / free-text`,
      }
      return m[kind] ?? `${n} ${kind}`
    },
    blockedTitle: 'That looks like pasted data',
    blockedBody: 'Describe the chart in words instead of pasting rows or a table — pasted data is masked and won’t make a useful chart.',
    nameRiskTitle: 'Possible names will be sent as-is — remove them if they’re private:',
    sentCard: '🔍 Sent to the AI (de-identified)',
    modelLine: (m) => `model ${m} · validated on-device before render`,
    requestsSuffix: (n) => ` · ${n} requests this run (initial + auto-repair)`,
    systemPrompt: 'System prompt',
    userMessage: 'User message',
    viewRaw: 'View AI response (raw spec)',
    viewOption: 'View generated option (JSON)',
    reqOf: (i, n) => `Request ${i + 1} of ${n} — ${i === 0 ? 'initial' : 'auto-repair'}`,
    reqSent: 'Request sent',
    reqPreview: 'Request preview (will be sent on Generate)',
    idle: 'Describe a chart to generate',
    loading: 'Generating chart...',
    failTitle: 'Could not generate a valid chart',
    repaired: 'auto-repaired',
    chart: 'Chart',
  },
  tr: {
    title: 'İstem → Grafik',
    promptPlaceholder: 'örn. şehre göre toplam gelir, çubuk grafik',
    privacy: '🔒 İsteğiniz, cihazdan ayrılmadan önce bu cihazda kimliksizleştirilir. Sütun adları, değerler, tarihler, sayılar, e-postalar, bağlantılar — ve standart grafik sözcüğü olmayan adlar, kimlikler veya metinler — opak yer tutuculara dönüşür. Yalnızca grafik sözcükleri ve bu yer tutucular gönderilir.',
    generate: 'Grafik oluştur',
    enterPrompt: 'Önce bir istem girin',
    dataTitle: (n) => `Veri (${n} satır)`,
    redactedTitle: '🔒 Cihazınızda kaldı',
    redactionLabel: (kind, n) => {
      const m: Record<string, string> = {
        columns: `${n} sütun adı`, values: `${n} değer`, emails: `${n} e-posta`,
        links: `${n} bağlantı`, pii: `${n} telefon/kimlik no`, dates: `${n} tarih`,
        numbers: `${n} sayı`, names: `${n} ad / serbest metin`,
      }
      return m[kind] ?? `${n} ${kind}`
    },
    blockedTitle: 'Bu yapıştırılmış veri gibi görünüyor',
    blockedBody: 'Satır veya tablo yapıştırmak yerine grafiği sözcüklerle tarif edin — yapıştırılan veri maskelenir ve işe yarar bir grafik oluşturmaz.',
    nameRiskTitle: 'Olası adlar olduğu gibi gönderilecek — özelse kaldırın:',
    sentCard: '🔍 Yapay zekâya gönderilen (kimliksizleştirilmiş)',
    modelLine: (m) => `model ${m} · cihazda doğrulandı`,
    requestsSuffix: (n) => ` · bu çalıştırmada ${n} istek (ilk + otomatik düzeltme)`,
    systemPrompt: 'Sistem istemi',
    userMessage: 'Kullanıcı mesajı',
    viewRaw: 'Yapay zekâ yanıtını gör (ham özellik)',
    viewOption: 'Oluşturulan seçeneği gör (JSON)',
    reqOf: (i, n) => `İstek ${i + 1}/${n} — ${i === 0 ? 'ilk' : 'otomatik düzeltme'}`,
    reqSent: 'Gönderilen istek',
    reqPreview: 'İstek önizlemesi (Oluştur’a basınca gönderilecek)',
    idle: 'Oluşturmak için bir grafik tarif edin',
    loading: 'Grafik oluşturuluyor...',
    failTitle: 'Geçerli bir grafik oluşturulamadı',
    repaired: 'otomatik düzeltildi',
    chart: 'Grafik',
  },
}
