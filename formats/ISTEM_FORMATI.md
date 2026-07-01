# İstem Formatı (Prompt Format) — draft v0

Kullanıcının grafik istemi bu **formata uymak zorundadır**; uymayan istem → **grafik yok**.
Tasarım ilkesi: **sınırda katı, ifadede esnek.** Kritik olan (gizlilik + verinin doğruluğu)
kısımlar sabittir; kullanıcının *nasıl yazdığı* serbesttir.

> Anahtar fikir: **veri kümenizin alanları = izin listesi.** `propGosterim` alanlarında ve
> `response` değerlerinde bulunmayan hiçbir şey token'a çözülemez → çözülemeyen hiçbir şey
> gönderilmez. Bu yüzden sınır *sonsuz sözlük* değil, *veriniz kadar* sınırlıdır.

---

## 1. İşlem hattı (katı vs esnek nerede)

```
İstem (serbest TR)
   │  1) ayrıştır (parse)          ── esnek: doğal Türkçe
   │  2) cihazda ÇÖZ (resolve)     ── alan→col_N, değer→val_N, sayı/tarih→lit_N
   │  3) KATI KAPI                 ── çözülemeyen içerik varsa → RED ("grafik yok")
   ▼
gidiş yükü = yalnız token'lar + sabit anahtar sözcükler   ── veri/isim ASLA çıkmaz
   │  4) AI yorumlar (esnek)       ── varsayılanlar, eş anlamlılar, "en çok 5" → sırala/limit
   ▼
spec (token'lı) → cihazda geri-çöz → motor gerçek satırlarda hesaplar → grafik
```

Çözme/tip-kontrol/tokenizasyon **cihazda, AI'dan ÖNCE** ve **kod ile** (AI ile değil) yapılır.
AI gizlilik sınırında asla güvenilen taraf değildir; yalnız token kümesi içinde yorum yapar.

---

## 2. İstem alanları (request DTO)

| slot | zorunlu? | değer | kural |
|---|---|---|---|
| `grafik` | hayır | çizgi \| çubuk \| alan \| pasta \| dağılım | verilmezse tipten çıkarılır |
| `x` | **evet\*** | bir alan | boyut / eksen |
| `ölçü` | **evet\*** | **sayısal** alan | ölçülen değer |
| `topla` | hayır | toplam \| ortalama \| adet \| min \| maks | varsayılan: `toplam` (ölçü varsa), `adet` (yoksa) |
| `seri` | hayır | bir alan | seriye böl (kanal/kategori başına) |
| `filtre` | hayır (0..n) | `<alan> <op> <değer>` | tip-güvenli (aşağıda) |
| `grupla` | hayır | gün \| hafta \| ay \| çeyrek \| yıl | yalnız `x` tarih alanıysa |
| `sırala` | hayır | artan \| azalan [ilk N] | sıralama / ilk-N |
| `görünüm` | hayır (0..n) | yığılmış \| yatay \| halka \| basamak \| gül | yalnız kozmetik |

\* En az bir *boyut* (`x`) ve/veya bir *ölçü* çözülmeli; ikisi de yoksa → RED.

---

## 3. KATI kurallar (pazarlıksız, fail-closed)

- **K1 — Kapalı çözüm.** `x`, `ölçü`, `seri`, `filtre`-alanı: her veri göndermesi `propGosterim`
  alanlarından **tam bir** alana çözülmeli. Çözülemeyen/çok-anlamlı → **RED** ("bilinmeyen alan: …").
  *(Bu, izin listesinin yerini alır; sınır verinizle sınırlıdır.)*
- **K2 — Yalnız-token gidişi (tripwire).** AI'ya giden metin **yalnız** `col_N`/`val_N`/`lit_N`
  token'ları + **sabit** anahtar-sözcük kümesi (§5) içerir. Başka herhangi bir sözcük → **engelle**.
  *(Veri satırları ve alan adları asla çıkmaz.)*
- **K3 — Tip-rol güvenliği.** `ölçü` ve sayısal `topla` → **sayı** alanı gerektirir; `grupla`/tarih-parçası
  → **tarih** alanı; `x`/`seri`/kategori-filtresi → kategori/metin alanı. Uyumsuz → **RED**.
- **K4 — Değer tiplemesi.** Kategori filtresi → o alanın **gerçek bir değeri** (`val_`/`lit_`, cihazda
  `response`'ta doğrulanır); sayısal filtre (`>`,`<`,`=`) → **sayı** (`lit_`); tarih filtresi → **tarih/parça**.
  Serbest metin (ör. bir isim) hiçbir zaman gönderilmez → **RED**.
- **K5 — Deterministik uygulama.** K1–K4 cihazda kod ile, AI çağrısından önce uygulanır.

---

## 4. ESNEK kurallar (yumuşak; AI + varsayılanlar)

- **E1 — Alan adı serbest.** Başlık (`baslik`), anahtar (`anahtar`) veya çekimli/eş-anlamlı Türkçe
  ("depoya", "DEPO", "giriş tarihi" → *Giriş Tarihi*). Büyük/küçük, aksan, ek duyarsız.
- **E2 — Sıra ve isteğe bağlılık.** Yalnız boyut/ölçü zorunlu; gerisi serbest sırada ve isteğe bağlı.
- **E3 — Grafik tipi & topla çıkarımı.** Verilmezse tiplerden seçilir (sayı+kategori→çubuk, tarih+sayı→çizgi,
  tek pay→pasta).
- **E4 — Doğal operatörler.** "en çok/az", "ilk 5", "…den fazla/az", "hariç", "aya göre", "…ile … arası".
- **E5 — Görünüm serbest.** Uygulanamıyorsa yok sayılır.

---

## 5. Sabit anahtar-sözcük kümesi (izinli, ~50 sözcük — TÜM sözlük bu)

`grafik x ölçü topla seri filtre grupla sırala görünüm` ·
`çizgi çubuk alan pasta dağılım` · `toplam ortalama adet min maks` ·
`gün hafta ay çeyrek yıl` · `artan azalan ilk` ·
`yığılmış yatay halka basamak gül` · `hariç fazla az eşit arası göre` ·
operatörler `> < >= <= = !=` · token'lar `col_N val_N lit_N`.

Bu küme kapalı ve denetlenebilir — 7.900 sözcüklük sözlüğün yerini alan sınırlı liste.

---

## 6. Örnekler (gerçek alanlar üzerinden)

| İstem | Çözülen spec | AI'ya giden yük |
|---|---|---|
| "Depoya göre toplam miktar, çubuk" | grafik=çubuk, x=Depo İsmi, ölçü=Miktar, topla=toplam | `grafik çubuk x col_2 ölçü col_9 topla toplam` |
| "Malzemeye göre ortalama ağırlık, en çok 10" | x=Malzeme İsmi, ölçü=Ağırlık Ort., topla=ortalama, sırala=azalan ilk 10 | `x col_5 ölçü col_14 topla ortalama sırala azalan ilk 10` |
| "Aya göre giren toplam miktar" | x=Giriş Tarihi, grupla=ay, ölçü=Miktar (çizgi çıkarıldı) | `x col_11 grupla ay ölçü col_9 topla toplam` |
| "001 deposundaki malzeme başına miktar" | filtre: Depo Kodu = "001", x=Malzeme İsmi, ölçü=Miktar | `filtre col_1 = val_3 x col_5 ölçü col_9` |

---

## 7. Reddedilen istemler (KATI → grafik yok, ve GÖNDERİLMEZ)

- "**Ahmet Yılmaz**'ın stokları" → "Ahmet Yılmaz" hiçbir alana/değere çözülmez → **RED** (gönderilmez). *(gizlilik kazancı)*
- "**Ciro**nun aylık trendi" → *ciro* bu veride yok → **RED** ("bilinmeyen alan: ciro").
- "Depo **ismine göre topla**" → metin alanı ölçü olamaz (K3) → **RED**.
- "Miktar > **mavi**" → sayısal alana metin değer (K4) → **RED**.

---

## 8. Kararlar (kilitli — 2026-07-01)

1. **Giriş yüzeyi:** HER İKİSİ (opsiyonel) — katı etiketli slotlar **ve** doğal TR cümle; ikisi de aynı iç
   `İstem` DTO'suna normalize edilir. Slotlar normalizasyondan sonra tek doğru kaynaktır.
2. **Çözülemeyen referans:** BLOCK+ASK — asla gönderilmez, ama kullanıcıya sorulur. Blok = gizlilik garantisi;
   soru = kurtarma yolu. İkisi birlikte.
3. **Yüksek-kardinaliteli değer:** `response`'ta cihazda üyelik doğrulanır → varsa opak `lit_`, yoksa BLOCK+ASK.

---

## 9. Ölçek mimarisi (10M satır × 5.000 sütun)

**İki düzlem, satırlar tek yerde.**
- **Ana iş parçacığı (kontrol düzlemi)** yalnız meta veri tutar: `propGosterim`'den bir kez kurulan **alan
  indeksi** (`Map<normalize sözcük, alanId[]>` + prefix trie), o anki `İstem`, ve yalnız bu isteğin token'ları
  için `toReal`. Satırlara ASLA sahip olmaz.
- **Web Worker (veri düzlemi)** 10M satırın tek kalıcı sahibi; **kolonlu** depo: sayı/tarih için typed array
  (Float64 / Int32 epoch-gün), kategorik için sözlük-kodlu (Uint32 kod + kod→etiket), sütun başına null
  bit-maskesi. Yalnız **referans verilen** sütunlar sıcak (LRU); asla 5.000 sütun birden. Veri worker'a
  **zero-copy Transferable** ile girer; ana iş parçacığı referansı bırakır.

**Çözüm O(istek):** her tuş vuruşunda değişen sözcük indeks Map'inde aranır (O(1) ort.), <16ms, sıfır satır.
Alan çözümü 10M satır YÜKLENMEDEN önce bile çalışır (yalnız `propGosterim` gerekir).

**Değer üyeliği:** enum → main'de `enumKeys` etiket→kod (taramasız); düşük-kard → worker'da tembel sözlük/set
(O(1), bir kez, cache); yüksek-kard → worker'da tek-sütun sınırlı tarama (~10-30ms, ilk eşleşmede durur, Bloom
'kesin yok'u O(1) yapar). Tuş vuruşunda ASLA; yalnız gönderim/stabilizasyonda, debounce'lu.

**Gidiş yükü şema/satır boyutundan bağımsız:** yalnız §5 anahtar sözcükler + bu isteğin token'ları (~bir düzine).
Tüm şemayı/değer listelerini ASLA gönderme. O(rows) olan HER ŞEY worker'da (tek-seferlik yükleme, tembel set,
tarama, **parçalı ~500k tek-geçiş toplama** + ilerleme/iptal). Ana iş parçacığında hiçbir O(rows) yok.

---

## 10. Katı ölçek-uyarıları (adversaryel incelemeden — pazarlıksız)

- **Ö1 — Yük yalnız ÇÖZÜLMÜŞ token kümesinden serilize edilir.** `tokenizeText` eşleşmeyen sözcüğü OLDUĞU GİBİ
  bırakır → gidiş metni ASLA o kalıntıdan kurulmaz. `tripwire.ts` zorunlu: yalnız {§5} ∪ {bu isteğin toReal
  token'ları} geçer; başka tek sözcük → BLOK. `Outbound` branded tip çağrı yerinde zorlar. `rawWords` hiçbir
  gidiş/log alanına girmez.
- **Ö2 — clarify/ambiguity metni de tripwire'dan geçer.** "…bu değer bulunamadı" / "şunu mu demek istediniz:
  Depo İsmi?" ham girdi/başlık içerir — yalnız yerelde gösterilir, ASLA AI'ya/loga gitmez.
- **Ö3 — enum kod↔etiket tamamen cihazda.** Satırlar kod tutar (999), etiket yalnız `propGosterim`'de. Filtre
  etiket→kod (main), grafik ekseni kod→etiket (main). `enumKeys` AI'ya ASLA gönderilmez.
- **Ö4 — indeks yalnız DÜZ, hesaplanabilir üst-seviye alanları çözer.** Nested `liste` alt-alanları ve `gizli`
  id sütunları çözülemez. Yinelenen `baslik` → aday listesi + BLOCK+ASK (anahtar/tip ile ayırt et).
- **Ö5 — scatter + doğrulama ölçek-güvenli.** scatter satır başına ~5.000-sütunlu etiket ÜRETMEZ (bellek
  bombası + ham sızıntı): worker'da nokta sabit tavana (~50k) iner, etiket yok. `checkOption` main'de
  `echarts.init` ile DOĞRULAMAZ — ucuz yapısal kontrol; top-N worker'da render'dan önce zorlanır.

---

## 11. Kurulum sırası (build order)

1. `schema.ts` — `propGosterim` → `FieldMeta[]` (tip `gosterimBilgi.tur`'dan; `enumKeys`); yalnız düz alanlar.
2. `fieldIndex.ts` — ters indeks Map + trie (tokens.ts Türkçe-fold BUILD-time); çakışma→aday listesi.
3. `request.ts` + `resolve.ts` — İstem DTO + slot çözücü (yeşil/amber/kırmızı çip); K1+K3 kapıları cihazda.
4. `dataWorker.ts` — kolonlu depo + zero-copy transfer yükleyici (typed array + null maske + LRU); parçalı akış.
5. `workerBridge.ts` — `workerClient.ts`'i DEĞİŞTİRİR: {loadData}, {resolveMembership}, {compute spec,seq};
   `postMessage({rows})` ve WORKER_THRESHOLD silinir.
6. Worker üyelik — enum(main)/düşük-kard(set)/yüksek-kard(tarama+Bloom) + debounce'lu "bu değer bulunamadı".
7. `chart.ts`/`chartCompute.ts` kolonlu'ya uyarla — tek parçalı grup-by; enum kod→etiket; top-N; iptal.
8. `normalizeTr.ts` — doğal TR cümle → slotları doldurur (E1–E4), yıkıcı değil.
9. `tripwire.ts` — fail-closed gidiş kontrolü (Ö1); branded `Outbound`.
10. AI turu — `detokenizeSpec` (KORUNDU) cihazda; AI çağrısı optimistik iskelet + ilerleme ile paralel.
11. Başlangıç UX — satırlar yüklenmeden yaz-ve-çöz; iskelet + ilerleme; yeni gönderimde iptal.
