# The AI layer

Everything that calls a language / vision / speech model goes through ONE server-side module, `src/lib/ai/`. Features never talk to a provider directly, never see a key, and always have a no-AI fallback: with every key removed the app behaves exactly as it did before AI existed.

```
feature (route handler)          src/lib/ai                           providers
────────────────────────         ───────────────────────────────      ─────────────────────────
guardAi()  auth + membership ─▶  chat() / chatJson() / chatEach()  ─▶ Gemini   (REST generateContent)
                                  │  chain = providers × models       Groq     (OpenAI-compatible, Whisper)
                                  │  × keys, cooldown-aware           OpenRouter (free models, last resort)
cachedAi()  answer cache     ◀──  health.ts: circuit breaker +
recordAiEvent()  counters         key rotation, per instance
```

## Configuration (server environment only)

| Variable | Meaning |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_API_KEY_2` … `_9`, `GEMINI_API_KEYS=a,b` | Google AI Studio keys. Several keys are rotated and are spares for each other (Google's free quota is per *project*, Groq's per *organisation*: extra keys of the same project add resilience against a revoked key, not quota). |
| `GROQ_API_KEY` (same `_2…`/`_KEYS` forms) | Groq: fast text/JSON/tools, vision (Qwen), Whisper speech-to-text. |
| `OPENROUTER_API_KEY` (same forms) | OpenRouter. A free key reaches only `:free` models, 50 requests a day: it is the last resort. |
| `AI_ENABLED=false` | Switches every AI call off (the app runs on its rules). |
| `AI_FEATURES_OFF=brief,trend,voice` | Switches single features off by task-name prefix (`brief`, `trend`, `medicine`, `vision_bp`, `vision_weight`, `vision_meal`, `vision_medicine`, `food_parse`, `food_estimate`, `voice_log`, `transcribe`, `soie`). |
| `AI_PRIVACY=balanced\|strict\|performance` | Where health data may go. `balanced` (default): providers that do not train on content come first, the others stay as fallbacks; identifying content (prescriptions, lab reports) only goes to non-training providers. `strict`: health and identifying content never reach a provider that may train on it. `performance`: ignore sensitivity. |
| `GEMINI_PLAN=paid`, `OPENROUTER_PLAN=paid` | Tells the router that the key's plan does not allow training on your content (enable billing on the Google project first). Groq is treated as non-training by default. |
| `AI_PROVIDER_ORDER` | Default `gemini,groq,openrouter`. |
| `AI_RATE_LIMIT_PER_HOUR` / `AI_PATIENT_DAILY_LIMIT` / `AI_GLOBAL_DAILY_LIMIT` | Model-calling requests per signed-in user per hour (default 120), per patient per day (400; background prose such as the daily brief is refused at 60 % so photos and voice keep a reserve) and for the whole deployment per day (2,000; scheduled e-mail work may use the last 20 %). Cache hits are free. |
| `AI_BRIEF_MAX_PER_DAY`, `AI_TREND_MAX_PER_DAY` | New daily-brief wordings (default 14) and new trend notes (default 20) written per patient per IST day. A cached wording is always served; over the cap the page shows the rules text. |
| `AI_TIMEOUT_MS` | Default whole-call budget (5 000 – 110 000, default 30 000). |
| `GROQ_MAX_INPUT_TOKENS` | Prompts bigger than this skip Groq (default 6,000: the free tier allows about 8,000 tokens a minute). |
| `GEMINI_MODELS_FAST` / `_SMART` / `_SEARCH`, `GROQ_MODELS_FAST` / `_SMART` / `_VISION`, `GROQ_STT_MODEL`, `OPENROUTER_MODELS` / `_VISION` | Comma-separated model ids, best first. Defaults are in `src/lib/ai/config.ts`. |

Keys never leave the server: no `NEXT_PUBLIC_` prefix, never logged, never in an error message (only an 8-character fingerprint appears in diagnostics). `anthropic/*`, `claude*` and `openrouter/*` auto-router model ids are refused by `config.ts` (owner decision: no Claude in the app's own features, also not through OpenRouter).

On Vercel add the same variables for Production **and** Preview, then Redeploy and Promote.

## How a call is routed

1. A feature asks for a capability: text, JSON (schema), tools, vision, audio; a tier (`fast` or `smart`); optionally `webSearch`.
2. The router builds a chain: the providers the request's sensitivity allows (privacy order), their models for the capability and tier interleaved by rank (so one slow provider cannot eat the budget), OpenRouter last, and providers whose context limit the prompt exceeds left out (Groq vision calls use their vision list; web search puts the search-capable Gemma models first).
3. It skips models that are cooling down, rotates through a provider's keys and calls the first candidate. An answer that is not valid JSON for the schema counts as a failed attempt (`chatJson`).
4. A failure sets the right cooldown so the next request does not pay for it again:

| Failure | Cooldown |
|---|---|
| 429 quota | what the provider asked for (`Retry-After`, `retryDelay`, "try again in 7s"), else 60 s doubling to 15 min; per-day quotas 1 h; scoped to key + model |
| 503 / 5xx / timeout / network | 20 s doubling to 5 min; scoped to the model |
| 404 (model retired) | 6 h; model |
| 401 / 403 / invalid key | 30 min; key |
| 400, safety block, empty or invalid output | none (the request/content is the problem) |

5. Transient failures get one more pass (fail-open, after a short pause). If nothing answers, `AiError` is thrown and the feature uses its rules.

The cooldown book lives in memory per server instance (Vercel instances are short-lived; a persistent breaker would add a database read to every call).

### Provider facts that shaped this (verified live with free-tier keys, 2026-10-14)

- Gemini 3.x flash models often answer 503 "high demand": the chain always has several; `gemini-2.5-*` are retired (404) for new keys; Pro models have no free quota (429).
- Gemini 3 models answer 400 for a replayed function call without a `thoughtSignature`; calls that came from another provider get Google's documented dummy signature. The raw parts of a Gemini turn travel as `ProviderState` and are replayed only to the same model.
- Google Search grounding returned 429 for every `gemini-*` model on a free key, but the Gemma 4 models served by the same API accept it, and also together with function calling when `toolConfig.includeServerSideToolInvocations` is set.
- Groq `openai/gpt-oss-120b` supports tools and `json_schema`; `qwen/qwen3.8-27b` reads images (a BP display in ~0.4 s); `whisper-large-v3-turbo` transcribes Hindi in ~0.3 s but **hallucinates text on silence**: clips must be checked for speech before they are sent and the transcript treated as a suggestion.
- OpenRouter's `openrouter/free` auto-router may send a request to a safety classifier: never use it; `:free` models are often 429 upstream.

## What uses it

| Feature | Route / entry | Task name (`AI_FEATURES_OFF`) | Consent | Falls back to |
|---|---|---|---|---|
| BP / weight display photo | `POST /api/vision/read` | `vision_bp`, `vision_weight` | media (`photos`) | the on-phone reader, then typing |
| Spoken or typed log ("बोलकर दर्ज करें") | `POST /api/ai/transcribe` (audio), `POST /api/ai/voice-log` (phrases the browser rules could not read) | `transcribe`, `voice_log` | media for audio, text for phrases | browser Web Speech + the rules parser, then typing |
| Meal sentence | `POST /api/ai/food/parse` (only the pieces the rules could not place) | `food_parse` | text | the rules grammar and catalogue search |
| Daily update ("आज का हाल") | `POST /api/ai/brief` | `brief` | text | the fixed, rule-built summary |
| Trend notes, weekly / monthly / yearly / doctor visit | `POST /api/ai/trends` | `trend` | text | the numeric report without a note |
| Medicine pattern note | `POST /api/ai/medicine-note` | `medicine` | text | the pattern card's own sentence |
| Meal / thali photo | `POST /api/vision/read` kind `meal` (dish names only; mapping to the catalogue happens on the phone) | `vision_meal` | media (`photos`) | the phone's own food model, learned plates, search |
| Medicine strip / box / prescription photo | `POST /api/vision/read` kind `medicine` (content is "identifying": only providers that do not train on it, unless `AI_PRIVACY=performance`) | `vision_medicine` | media (`photos`) | the typed / pasted-text prescription parser |
| Cron e-mails (daily / weekly / monthly / 2 PM reminder) | cron routes; scheduled slot with `user_id` NULL, 8 s box per step | `brief`, `trend`, `medicine` | text | the plain mail, byte for byte |
| Caregiver handover text | reuses `POST /api/ai/brief` only to read the family headline when the share dialog opens | `brief` | text | the rules text |
| Ask (SOIE) | `POST /api/soie` | `soie` | text | the rules engine, with a visible notice |
| Admin status / "check now" | `GET`/`POST /api/ai/status` | none | admin | n/a |

The meal sentence, the voice log and Ask never forward emergency wording (chest pain, not breathing, stroke signs, fainting ...) to a model: the browser and the routes answer with the fixed emergency card, and every meal phrase is sent with `sensitivity: health`.

Every route authenticates first, reads a size-capped body, reserves one budget slot atomically and settles it on every exit; none logs a prompt, an answer or a value. Expected non-errors (consent off, quota, provider down) answer `200 {status:"unavailable", reason}` on the text features so the page stays silent; the photo and audio routes answer `403 ai_photos_unasked | ai_photos_off` / `429` so the client can ask or wait.

## Consent (per patient)

`patient_ai_settings` holds two switches, read and changed only through `/api/ai/settings` (any member reads, owner/editor changes):

| Switch | Meaning | Default |
|---|---|---|
| `photos` | a photo or a short voice recording may be sent to an AI service to be read (the "media" switch) | `NULL` = never asked: the first photo or mic tap asks; nothing is sent until the family says yes |
| `text_ai` | de-identified figures and questions may be sent for summaries, trend notes and the assistant | `NULL` = never asked: nothing is sent until the family says yes |

Every photo route refuses (403 `ai_photos_unasked` / `ai_photos_off`) and every text feature skips the model (`consent_off`) when its switch is off; the app then behaves exactly as it did before AI existed.

## Photo reader (`POST /api/vision/read`)

The model only transcribes (digits, names, counts). `src/lib/vision/ai-normalize.ts` turns the transcription into values: ranges, a number must also appear in the text the model says it read, lb/stone to kg, kitchen scales and error/memory displays refused with a reason code. `src/lib/vision/consensus.ts` reconciles the on-device reader with one or two AI providers field by field (`agreed` / `majority` / `single` / `conflict` / `missing`); the dialog prefills only what is agreed (or single and not in the crisis range) and the person confirms every value.

Measured on real photos (Wikimedia CC, 21 images incl. blank/error/food negatives): `gemini-3.5-flash-lite` read all 6 real Omron displays exactly and refused every negative; `qwen/qwen3.8-27b` on Groq agreed. Groq's free vision model allows about three photos a minute (7,000 input tokens), so it is the second opinion, not the primary. Run `npm run vision:ai-eval -- --manifest <file> --pace groq=22000` on your own photos.

## Model-written text (`src/lib/ai/narrative.ts`)

Daily brief, trend notes, doctor-visit synopsis and adherence coaching share one engine: code builds facts (`id`, label, display value); the model writes JSON that uses `{{fact_id}}` placeholders and never a digit; `narrative-verify.ts` (clause-scoped negation guards; a figure must sit in the clause that is about it) rejects unknown ids, bare numbers (Latin or Devanagari), dose instructions, diagnoses, guarantees, "no need for a doctor", reassurance beside an alert, claims of cause, and (doctor-facing) evaluative words; a rejected answer gets one repair turn from the same writer; the verified answer is cached under a key made of the facts, and a recent failure is remembered for five minutes so a down provider is not hammered by page views.

## What is stored

Two server-only tables (created on first use, also in `db/mysql/schema.sql`; **never** exposed through the `/api/db` gateway, so a browser can neither read nor forge them):

- `ai_cache`: model answers keyed by `sha256(kind | patient | prompt version | hash of the input facts)`. New data means a new key, so it invalidates itself; entries expire and cascade away with the patient.
- `ai_events`: one counter row per request (task, status, provider, model, latency, token counts). No prompt, answer, photo or health value. It is the **budget ledger** (below): its rows outlive the patient and the account.
- `patient_ai_settings` (the consent switches) is the patient's own data and goes with the patient.

### Budget under parallel requests

Every model-calling request takes one slot before the model is called (`reserveAiSlot`, `src/lib/ai/usage.ts`): a single `INSERT ... SELECT` counts the three caps (per user per hour, per patient per day, whole deployment per day) and inserts the `pending` row in one statement, so a burst cannot all pass a stale count.

That statement counts the table it inserts into, so parallel runs take locks on the same index range and InnoDB resolves the cycle by rolling one back (error 1213 "deadlock", or 1205 "lock wait timeout"). A victim is rolled back whole, so running it again re-reads the counts and is correct:

1. The statement alone is retried up to 5 times with a small random back-off (5 to ~100 ms, 1.5 s in total at most). Nothing else is retried.
2. If the contention outlasts the retries (heavy bursts of well over 50 parallel requests) the caps are still checked, with plain reads, and a counted `pending` row is inserted; this path is not atomic, so it queues its own requests inside the process, and a burst of 100 to 200 parallel requests exactly at a cap was measured to overshoot by 1 or 2 slots (never by the burst size). `reserveDiagnostics` counts both (`lockRetries`, `degraded`).
3. Only when the database cannot answer at all (down, table missing, any other error) does the old fallback stand in: an in-process bucket of 30 reservations per user per minute per server instance, "fail open" (`0`), settled by a plain `recordAiEvent` afterwards.

Measured on MySQL 9.3 with the default 5-connection pool: 40 parallel reservations with a limit of 5 granted exactly 5 in 30 of 30 rounds (none through the fail-open path, slowest burst 100 ms); before the retry, 23 of 40 went through the fail-open path. `npm run ai:db-test` keeps this as a regression.

### Budget ledger (`ai_events` keys are `ON DELETE SET NULL`)

The caps are counts over `ai_events`. If its keys cascaded, deleting a patient (an owner may, at will) or an account would erase the counts and reset every cap: create a patient, use the quota, delete the patient, repeat. Both keys are therefore `ON DELETE SET NULL`: the rows stay (ids and counters only, no link left to the patient or the person) and the existing 30-day purge keeps the table small. `ai_cache` and `patient_ai_settings` keep `ON DELETE CASCADE`: they hold the patient's own data and must go with the patient.

A database created from an earlier copy of `schema.sql` has the `CASCADE` keys, and `CREATE TABLE IF NOT EXISTS` does not alter them. They are switched automatically, once per process, the first time the table is used (5 s lock wait; if the account may not ALTER, the request is not affected and one line is logged), and by `npm run db:migrate`. To do it by hand with an account that may alter tables:

```sql
SELECT constraint_name, delete_rule FROM information_schema.referential_constraints
 WHERE constraint_schema = DATABASE() AND table_name = 'ai_events';   -- both should say SET NULL

ALTER TABLE ai_events
  DROP FOREIGN KEY fk_ai_events_patient,
  ADD CONSTRAINT fk_ai_events_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE SET NULL,
  DROP FOREIGN KEY fk_ai_events_user,
  ADD CONSTRAINT fk_ai_events_user FOREIGN KEY (user_id) REFERENCES auth_users (id) ON DELETE SET NULL;
```

If the server refuses to drop and add one constraint name in one statement, run it as two `ALTER TABLE ai_events DROP FOREIGN KEY ...` statements and then two `ALTER TABLE ai_events ADD CONSTRAINT ...` statements.

## Privacy rules every AI feature follows

- The app never puts the patient's or caregivers' names, e-mail addresses or phone numbers into a request from its own records. Inside free text written by people (a question, a transcript, a meal phrase) they are removed where they can be recognised (`privacy.ts`: stored spelling, the other script by a phonetic key, honorifics, contact patterns; BEST EFFORT, so the interface asks people not to type them). Free text is length-capped and treated as data, not instructions. Medicine names are masked on the server for voice logs (stored list + dictionary).
- Numbers come from code: the model words and selects, code computes, formats, verifies and cites (the SOIE rule, now shared).
- Photos are re-encoded in the browser (EXIF/GPS stripped), validated by magic bytes on the server and never stored.
- A free-tier provider may use submitted content to improve its products. That is a disclosure and consent matter, shown to the family before a photo is first sent (see the photo-recognition doc).

## Testing

```
npm run ai:eval        # pure + fake-provider cases (router, adapters, vision, brief, trends, medicine, food, voice, consent, SOIE): no network, no keys
npm run soie:eval      # the SOIE rules / verifier / agent-loop suite
npm run food:eval      # the meal grammar corpus: wrong-topic must be 0
npm run ai:db-test     # real MySQL (a *_test database) + fake providers: consent, photo route, cache, usage, parallel budget bursts, the budget ledger and its upgrade, narrative engine
npm run ai:brief-test | ai:trend-test | ai:consent-test | ai:medicine-test | ai:food-test | ai:voice-test | soie:db-test
npm run ai:live        # real providers with the keys in .env.local: text, JSON, vision, Whisper, search+tools, consensus
npm run ai:live -- --image bp-photo.jpg
```

The DB suites drop tables of their `TEST_DATABASE_URL` database (the name must contain `test`); run them one at a time (the voice and brief suites derive their own `_voice_test` / `_brief_test` databases).

`/api/ai/status` (any signed-in user: `{available}`; admins also get providers, models, key counts, what is cooling down and the last day's usage).

## Adding an AI feature

1. Build the facts in code (numbers formatted by code, no names). Hash them.
2. Call `chatJson({ task, needs, tier, system, messages, json: { name, schema } }, semanticCheck)` from a route handler after `guardAi(request, { patientId, task })`. Use `cachedAi` for anything that depends only on stored data.
3. Verify the output in code (numbers/dates/ids appear in the facts, no forbidden content). Reject, repair once, then fall back to the rules text.
4. `recordAiEvent` with the outcome; return `Cache-Control: no-store`.
5. Add cases to `src/lib/ai/eval/` using the fake provider.
