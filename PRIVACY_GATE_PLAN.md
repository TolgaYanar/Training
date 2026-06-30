# Privacy Hardening Plan — Default‑Deny Prompt Gate

> **Status:** design complete, not yet implemented. This is the working spec to continue on any machine.
> **How to use this doc:** read §0–§3 for the idea, §10–§11 to know exactly what to touch in the code, and §16 for the build order. Everything is on‑device, browser‑only, synchronous. Nothing here changes the chart engine — it only hardens what leaves the device.
>
> Produced by a research workflow (11 agents: 6 investigators → synthesis → 3 red‑team adversaries → finalize). 17 concrete leaks were found and folded into this v2.

---

## 0. TL;DR

The prompt → chart app de‑identifies the user's prompt **on‑device** before sending it to the hosted AI. Today that de‑id is a **denylist** (mask what we recognize), so anything unrecognized — a name, a small number, a value not in the dataset — is **sent verbatim**. We are flipping it to **default‑deny**: only opaque tokens (`col_/val_/lit_`) and a fixed, audited **~900‑word chart vocabulary** may leave the device. Everything else is **masked** (silent), **blocked** (hard PII), or **held to ask the user**. Nothing sends until every flag is resolved.

This delivers a verifiable guarantee — *no verbatim sensitive value crosses the boundary* — at the cost of occasional over‑redaction (friction, not leakage). It does **not** (and cannot) eliminate structural/inference disclosure; see §12.

---

## 1. Problem & current state

### What the app does today (the chokepoint)
`src/ai.ts → deidentify(prompt, rows)`:
```ts
const summary = summarizeData(rows)
const { summary: schema, toReal } = buildTokens(summary, rows)      // tokens.ts
const safePrompt = redactLiterals(tokenizeText(prompt, toReal), toReal)
return { message: buildSpecMessage(safePrompt, schema), toReal }
```
- **`tokenizeText`** (tokens.ts) replaces **dataset column names → `col_N`** and **category values → `val_N`**. It already has the **Turkish morphology** work from this session: `NAME_SUFFIX` (compositional plural+case suffixes) and `vowelDrop` (`şehir`→`şehr`), so inflected Turkish names tokenize.
- **`redactLiterals`** (tokens.ts) masks literals → `lit_N`: `EMAIL`, `URL`, `ISO_DATE` (`\d{4}-\d{1,2}-\d{1,2}`), `GROUPED_NUMBER` (`1,000`), `SEPARATED_DIGITS`, `DECIMAL`, `LONG_NUMBER` (`\d{4,}`).
- **`buildSpecMessage`** (prompt.ts) wraps the de‑identified prompt with the **schema** (`profileLines`: each column's token, type, cardinality, and for small categoricals the `val_N` value list).

### The leak surface = the prompt text (only)
The schema half is already pure tokens. The vulnerability is everything in the prompt that is **not** a column name, a known value, or a recognized literal — it passes through. The i18n privacy notice literally admits *"Other free text … is sent as written."*

**Concrete leaks today:** `show Jonathan's orders over 5` → `Jonathan` (name not in data) and `5` (short number) both leave verbatim. Phone numbers, national IDs, IBANs (spaced), addresses, lowercase names, pasted rows — none are caught.

### Goal (the decided model)
Make the prompt channel **fail‑closed**. Guarantee no data exposure even by user mistake. Use **both**: hard‑**block** definite PII, **ask** the user on ambiguous tokens. (User's words: *"we cannot expose any data by any chance, user mistake etc."*, and *"either restrict … or ask the user, maybe both."*)

---

## 2. Core principle: default‑deny

A **denylist can never be proven complete** — you can't enumerate every name/ID/format. A guarantee requires the inverse:

> Treat the prompt as **untrusted**. Only let through (a) the opaque tokens minted locally, and (b) words from a **closed, auditable allowlist** of chart‑intent vocabulary. Everything else is held back.

Recall is then **100% by construction**: the classifier's final branch (`ASK`/`MASK`) catches anything not provably safe; no token bypasses classification.

**Friction posture:** a false negative is a *leak*; a false positive is only *friction*. Over‑redaction (`MASK` → `lit_N`) is silent and harmless (the AI sees `lit_7` instead of `Acme`). So the design is **recall‑first**; vocabulary completeness is the dial that controls friction.

---

## 3. The pipeline (new module `src/gate.ts`)

Pure, synchronous, on‑device. Input: raw prompt. Output: `{ safePrompt, flags }`. The chokepoint stays `deidentify()` in `ai.ts`. **Both outbound halves are gated** — the prompt *and* the schema.

```
raw prompt
 ├─[S0] normalize()      Unicode hardening — the SINGLE source of canonicalization
 ├─[S1] blobGuard()      structured‑paste detector → BLOCK
 ├─[S2] tokenizeText()   EXISTING — dataset names→col_N, values→val_N (+ fixes A–D)
 ├─[S3] redactLiterals() EXISTING + checksum‑validated BLOCK detectors → lit_N / BLOCK
 ├─[S4] classifyResidual()  the DEFAULT‑DENY gate → SAFE | MASK | ASK | BLOCK
 ├─[S5] gateSchema()     guard the schema half (cardinality bands, value‑list suppression)
 └─[S6] renumberTokens() remap all tokens to a per‑message RANDOM permutation
output: { safePrompt, flags: Flag[] }
```

### S0 — `normalize()` (Unicode hardening)
1. **NFKC** (folds fullwidth/ligatures; Arabic‑Indic digits → ASCII).
2. **NFD → strip all `\p{Mn}\p{Me}` → re‑NFC** (kills combining accents *and* the `İ` combining dot).
3. **Diacritic→ASCII fold** via a curated table for supported langs (`á→a`, `ć→c`) **but PRESERVE Turkish `ç ğ ı ö ş ü`** as themselves.
4. **Strip default‑ignorable / zero‑width:** `\p{Cf}`, `U+200B‑200D`, `FEFF`, `2060`, `00AD`, variation selectors `FE00‑FE0F`/`E0100‑E01EF`, tag chars `E0000‑E007F`.
5. **Confusable‑skeleton:** map every char through a curated Unicode‑confusables subset to a Latin/TR skeleton (Cyrillic `а`→`a`, Greek look‑alikes).
6. **ASSERT residue:** any remaining `\p{Cf}\p{Mn}\p{Me}` / default‑ignorable → **BLOCK "evasion"**.
7. **Script gate:** any char outside allowed scripts (Latin + Turkish + digits + punctuation) *after* skeletonizing → **BLOCK "evasion"**.
8. **Two outputs:** `display` (NFC, what the user sees) and `key` (skeleton+folded, used for *all* matching). Combining marks never appear in any matching class.
- *Closes:* combining‑accent leak, Cyrillic/Greek homoglyph, cross‑token confusable split, zero‑width split.

### S1 — `blobGuard()` (structured‑paste detector, on the skeleton)
- ≥2 newlines with a consistent delimiter (`, ; \t |`) → **BLOCK "blob"**.
- JSON‑like `{…}`/`[…]` with quoted keys → **BLOCK**.
- length > 280 **and** (high digit density **or** ≥1 capitalized token per line) → **BLOCK**.
- single line: ≥5 delimiter‑separated fields where >50% are out‑of‑vocab → **BLOCK**.
- *Closes:* pasted spreadsheet rows, single‑line CSV, an 80‑name comma list. A structured paste is never a chart intent.

### S2 — `tokenizeText()` (existing, with fixes)
- **FIX A:** collapse `\s+`→single space in **both** the value alternation and the input before matching (so `Acme  Corp` masks).
- **FIX B:** build the alternation key on `normalizeTr()`, and **emit each non‑vocab constituent word** of a multi‑word value (so `Acme` alone masks).
- **FIX C:** replace every `real.toLowerCase()` (tokens.ts ~131,146) with `normalizeTr()`.
- **FIX D:** remove `\p{M}` from `UWORD` (tokens.ts:6) so a combining mark can never sit inside a match token.
- *Closes:* `Acme  Corp`, `İzmir`/`izmir`/`IZMIR`/`Irmak` casing, multi‑word org partials.

### S3 — `redactLiterals()` (existing + checksum BLOCK detectors)
- Keep current `EMAIL/URL/ISO_DATE/GROUPED/SEPARATED/DECIMAL/LONG`.
- Add the **§6 BLOCK detectors**, run **early** (before the generic digit rules).
- For checksum validation, work on a **`[\s.\-_/]`‑collapsed copy** (reassembles split numbers), but mask on the **original offsets**; the whole structured value → **one** `lit_N`.
- Add slash/dot/dash numeric dates with 1–2 digit parts (`31/12/2024`, `10.5.2024`).
- Skip already‑minted `lit_N` spans so a masked number can't be re‑read.
- *Closes:* spaced IBAN/phone/card, separator‑split checksum evasion.

### S4 — `classifyResidual()` (the default‑deny gate)
- Segment `safePrompt` into token spans `/(?:col|val|lit)_\d+/g` vs residual gaps.
- For each residual word run `classifyToken()` (§5); compute char spans on the **final** `safePrompt` via `matchAll` + overlap rejection.
- **`MASK`** = splice a new `lit_N` — but **first re‑check** the word against dataset values via `normalizeTr()`; if it canonicalizes to a known value, splice that value's **`val_N`** (never a fresh `lit_N`, so the column linkage is preserved).
- *Closes:* a dataset value the tokenizer missed leaking as `lit_N` and losing its column.

### S5 — `gateSchema()` (guard the schema half — the inference channel)
This is **new** and closes the biggest residual the original gate never touched.
- **Never** emit the per‑value token list; replace `values: val_3,val_4,…` with a **count band** (`~5‑10 values`).
- Emit value tokens **only** for columns the (gated) `safePrompt` actually references; tag each with its owning column inline.
- Cardinality **≤4** → emit only `(categorical)` — no band, no values, no `nullCount` (highest risk: binary sensitive partitions).
- Drop `, some missing` unless `safePrompt` has a gap/missing/null intent token, and only for the referenced column.
- **Drop the exact cardinality integer everywhere**; bands only.
- *Closes:* exact‑cardinality, value‑list, missingness, and binary‑partition schema leaks.

### S6 — `renumberTokens()` (kill the index/order side channel)
- At the chokepoint, just before `buildSpecMessage`, remap **all** `col_/val_/lit_` to a single **per‑message random contiguous permutation** (not a monotone counter).
- Randomize schema `val_` order independently of inline order.
- *Closes:* `lit_N` monotonicity/count side channel, inline↔schema positional correlation.
- **Note:** needs randomness. In app runtime use `crypto.getRandomValues`. (The workflow scripting sandbox forbids `Math.random`, but app code may use it; prefer `crypto`.)

---

## 4. `normalizeTr()` — the ONE canonical fold

Export from `tokens.ts`; used by the tokenizer, the gazetteer, the vocab lookup, **and every classify lookup**. **Never call plain `.toLowerCase()` anywhere in the pipeline.**

```
NFKC → NFD → strip \p{Mn}\p{Me} → re‑NFC → confusable‑skeleton
     → toLocaleLowerCase('tr') → fold {i, İ, I, ı} → 'i' for matching
     → NAME_SUFFIX strip → vowelDrop
```
CI must assert `İstanbul`, `izmir`, `IZMIR`, `Irmak` all map to one key.

---

## 5. Residual‑token decision table

`classifyToken(t, ctx) → SAFE | MASK | ASK | BLOCK`. **Fixed priority, first match wins.** BLOCK/MASK beat SAFE so a data‑shaped token can never be rescued by colliding with a vocab word. Default for an unknown **alphabetic** word is **MASK** (silent), not ASK — this closes the lowercase‑rare‑name footgun.

| Pri | Class | Condition (all lookups on `normalizeTr()` key) |
|---|---|---|
| 0 | **SAFE** | `t` matches `/^(col\|val\|lit)_\d+$/`; or pure punctuation/whitespace |
| 1 | **BLOCK** | S0 evasion flag; S1 blob flag; checksum‑valid PII slipping S3 (TCKN mod‑10, VKN, IBAN mod‑97, card Luhn, IPv4 octet, phone ≥10 digits, **any bare run ≥10 digits** after separator‑strip); email/URL shape escaping S3 |
| 2 | **MASK** (→ `val_N` if it canonicalizes to a dataset value, else new `lit_N`) | Title‑Case word not in vocab and not month/weekday/quarter (name/place/org); TR apostrophe‑suffix `\p{Lu}\p{Ll}+['’](nin\|nın\|den\|dan\|…)` (reuse `NAME_SUFFIX`); CAPS acronym ≥2 not in vocab; mixed letters+digits len ≥4 (`INV‑0007`,`34ABC123`); UUID/long‑hex/base64 ≥20; gazetteer hit (unambiguous); **any bare integer** (see number policy); **any unknown alphabetic word len ≥3** not in vocab/stopword/dataset |
| 3 | **SAFE** | `normalizeTr(t)` ∈ intent vocabulary **and** not also a dataset value (collision → DATA → tokenize); ∈ stopword allowlist; **integer 1..12 ONLY when bound to a calendar/rank keyword** (immediately follows `top/bottom/first/last/ilk/son/en` or `day/week/month/quarter/Q/gün/ay/çeyrek`); homograph‑name vocab subset (`May/Mark/Rose/Step/Sum/Deniz/Ay/Nisan`) SAFE **only** with a syntactic chart context (adjacent to a col token / period word / comparator), else MASK |
| 4 | **ASK** | catch‑all for genuinely ambiguous in‑dictionary‑but‑unknown words and surviving S0 foreign‑script — kept **rare** so the user isn't trained to reflexively click "It's safe" |

**Number policy (important).** `SAFE_INT_MAX` is **dropped**. A bare integer carries no chart meaning unless bound to a calendar/rank keyword, and a masked threshold round‑trips losslessly (`prompt.ts` already tells the model to copy a `lit_N` verbatim into a filter `value`; `limit` accepts the same). Therefore:
- bare `/^\d+$/` → **MASK to `lit_N`** by default (covers ages, headcounts, coded 0/1, scores, thresholds, top‑N).
- **SAFE only** when 1..12 **and** immediately after a calendar/rank keyword. Even `top N` may MASK `N`→`lit_N` (`limit:"lit_N"`) at zero accuracy cost.
- *Closes:* `older than 18`, `score is 7`, `top 7`, `compare 1 vs 0` (coded sex), `group by 12`.

**Sentence‑initial:** lowercase the first token of each sentence before the Title‑Case test (so `Show`/`Göster` don't over‑fire), but the folded opener still routes through the unknown‑word **MASK** default — never SAFE. So a name placed first (`acme revenue trend`) is still masked.

---

## 6. BLOCK detector catalog

Add to `redactLiterals`, run **early**, checksum‑gated (so silent, no ASK). Validate on the `[\s.\-_/]`‑collapsed copy; mask on original offsets.

| Detector | Pattern (post‑collapse) | Validator |
|---|---|---|
| TR **TCKN** | `(?<!\d)[1-9]\d{10}(?!\d)` | mod‑10 pair (d10,d11), d1≠0 |
| TR **VKN** | `(?<!\d)\d{10}(?!\d)` | VKN checksum |
| **IBAN** | `\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4})+\b` | move first 4 → end, A=10..Z=35, bigint mod 97 == 1 (TR = 26 chars) |
| **Card** | `(?:\d[ -]?){13,19}` | Luhn |
| **Phone** TR/E.164 | `(?:\+?90\|0)?\s?5\d{2}[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}`; `\+\d{1,3}…` | ≥10 normalized digits |
| **Generic digit run** | `(?<!\d)\d{10,}(?!\d)` after collapse | ≥10 digits → BLOCK (catches phones failing the country regex) |
| **IPv4** | `(?:(?:25[0-5]\|2[0-4]\d\|1?\d?\d)\.){3}…` | each octet 0–255 |
| **IPv6/MAC** | `::` hex form / `(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}` | structural |
| **Email/URL** | existing (tokens.ts) | bound TLD 2–24 |
| **Numeric date** | `\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b` | month 1–12 / day 1–31 |

---

## 7. Allowlist / vocabulary / gazetteer (`src/vocab.ts`, new)

The **SAFE set** — closed, hand‑auditable, PII‑free, ~900 entries, one flat file.
- **EN stopwords** ~180 (NLTK), **TR stopwords** ~340 (stopwords‑iso/zemberek).
- **Intent vocab** EN ~150–220 + TR ~150–220, in 6 buckets mirroring `prompt.ts` enums:
  1. **action verbs:** show/plot/compare/group/rank/count + göster/çiz/karşılaştır/grupla/sırala/say
  2. **connectors:** by/per/over/across/between/since/vs + göre/başına/üzerinde/arasında
  3. **aggregations:** total/sum/avg/count/min/max/top/bottom/median/ratio/percent + toplam/ortalama/sayı/en/oran/yüzde
  4. **chart+display:** line/bar/area/pie/scatter/donut/rose/stacked/horizontal/step (exact enums) + çizgi/çubuk/alan/pasta/halka/yatay/yığılmış/basamak
  5. **time/calendar:** day/week/month/quarter/year + 12 months + 3‑letter abbrevs + 7 weekdays + Q1–Q4 + first/second/third/fourth/last — **seed from `guardrails.ts` MONTHS/MON_ABBR/WEEKDAYS/ORD_Q and `data.ts` AYLAR**
  6. **comparators:** over/under/above/below/more/less/each/every/all/only/except/including + üzeri/altı/fazla/az/her/tüm/hariç/dahil
- A curated **homograph‑name subset** (`May/Mark/Rose/Step/Sum/Deniz/Ay/Nisan/…`) tagged so rule‑3 context‑gates it.

**Name gazetteer** (recall engine, lazy‑loaded, ~50–150k entries, ~300KB–1MB gz, compact trie, keyed on `normalizeTr`): top ~5k EN+TR given/surnames, 81 TR il + ~970 ilçe + major world cities/countries, org/brand **suffix** patterns (A.Ş., Ltd, Şti, Inc, GmbH, Bank, Üniversitesi, Hastanesi). Unambiguous hit → MASK silently; a name that's also a common word needs a second signal (cap/apostrophe) or routes per rule‑3.

**No transformer in the critical path** (65–270MB, weak TR casing, non‑auditable). An optional sub‑1MB char‑level name‑likelihood classifier may later **promote** ASK→MASK only — never demote a BLOCK, never gate the send.

**Dataset‑risk gate** (local, pre‑send): if the smallest categorical column's cardinality is below `k` (e.g. <5), warn/disable — for tiny populations even fully‑tokenized structure re‑identifies (§12).

---

## 8. Integration — file by file

### `src/types.ts`
```ts
export type Risk = 'block' | 'ask'
export interface Flag {
  id: string                 // `flag_${i}` — stable React key + resolution map key
  token: string              // residual text, e.g. "Ahmet"
  span: [number, number]     // char offsets INTO the final safePrompt
  risk: Risk
  kind: 'phone'|'iban'|'tckn'|'vkn'|'card'|'ip'|'mac'|'blob'|'evasion'
        |'capitalized'|'rawNumber'|'longWord'|'foreignScript'
  suggestion: string         // proposed lit_N if redacted
}
export interface ScanResult { safePrompt: string; flags: Flag[] }
// add to ChartRequest + GenerateRequest:
resolutions?: Record<string, 'redact' | 'safe'>
```

### `src/gate.ts` (new)
`normalize`, `blobGuard`, `scan`, `classifyToken`, `applyResolutions`, `renumberTokens`, `gateSchema`.

### `src/ai.ts` — `deidentify()` becomes the single chokepoint
```ts
export function deidentify(prompt, rows, lang, resolutions = {}) {
  const summary = summarizeData(rows)
  const { summary: schema, toReal } = buildTokens(summary, rows)
  const { display, key, blockEvasion } = normalize(prompt)                  // S0
  if (blobGuard(key)) { /* push block flag */ }                            // S1
  const tokenized = redactLiterals(tokenizeText(display, toReal), toReal)   // S2→S3
  let { safePrompt, flags } = scan(tokenized, toReal, rows, lang)          // S4 (+S0/S1 flags)
  const resolved = applyResolutions(safePrompt, flags, resolutions, toReal) // 'redact'→splice
  const gatedSchema = gateSchema(schema, resolved.safePrompt)              // S5
  const { safePrompt: finalPrompt, schema: finalSchema, toReal: finalMap }
      = renumberTokens(resolved.safePrompt, gatedSchema, toReal)           // S6
  const open = resolved.flags.filter(f =>
      f.risk === 'block' || (f.risk === 'ask' && resolutions[f.id] == null))
  return {
    schema: finalSchema, toReal: finalMap, safePrompt: finalPrompt, flags: resolved.flags,
    blocked: open.length > 0,
    message: open.length ? null : buildSpecMessage(finalPrompt, finalSchema),
  }
}
```
- `generateOption()` (ai.ts): if `message === null` → return `{status:'failed', error:'PROMPT_HELD', raw:'', sent:[]}` **before** any `claudeComplete` (defense in depth even if App is bypassed).
- The **repair loop** re‑tokenizations (`safeRaw`/`safeError`) must route through the **same scan**; drop any `block` residue to `[held]`, never re‑ask.

### `src/service.ts`
Thread `resolutions` through `ChartRequest → generateOption`'s internal `deidentify`.

### `src/prompt.ts`
`profileLines` becomes driven by `gateSchema` per §3 S5 (no `c.values.join`, no raw cardinality int, conditional `nullCount`).

### `src/App.tsx`
- New state: `flags: Flag[]`, `resolutions: Record<string,'redact'|'safe'>`, `blocked: boolean`.
- The **preview `useMemo`** calls `deidentify(trimmed, active.rows, lang, resolutions)` each keystroke (pure/cheap) and renders `safePrompt` with flagged spans wrapped.
- `run()` guard after the empty check:
```ts
const gate = deidentify(trimmed, active.rows, lang, resolutions)
const openAsk = gate.flags.filter(f => f.risk === 'ask' && resolutions[f.id] == null)
if (gate.blocked)   { setStatus('idle'); message.error(t.blockedPII);   return }
if (openAsk.length) { setStatus('idle'); message.warning(t.resolveFirst); return }
result = await chartService.getChart({ source: datasetId, prompt: trimmed, resolutions })
```

### `src/i18n.ts`
Drop *"Other free text … is sent as written."* New line (EN/TR): *"Only opaque placeholders for your data and recognised chart words are sent; anything else is held for your review. The map back to your real values never leaves this device."* / *"Yalnızca verileriniz için yer tutucular ve tanınan grafik kelimeleri gönderilir; gerisi gönderilmeden önce incelemeniz için tutulur. Gerçek değerlerinizin eşlemesi bu cihazdan çıkmaz."* Add: `blockedPII`, `resolveFirst`, `redact`, `itsSafe`, `askHint` ("This looks like data — redact it?" / "Bu veri gibi görünüyor — gizlensin mi?"), `blockBanner`.

---

## 9. Gate UX

- **Block** → Ant `Alert type="error"` above Generate: *"This looks like {kind} (phone / national ID / pasted data). Remove it to continue — your data never leaves this device."* `Generate disabled={blocked}`.
- **Ask** → split `safePrompt` at spans; flagged text in `<Typography.Text mark>` (gold = ask, red underline = block) with an inline **Popover: [Redact] / [It's safe]**. Chips default **UNRESOLVED** — the user must choose. `Generate disabled={blocked || openAsk.length > 0}`.
- The existing **"Sent to the AI" preview** now highlights every flagged token, so the user sees exactly what would leave.

---

## 10. Guarantee (honest) + irreducible residual risks

**What it provides (verifiable):**
1. **Completeness over a defined safe set** — nothing leaves but local placeholders + ~900 audited vocab words. Enforced by a CI subset test.
2. **Fail‑closed default** — anything unrecognized is held; if in doubt, nothing sends. 100% recall by construction.
3. **Local key custody** — `toReal` never leaves the browser.
4. **Standards framing** — GDPR on‑device **pseudonymization + data minimization**; HIPAA‑Safe‑Harbor‑style categorical stripping with the 18th "any other unique code" catch‑all closed by all‑listing. **Not** anonymization, k‑anonymity, or differential privacy (numbers are computed locally and never sent, so there's no aggregate release to noise).

**What it cannot eliminate (state plainly):**
- **Schema/cardinality inference (singling‑out).** A small column's existence and the count of disclosed values leak structure. Banding/suppression (S5) reduces, not removes. The **dataset‑risk k‑gate** warns for k<5 but can't make a 7‑clinic dataset safe.
- **Prompt‑structure co‑occurrence.** `trend of col_3 for val_7 in lit_2` reveals an entity is correlated with a metric at a time — opaque, not zero‑information.
- **Count of distinct entities named.** Filtering to 3 entities means the user named 3 — unhideable. Renumbering removes index/order, not count.
- **Binary sensitive partition.** A pie over a 2‑value column reveals a binary split even with opaque tokens; the **chart‑type choice itself** is a side channel. S5 emits only `(categorical)` for cardinality ≤4, but this case is explicitly **excluded from "safe."**
- **Allowlist–homograph collision.** A real name equal to a vocab word is context‑gated, not perfectly resolved; if it also matches a dataset value it tokenizes (collision→DATA).
- **Inference ≠ disclosure.** The guarantee is "no verbatim sensitive value crosses," not "zero information" — the latter is impossible while still producing a useful chart.

---

## 11. Red‑team findings (17 breaks — all folded into v2 above)
Smuggling: combining‑accent (`á`), Cyrillic/Greek homoglyphs (`Bursа`), zero‑width split (`Ac​me`), mixed‑script, emoji/tag chars. Structured: single‑line CSV, 80‑name comma list, JSON paste. Tokenizer gaps: `Acme  Corp` (double space), `İzmir/IZMIR/Irmak` casing, multi‑word org partials. Numbers: `older than 18`, `score is 7`, `top 7`, coded `1 vs 0`, `group by 12` (the dropped `SAFE_INT_MAX`). Checksum evasion: spaced/split IBAN/phone/card. Inference: exact cardinality, value‑token list, `nullCount` missingness, binary partition, `lit_N` monotonicity/count, inline↔schema order correlation. Each maps to a stage S0–S6 fix or a decision‑table rule.

---

## 12. CI invariants (turn the guarantee into tests)
1. Every outbound word is `/^(col|val|lit)_\d+$/` **or** ∈ SAFE vocab (subset test over a corpus).
2. No real dataset value ever leaves as `lit_N` (must be its `val_N`).
3. No outbound message has a per‑value token list, a raw cardinality integer, > K `val_N` per column, or `, some missing` without a missingness‑intent token.
4. Token indices are a random permutation, not a monotone counter.
5. `İstanbul/izmir/IZMIR/Irmak` → one key; `ácme`/`Bursа`(Cyrillic)/`Ac​me`(ZWSP) all tokenize or block.
6. Adversarial corpus (confusables, zero‑width, spaced phone/card/IBAN, lowercase names, coded ints, single‑line CSV) → expected BLOCK/MASK; a 50‑prompt realistic EN+TR corpus → **~0 ASK** (friction regression).

---

## 13. ⚠️ URGENT, out of band (not gate logic)
`src/App.tsx` holds a comment string shaped like a **live `sk-ant-api03-…` Anthropic key**, and `ai.ts` sets `anthropic-dangerous-direct-browser-access`. If that string is a **real** key: **rotate it, purge it from git history (`git filter-repo`/BFG), and route through `VITE_LLM_PROXY`** so the browser never holds a key. A leaked key dwarfs every residual in this plan. *(Note: this comment was intentionally kept earlier; verify whether it's real or a decoy before acting.)*

---

## 14. Staged build plan (recommended order)
1. **Key rotation + proxy** (App.tsx comment, `ai.ts`, git history) — out of band, highest impact, blocks nothing else. *(Only if the key is real.)*
2. **`normalizeTr()`** in `tokens.ts` + FIX A–D in `tokenizeText` + CI #5 — the canonicalization everything depends on. No UI.
3. **`redactLiterals` BLOCK detectors** (§6) + separator‑collapse validation + CI adversarial subset — closes verbatim PII with zero UX.
4. **`src/vocab.ts`** allowlists (seed from `guardrails.ts`/`data.ts`) + CI subset test #1.
5. **`src/gate.ts` S0+S1+S4** `scan`/`classifyToken` (number policy, MASK‑default, `val_N` re‑check) + CI #2,#6.
6. **S5 `gateSchema`** in `prompt.ts` + CI #3 — closes the biggest residual (schema half), independent of UI.
7. **S6 `renumberTokens`** + CI #4.
8. **`ai.ts` chokepoint rewire** + repair‑loop gating + `generateOption` PROMPT_HELD.
9. **`App.tsx` gate UI** (spans, Popover, block banner) + `i18n.ts` + `service.ts`/`types.ts` resolution threading.
10. **Lazy gazetteer + trie** (last; promotes recall, not correctness) + optional async name classifier (promote‑only).
11. **Dataset‑risk k‑gate** + final friction‑regression corpus.

**Build 1–3 first** — they remove the catastrophic leaks (key, verbatim PII, canonicalization) before any UI exists. **6–7** close the schema/index side channels the current de‑id never touched.

---

## 15. Codebase orientation (for picking this up elsewhere)
Key files (all under `src/`):
- **`tokens.ts`** — `buildTokens`, `tokenizeText` (col/val matching + Turkish `NAME_SUFFIX`/`vowelDrop`), `redactLiterals` (the literal regexes: `EMAIL/URL/ISO_DATE/GROUPED_NUMBER/SEPARATED_DIGITS/DECIMAL/LONG_NUMBER`), `detokenizeSpec`, `coerceLiteral`, `UWORD`. **This is where S0/S2/S3/normalizeTr live.**
- **`ai.ts`** — `deidentify` (the chokepoint), `generateOption` (the repair loop), `claudeComplete`, `CLAUDE_MODEL` (currently `claude-sonnet-4-6`), `llmProxyUrl`/`VITE_LLM_PROXY`.
- **`prompt.ts`** — `SYSTEM_PROMPT`, `buildSpecMessage`, `profileLines` (the schema half → S5), `CHART_SPEC_SCHEMA`.
- **`data.ts`** — datasets incl. the Turkish `eticaret`/`satış`; `summarizeData`.
- **`App.tsx`** — the UI (TR/EN toggle, dataset select, prompt input, "Sent to the AI" preview, `ChartStage`); the `run()` flow.
- **`i18n.ts`** — EN/TR strings. **`service.ts`** — `chartService.getChart`. **`types.ts`** — DTOs.
- Tests: `tests/*.test.ts` (node `--experimental-strip-types`), `vitest/*` (DOM + live). The **value‑audit** (`vitest/audit.live.test.ts`, gated by `RUN_LIVE_API=1` + a key or `VITE_LLM_PROXY`) is the correctness watchdog — keep it green.

Run: `npm test` (offline). Live: source `.env`, `RUN_LIVE_API=1 … npx vitest run vitest/<file>`. The CLI proxy (`scripts/cli-proxy.mjs`) routes through a Claude subscription when `VITE_LLM_PROXY` is set.

---

## 16. Open knobs / decisions to revisit during build
- **Vocabulary size** vs friction (the dial). Start ~900; tune against the 50‑prompt corpus to ~0 ASK.
- **`top N` integer:** SAFE (friction concession) vs always MASK→`lit_N` (purer). Default to MASK; the model handles `limit:"lit_N"`.
- **Gazetteer size/recall** vs bundle weight (~300KB–1MB gz). Lazy‑load.
- **k‑threshold** for the dataset‑risk gate (default <5).
- Whether the optional char‑level name classifier is worth shipping (promote‑only).
