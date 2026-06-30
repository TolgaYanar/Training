export type Lang = 'en' | 'tr'

export interface Strings {
  title: string
  promptPlaceholder: string
  privacy: string
  generate: string
  enterPrompt: string
  dataTitle: (n: number) => string
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
    privacy: '🔒 Column names, category values, dates, long numbers, emails and links are replaced with placeholders before your request is sent — your data stays on this device. Other free text (names, notes in a sentence) is sent as written, so review the exact payload below before generating.',
    generate: 'Generate chart',
    enterPrompt: 'Enter a prompt first',
    dataTitle: (n) => `Data (${n} rows)`,
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
    privacy: '🔒 Sütun adları, kategori değerleri, tarihler, uzun sayılar, e-postalar ve bağlantılar; isteğiniz gönderilmeden önce yer tutucularla değiştirilir — verileriniz bu cihazda kalır. Diğer serbest metin (cümle içindeki adlar, notlar) yazıldığı gibi gönderilir, bu yüzden oluşturmadan önce aşağıdaki yükü gözden geçirin.',
    generate: 'Grafik oluştur',
    enterPrompt: 'Önce bir istem girin',
    dataTitle: (n) => `Veri (${n} satır)`,
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
