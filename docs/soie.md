# SOIE: the SwasthTrack assistant

SOIE answers questions about ONE patient from ALL of that patient's logged data and, for diet / lifestyle / health problems, gives practical guidance that rests on a **curated, checked list of WHO / NHS / NHLBI pages** (and, on the tool channel, on a web search where a provider offers one). Its design rule: **numbers come from code, never from the model.** A language model reads and words; code plans the evidence, computes, cites and verifies.

UI: `/ask` · API: `POST /api/soie` · admin diagnostics: `/simulation-lab` · code: `src/services/soie/`

## What it does, step by step

```
browser ──(session cookie, SSE)──▶ POST /api/soie
   1. requireUser, size-capped body, requirePatientAccess(read)   (the access rules do the real scoping)
   2. validate (1-1000 chars, control chars stripped) + hourly rate limit (counts soie_events)
   3. loadPatientContext  ── user-scoped database client, 120 IST days, paged past 1000 rows
   4. fact ledger         ── ~350 facts, every one with window + n (pure code)
   5. safety gate         ── emergency? crisis reading? medicine/diagnosis request? injection?
   6a. emergency          ── fixed answer (112/108, FAST, last BP). NO model, NO consent lookup, NO budget slot
   6b. rules              ── AI not configured / switched off (AI_FEATURES_OFF=soie), or the family has not agreed,
                             or the day's budget is used up: the deterministic engine answers + a visible notice
   6c. a model would be called ── the order is always:
         consent  patient_ai_settings.text must be true            (else notice ai_consent_unasked / ai_consent_off)
         budget   reserveAiSlot() atomically; settled once         (else notice ai_quota)
         names    patient, caregivers, signed-in user -> the redactor
         JSON channel (default)  plan -> prefetch -> evidence pack -> ONE structured call -> verify -> <=2 repairs
         tool channel            the model reads the data with tools (and searches the web where it can)
   6d. failure            ── outage / refusal / verification failed: rules engine + visible notice
   7. finalize            ── crisis reading forced to the top, evidence resolved from the ORIGINAL context, notices
   8. persist             ── soie_sessions / soie_messages (+answer) / soie_events (counters only), ai_events slot settled
```

### Which model answers

| Server configuration | Who answers | Channel |
|---|---|---|
| any of `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` (and `AI_ENABLED` not `false`) | the provider router (`src/lib/ai`): Gemini, Groq, OpenRouter, privacy order, cooldowns, key rotation | `json` (default) or `SOIE_CHANNEL=tools` |
| none of the above, or `AI_FEATURES_OFF=soie` | the rules engine | no model |

There is no Claude / Anthropic path: the owner decided not to use Claude for the app's own features (the Anthropic runtime client and its `ANTHROPIC_API_KEY` / `SOIE_PROVIDER=anthropic` switch were removed). The message and tool types in `src/services/soie` keep the Anthropic *shape* because the agent loop was written against it; that is a type-only import.

### The one-call JSON channel (`plan.ts`, `json-agent.ts`)

The tool loop let a model wander: a 22,000-character overview, a metric that "looked interesting", five round trips. That is too big for a free tier (Groq: about 8,000 tokens a minute) and was where "answered about another measure" came from. Here code decides what the question is about:

1. **Plan** (`buildEvidencePlan`): the measures the question names (a named medicine means "medicine"; a follow-up with no measure inherits the previous turn's; a symptom shows the BP picture; "aaj ka hal" shows every measure today), the period (today / 7d / 14d / 30d / 90d, else the code-resolved dates), the ledger facts in priority order, guideline topics for advice. A period nobody can have data for (future, before the loaded history, "31/02") gets **no** window at all, never last week's data dressed up as the answer.
2. **Prefetch**: for dates that are not a standard window (`kal`, `1 se 4 Oct`, "what changed since last week") the matching `query_logs` / `compare_periods` / `get_medicine_adherence` / `get_nutrition_breakdown` calls run in code, compact (at most 14 rows), tagged `[tool:N]`.
3. **Pack** (`renderPack`): "EVIDENCE" = windows legend, the medicine block (with a dose ref to cite), prefetched results, facts as `id = value | n=count`, and for advice the GUIDELINES block (reserved first; at least one item always shown). What does not fit in the token budget is dropped from the END of the priority list.
4. **One call**: structured output (`json_schema`), no tools, no search; the router walks Gemini / Groq / OpenRouter until a reply parses and fits the schema.
5. **Verify**: the same verifier as the tool loop. A rejection returns as a plain user message (`formatViolations(.., "json")`); at most 2 repairs, then the rules engine.

The pack does not weaken the guarantee: the verifier backs every number by the fact id, record ref or tool tag the answer **cites**, resolved from the ledger and the prefetched results, never by what the model "read". A thinner prompt can only make the model quote less.

**Size.** The first request is held to about 5,000 estimated tokens by the router's own pessimistic formula (`characters / 2.2` plus the 2,048-token answer allowance; Hindi is token-hungry). The fixed part is the system prompt (~2,600 characters), the answer schema (~2,100) and the compact snapshot (0.7-1.4K); the pack gets what is left, never fewer than 1,300 characters. Measured on 6 patients x 10 typical questions: the pack is 230-1,300 characters (median 950; 1-24 facts, or 1-2 guideline items for advice) = about 100-590 estimated tokens, the whole request **4.5K-5.4K (median 5.1K)**, of which the real input is about 2.3K tokens. Groq's cut is 6,000 on the same estimate, so Groq serves it at its real free-tier limit. For comparison the tool loop's `get_overview(summary)` alone was 22,400 characters (~10K estimated tokens), the full overview 36,600 (~16.6K). The eval bounds every request at 5,500.

**What the model never gets**: the patient's or caregivers' names, e-mail addresses, phone numbers (a redactor over the question, earlier turns, saved notes, notes on readings, food names; `privacy.ts`), the medicines line of the full snapshot (the pack carries a medicine block with refs), the family's feedback comments, more than 5 saved notes of 160 characters.

### Modules (`src/services/soie/`)

| File | Role | Pure? |
|---|---|---|
| `types.ts` | Answer contract, context, ledger types | yes |
| `normalize.ts` | NFC / Devanagari folding, whole-token lexicons (Hindi, Hinglish, English), "did you mean" | yes |
| `temporal.ts` | IST date resolver: aaj/kal/parso, pichle N din, last week, is mahine, weekdays, 15 August, DD/MM, ISO, ranges; validates real dates | yes |
| `safety.ts` | Emergency detection, crisis readings, medicine-change / diagnosis / remember requests, prompt-injection hygiene, the fixed emergency answer | yes |
| `records.ts` | Raw rows → typed, ref-stamped records; expected-dose builder (schedule × days) | yes |
| `ledger.ts` | The analytics engine: stats per window, adherence, nutrition, completeness, flags, associations | yes |
| `evidence.ts` | Citation index (fact ids, record refs) and chip resolution | yes |
| `verify.ts` | The accuracy guarantee (below) | yes |
| `scope.ts` | What the question is ABOUT: small talk, not-tracked topics (sugar, cholesterol, labs), off-topic, advice (word-order free), medicine schedule vs adherence, medicine names (typo-tolerant), symptoms, saved-note lookups | yes |
| `fallback.ts` | Deterministic rule engine: scope gates → intents → ledger-rendered bilingual answers | yes |
| `answer.ts` | Final assembly, crisis lead, honest notices | yes |
| `prompt.ts`, `tools.ts` | Stable system prompts (tool channel, JSON channel), strict tool schemas, tool executors, the answer JSON schema | yes (`save_memory` via injected dep) |
| `plan.ts` | Evidence plan and pack: which measure, which period, which facts, within a token budget | yes |
| `guidelines.ts` | The curated, checked guideline list (13 WHO / NHS / NHLBI / ICMR-NIN pages), topic matching, figure snippets | yes |
| `medicine-guard.ts` | Instructions about a NAMED medicine (stop, skip, double, "take paracetamol", "add fish oil") in English, Hinglish, Devanagari | yes |
| `privacy.ts` | The redactor and the scrubbed copy of the context that is model-bound | yes |
| `agent.ts` | The tool loop over an injectable `LlmClient` | yes (no SDK values) |
| `json-agent.ts` | The one-call JSON channel over the same client interface | yes |
| `router-client.ts` | The router `LlmClient`: Anthropic-shaped turns to and from `src/lib/ai` (Gemini / Groq / OpenRouter), `json` mode, site-level search sources | server only |
| `engine.ts` | One turn end to end: emergency -> unavailable -> gate (consent, budget) -> agent -> finalize | yes |
| `accounting.ts` | How a finished turn settles its budget slot | yes |
| `context.ts`, `persist.ts`, `redaction-names.ts` | database IO (paging, sessions, events, the names to redact) | server only |
| `eval/` | Fixtures, 433 cases, scripted fake model, fake database | test only |

## The accuracy guarantee (`verify.ts`)

Before an AI answer reaches the user, code checks it. A failure is returned to the model as an `is_error` tool result with the exact offending items (max 2 repairs); after that the rules engine answers and says why.

- **Numbers.** Every number in the headline, both answers, key points and patient-data recommendations must appear in this turn's evidence (the snapshot, `get_overview` facts, or a tool result), allowing only documented rounding to 0/1/2 decimals. A number that exists somewhere in the data but is **not backed by anything the answer cites** (`fact_refs` / `numbers[].ref`) is rejected as `uncited_number`; a number found nowhere is `unsupported_number`. Derived values (difference, sum, ratio, percentage) are accepted only when declared in `numbers[]` and derivable from facts the answer cites.
- **Dates and times.** Calendar mentions must be real dates inside the loaded history; clock times must exist in the data.
- **Citations.** Every `fact_ref` must be a fact id, a record ref (`bp:2026-10-03T08:15`) or a `tool:N` tag from this turn.
- **Sources.** Every URL must be one of the app's curated guideline urls shown this turn, or have appeared in a `web_search` result this turn; `basis: "guideline"` needs one and the source must also be in `sources[]`. When the cited source is a curated item, a recommendation may repeat **only that item's figures** (a salt limit the model invented next to a real WHO link is `unsupported_number`; so are a number that merely occurs in the snapshot and an everyday "30 minutes"); the item's own title and publisher replace whatever the model wrote. A search source whose text the code cannot read keeps the older rule (the verified link is the accountability). Gemini's grounding returns a redirect link plus the site's name: the router client marks such results `site_only` and the verifier accepts a cited page **on that host**, and only that host.
- **Forbidden content.** Start/stop/change-dose advice (generic nouns), doses that are not the patient's recorded ones, definitive diagnoses, guarantees/cures, "no need for a doctor", and false reassurance when the ledger carries an alert (with a negation guard so "do not stop the medicine on your own" passes). **Named medicines** (`medicine-guard.ts`, token-level, one clause at a time): "stop / skip / double / halve / reduce / leave out / cut down on / try reducing / not needed / instead of / 10 mg kar do" on a medicine by name, in English, Hinglish and Devanagari; and, with the patient's own list, suggesting one that is not on it ("you can take paracetamol", "add fish oil supplements", "ashwagandha le sakte hain"). A negation or a reference to the doctor in front ("do not stop on your own", "ask the doctor whether to stop") and plain statements ("is due at 08:00", "was missed on 3 days", "stopping suddenly can raise BP; ask the doctor") stay allowed; the eval holds 32 instructions and 24 benign twins.
- **Writer slips.** `answer_hi` mostly Latin letters, or `answer_en` mostly Devanagari, is `wrong_script`; spelled-out numbers from ten up ("एक सौ पैंतालीस") are checked like digits; harmless near-misses (a number as a string, `"True"`, `"High"`, a ref in brackets, an omitted empty list, a date range wider than the loaded history) are normalised instead of costing a repair call.
- **Required content.** For a medicine-change or diagnosis request: `needs_doctor` and an `ask_doctor` recommendation.

**What it does not do:** it cannot judge whether a sentence is *wise*, or confirm that a claim backed by a *web* source matches that page. It checks traceability, not medical correctness. The curated list is the app's answer to the second: every item was read on its publisher's page (`node scripts/soie-guidelines-check.mjs` re-fetches them and reports drift).

## Answering the question that was asked

"Asked one thing, answered another" was the main complaint, so both paths are guarded.

**Languages and voice.** Questions may be Hindi (Devanagari), English, Hinglish, or spoken (voice input in the composer: lower-case, no punctuation, English words written in Devanagari, "150 by 95" / "150 बाय 95" for a BP). Everything is matched on whole tokens after folding (`normalize.ts`); the eval has the same questions in all of these styles (`routing: languages`).

**Rules engine (`fallback.ts`), in this order.** Small talk → refusals (medicine change / diagnosis; the diagnosis answer lists the conditions *recorded in the app* and shows BP only for a BP / stroke / heart question) → a reading the user typed or spoke (classified, never swapped for a logged one) → impossible / future dates → saved-note lookups ("doodh se allergy hai kya" is answered from the family's notes, never from food logs) → symptoms (cannot assess; doctor / 112 / 108 + the BP picture to show) → not health at all ("aaj mausam kaisa hai": declined, no patient data) → a measure the app does not record ("sugar kitni hai": says so, estimates nothing) → medicine schedule ("kaun si dawai", "amlodipine kab leni hai") → compare / goal / missing / highest-lowest / advice / summary / one or more metrics. A date or a "how is it" word alone never produces a summary; a summary needs a real summary intent ("kaise rahe", or "kaise hain" **with** the patient named). Answers say how the question was read ("I read the question as: BP · 28 Sep – 4 Oct · average") so a misreading is visible, not silent.

**AI path.** The system prompt has an "Answer exactly what was asked" section, and the verifier adds one rule (`off_topic`): if the question names a tracked measure, the answer must cover at least one of them (in `data_coverage.metrics` or in its own words); otherwise it is bounced back to the model like any other violation. A declined question and a not-tracked measure are exempt.

## Safety model

1. **Emergency gate (before any model).** Hindi / Hinglish / English / Devanagari symptom phrases (chest pain, breathlessness, face droop, slurred speech, one-sided weakness, sudden severe headache, vision loss, confusion, fainting, seizure, vomiting blood, severe bleeding, unresponsive, suspected stroke) with simple negation handling ("seene mein dard nahi hai" is not an alarm). Result: a fixed answer: call 112/108 now, note the onset time, FAST signs, no food/drink/medicine until the crew says so, and the last logged BP. Tap-to-call `tel:` buttons in the UI. `safety_level: "escalate"`.
2. **Crisis reading.** If the latest logged reading (within 24 h) or a reading the user types is in the crisis range (`classifyBP`), the answer leads with it whatever was asked. The text is prepended by code, so the model cannot omit it.
3. **No dose / diagnosis advice.** Detected from the question, enforced by the verifier, repeated in the prompt.
4. **Untrusted text.** The question, saved notes, free text in records and web results are data. Instruction-like phrases are removed from the question (English and Hindi), angle brackets are stripped so user text cannot close our delimiters, record text is sanitised on load, and `save_memory` is refused unless the user's own message asked to remember something (so injected web content cannot write memory).
5. **Privacy and consent.** Nothing is sent to a model unless the family said yes (`patient_ai_settings.text`, per patient, three states: never asked / yes / no). The patient's and caregivers' **names, e-mail addresses and phone numbers are removed** from the question, earlier turns, saved notes, notes on readings and food names before anything leaves the server (`privacy.ts`; best effort, so it is never the only control), `sensitivity` stays `health`, and with `AI_PRIVACY=strict` health content never reaches a provider that may train on it. Web queries must be generic; queries that look like they contain readings or dates are flagged in the admin trace. Telemetry rows hold ids and counters only. No message text or health values are logged. The family sees their own notes un-scrubbed in the evidence chips: only the model-bound copy is scrubbed.
6. **Auth.** Session cookie → `requireUser` → membership check → every query runs as the user (the access rules in `src/lib/db/server/policy.ts`). Assistant history comes from the database by session id, never from the client (a client could forge assistant turns).

## Configuration (server environment)

The providers, keys, models, privacy mode and budgets are the AI layer's (`docs/ai.md`). SOIE adds:

| Variable | Default | Meaning |
|---|---|---|
| `SOIE_CHANNEL` | `json` | Router only. `tools` lets the model read the data with tools (needed for web search, Gemma 4 grounding); `json` is the one-call channel. |
| `SOIE_WEB_SEARCH` | `true` | `false` removes the web search tool. Only the tool channel can search; `GET /api/soie` reports `webSearch` accordingly. |
| `SOIE_EFFORT` | `medium` | Reasoning depth; mapped to each provider's own knob. |
| `SOIE_RATE_LIMIT_PER_HOUR` | `40` | Questions per user per rolling hour (429 beyond). Separate from the AI budget. |
| `SOIE_TIMEOUT_MS` | `100000` | Whole-turn deadline (10 000 to 110 000); the route `maxDuration` is 120 s. |
| `AI_FEATURES_OFF=soie` | | Ask answers from its rules; nothing else changes. |
| `AI_PATIENT_DAILY_LIMIT`, `AI_GLOBAL_DAILY_LIMIT` | 400, 2,000 | One slot per model-calling turn counts against both. Ask has no hourly AI cap of its own beyond `SOIE_RATE_LIMIT_PER_HOUR`. |

`GET /api/soie` answers `{ai, webSearch, model, provider, channel, guidelines, rateLimitPerHour}`; `ai` is false when no provider is configured or Ask is switched off.

The notices a rules answer can carry (machine-readable `code`, Hindi and English text; none mentions an API key):

| code | when |
|---|---|
| `no_api_key` | AI is not switched on in this app (nothing configured, `AI_ENABLED=false`, `AI_FEATURES_OFF=soie`) |
| `ai_consent_unasked` | the family has not been asked yet; the UI should offer the consent dialog |
| `ai_consent_off` | the family said no |
| `ai_quota` | the patient's or the service's daily AI budget is used up |
| `ai_unavailable` | every provider failed or timed out |
| `verification_fallback` | three answers in a row failed the verifier |
| `ai_refused` | the model declined |

Database: `npm run db:migrate` creates the tables `soie_sessions`, `soie_messages`, `soie_feedback`, `soie_events` and `soie_memories` (see `db/mysql/schema.sql`); who may read or write them is in `src/lib/db/server/policy.ts`. The AI budget is the AI layer's `ai_events` table.

## Learning, honestly

Nothing "learns" in the model. Two things are real: (1) notes the family saves (`soie_memories`) are read by the rules engine for lookup questions and, with AI on, sent to the AI (names removed, at most 5 notes) as facts and style preferences, and (2) the family's recent "not helpful" comments for that patient are included in the AI prompt, quoted. They never override safety rules. The UI says exactly this.

## Evaluation

```
npm run soie:eval      # 433 cases, pure: engine, verifier, plan, guidelines, medicine guard, JSON channel with a scripted model
npm run soie:wire      # the router's JSON channel over HTTP against a fake Gemini
npm run ai:eval        # includes "soie via router" + "soie core via router": the real router over HTTP to a fake Gemini / Groq
node scripts/db/soie-test.mjs   # the real route against a real MySQL test database + fake providers (consent, budget, privacy, SSE)
node scripts/soie-guidelines-check.mjs   # NETWORK: re-reads every curated page and reports drift (not part of a suite)
```

`soie:eval` runs real engine code over six synthetic patients (steady, crisis reading, sparse, missed medicines, high-sodium diet, empty) at a fixed "now" (2026-10-04 09:30 IST), with independent oracles for the numbers:

- safety (80+ emergency phrasings with clause-scoped negation and ~45 benign twins, typed crisis readings, medicine/diagnosis/injection/remember), temporal (41), normaliser (7), records (7), ledger (11), rules engine (34), routing (72 + 57 language cases), verifier (38), agent loop + tools (35), loaders (15);
- **evidence plan (17)**: only the asked measure's facts, Devanagari and spoken phrasings, a named medicine, follow-ups, a future / pre-history / impossible date gets no default window, a range is clamped to today, advice gets guidelines (reserved under a tight budget), no data for small talk, budget drops from the end;
- **guidelines (6)**: ids/urls unique, every figure's numbers are in its summary, topic matching, the tool result, figures bounded to the cited item (an invented limit, a snapshot number and an everyday quantity are all rejected);
- **medicine guard (5)**: 32 instructions refused, 24 benign twins allowed, the two reported sentences ("You should stop amlodipine for a few days", "Please skip Amlodipine tonight") refused in a full answer, "your doctor may adjust amlodipine" accepted;
- **weak writers (7)**: wrong script, spelled numbers, host-level web sources (tool loop and verifier), lenient shapes;
- **JSON channel (20)**: one call with a schema and no tools, wrong-topic repaired, fabrication never ships, prose then fenced JSON, prefetched dates, curated source completion, invented limit rejected, an uncurated source rejected, a medicine instruction bounced, privacy (names and phone numbers absent from the request), the consent / budget gate (denied: no model call; emergency: gate not even asked), accounting, outage, truncated reply, crisis lead, history only for follow-ups;
- **token budget (2)**: 14 questions x 6 patients stay under 5,500 estimated tokens; the pack is a fraction of the overview.

`/simulation-lab` runs the same suite in the browser. **None of this calls a live model**: what is proved is the harness around the model, so that whatever it writes, a number, a source or a medicine instruction that is not backed never reaches the family. Whether a live model follows the prompt is what `npm run ai:live` and a real session show.

`npm run soie:wire` drives the router path over HTTP against a local fake Gemini and asserts the request we send (structured output, no tools, the evidence pack, one repair round with the violation text). It cannot prove the live API accepts the request.

## Smoke test

1. Run the migration; set `GEMINI_API_KEY` and/or `GROQ_API_KEY` (and `OPENROUTER_API_KEY`) in `.env.local`; `npm run dev`; sign in.
2. `npm run soie:eval`, `npm run ai:eval`, `npm run soie:wire` pass (no key needed; Node 22.18+).
3. `/ask` before the family has agreed: any question is answered by the rules engine with the "AI needs your permission" notice. After the owner switches the text AI on in Settings: **"आज का हाल बताइए"** (engine badge "AI", evidence chips open real records), **"पिछले 7 दिन का औसत BP क्या रहा?"** (compare with `/health`), **"नमक कितना खाना चाहिए?"** (a recommendation with a WHO link and the item's own figures), **"papa ko seene mein dard hai"** (red emergency card, no model call), **"dawai band kar du kya"** (no instruction, doctor banner), **"yaad rakho ki papa ko doodh se allergy hai"** (appears under "सेव की गई बातें").
4. As admin, open the trace under an answer: `pack.estimatedTokens` is the size of the first request, `pack.facts` / `pack.droppedFacts` what the question got, `telemetry.repairs` how often the verifier bounced the model. A provider outage shows as `api_error` plus the "AI से जवाब नहीं मिल पाया" notice, so a misconfiguration is visible, not silent.
5. `AI_PATIENT_DAILY_LIMIT=2` and ask 3 questions to see the quota notice; `AI_FEATURES_OFF=soie` to see the rules-only notice.

## Known limits

- The AI paths are verified by tests against fakes (a scripted model, a fake Gemini / Groq over HTTP, a real MySQL test database); they were **not exercised against a live provider** from the build environment. First live run may surface request-shape surprises (strict schema acceptance, a model that keeps writing Hinglish into `answer_hi`); they fall back visibly and the admin trace says why.
- The JSON channel does not search the web; advice rests on the curated list (13 pages). A topic outside the list (a specific food, a lab value) gets the nearest items or a `general` recommendation with no figures. `SOIE_CHANNEL=tools` brings back search on providers that offer it (today: Gemma 4 grounding; every `gemini-*` model answered 429 for it on a free key).
- The curated list reflects the pages as read on `GUIDELINES_CHECKED`; WHO and NHLBI moved pages while it was written. Re-run `scripts/soie-guidelines-check.mjs` before a release. AHA, Mayo Clinic and CDC refuse automated readers and are deliberately absent.
- The redactor is best effort (spelling, honorifics and digit grouping vary). It is one of three controls, with consent and the data model (no name column ever enters the context).
- The medicine guard works on tokens in one clause. It does not understand a sentence it has no list entry for (a brand name that is neither on the patient's list nor in its drug table), and a model can still say something unwise that is not an instruction. It is a net under the prompt, not a pharmacist.
- History is the last 120 IST days (a hard ceiling of 20,000 rows per table, flagged if hit). "Last year" questions are answered with that stated limit.
- Inactive medicines count only on days with a real log (their stop date is not stored). Medicine logs written by older app versions with a UTC-shifted time are re-aligned by matching the schedule.
- Averages are over *logged* days only, and say so; sodium is a lower bound when items lack sodium data; "oil/fried" is counted by food name.
- The rules engine has no internet and no open-ended advice; for advice questions it shows the data plus rule-based suggestions. It is keyword-based: it handles the question styles in the eval, but a phrasing it has never seen can still land on "I could not fully understand" (it will not guess a topic). For open-ended, any-phrasing questions the AI path is required (and the family's consent).
- Voice input uses the browser's speech service (Chrome: Google's), so it needs a supporting browser and internet; recognised text goes into the question box for checking before sending. Spoken number *words* are parsed by the verifier for the answer, not for the question.
- The UI was type-checked and linted but not rendered in a browser in the build environment. The Ask UI does not yet show a consent prompt for `ai_consent_unasked` (it shows the notice text); that is a later wave.
