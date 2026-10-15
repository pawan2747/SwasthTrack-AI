# Photo recognition (camera features)

Three things can be entered from a photo instead of being typed:

| Where | Button | What happens |
| :--- | :--- | :--- |
| BP form (dashboard quick log, Health page, caregiver quick log) | **BP मशीन की फोटो से अंक भरें** | The three numbers on the monitor's screen are read and pre-filled; the person confirms. |
| Weight form (same places) | **वजन मशीन की फोटो से भरें** | The number on the scale's screen is read and pre-filled; the person confirms. |
| Food page, dashboard quick food entry | **खाने की फोटो से दर्ज करें** | The dish(es) on the plate are suggested; the person picks, sets portions and logs them all at once. The plate is remembered. |

**Where a photo goes.** By default, and whenever the family has not said yes, a photo is read
**on the phone and goes nowhere**: the display reader is plain TypeScript in a Web Worker and
the food model runs inside the browser, with no key involved. BP and weight photos can ALSO
be read by an AI service, but only after the family has said yes to that, once, per patient
(see *AI reading of BP and weight photos* below). What the meal-photo dialog sends is described under
*Food recognition*. A reading is always a suggestion shown next to the photo; the person edits
or confirms before anything is saved, and nothing is ever saved from a model's output.

## Display reader (BP monitors, scales)

`src/lib/vision/seven-segment.ts` turns a grey photo into rows of seven-segment digits:
local threshold (three window sizes, both polarities, so dark LCD digits and lit LED
digits both work) → blob filtering (frames, bars, fat blobs, specks) → levelling →
blobs grouped into digits → rows → segment zones matched against the digit table.
`bp-reader.ts` and `weight-reader.ts` turn the rows into SYS/DIA/pulse or kg, with
plausibility checks and a confidence gate (below 0.4 no reading is offered).

It runs in a Web Worker (`ocr.worker.ts`, via `use-display-reader.ts`), about 0.3-0.7 s on
a laptop, a few seconds on a phone.

**Accuracy (as of Oct 2026, `npm run vision:eval`):** synthetic displays 97 % (stacked BP),
85 % (side-by-side BP), 90 % (scales); real Creative-Commons photos cropped to the display
(`scratchpad` corpus of 41 images, many of them poor: product shots, LED kiosks, non-seven-
segment fonts): 16 correct, 16 wrong in one number, 9 no reading. The numbers must be checked
by the person every time; the dialog says so and shows green boxes around what was read.
Best results: screen filling the frame, straight on, no glare, flash off, the crop box tight
around the digits.

Run `npm run vision:eval -- --real <manifest.json>` to score real photos (see
`scripts/vision-eval.mjs` for the manifest format); `--seed N --trace` dumps one synthetic case.

## AI reading of BP and weight photos

On top of the display reader above. Browser side: `src/components/vision/display-photo-dialog.tsx`,
`src/services/vision-ai-service.ts`, `src/lib/vision/display-fill.ts`, `src/lib/vision/image.ts`
(`encodeJpeg`). Server side (`POST /api/vision/read`, the handlers in `src/lib/ai/vision/`, the
providers, keys and limits) is described in `docs/ai.md`.

### Consent: the default is "never asked", and nothing is sent until the family says yes

| The family's photo switch (per patient) | What happens |
| :--- | :--- |
| never asked (the default) | Photos stay on the phone. The first time a photo is taken by someone who may answer (owner or editor) the dialog shows the AI consent sheet on top of the box-and-read screen, with that photo in hand; the phone's reader is not held up by it. "Yes" reads this very photo with AI at once, "no" (or closing the sheet) carries on with box, reader and confirm. It is asked once per opening of the dialog, never on page load, and someone who cannot change the switch is not asked. |
| yes | The photo is also read by an AI service. |
| no | Photos stay on the phone, and the dialog says so. Can be changed any time in Settings. |

The line under the photo buttons always says what is true in that state: it only says a photo is
sent when it will be (switch on and online), says so when the phone is offline, and says that it will
ask when it has not been asked yet. What a new photo then does is decided by `aiPlan()` in
`display-fill.ts` from the same state as the line (an eval case checks all 96 combinations: the line says
"sent" exactly when the photo is sent). The server enforces the same switch (403 `ai_photos_unasked` /
`ai_photos_off`), so a stale tab cannot send a photo the family did not allow.

### What is sent, to whom, and what is kept

- One JPEG, redrawn onto a canvas in the browser (EXIF, GPS and the camera model are gone; the original file
  is never uploaded), longest side at most 1280 px and at most 0.9 MB, as base64 inside a JSON body to our own
  route. It is encoded once and the same bytes go to a second company if one is asked. The browser's budget
  is half the handler's 1.8 MB cap (an eval case compares the two).
- The route hands it to Google Gemini; Groq (a different company) is asked for a second opinion only when
  needed; OpenRouter's free models are the last resort. Which of them exist depends on the keys on the server.
  Nothing else goes with the photo: no patient or caregiver name, e-mail, earlier reading or other data.
- Free plans of these services may use submitted content to improve their models. That caveat is part of the
  consent sheet (`src/lib/ai-disclosure.ts`) and of the hint under the photo buttons.
- Nothing is stored: not the photo and not the model's answer. The route keeps one counter row per request
  (task, provider, model, latency, token counts) and, for two minutes and in memory only, the answer for an
  identical photo so that a double tap does not spend two calls.

### How the readings are combined

1. With AI on (and online) there is no box to draw: the phone reads the middle of the photo and the AI
   service reads the whole photo, at the same time. Nobody waits for the slower of the two: whichever answers
   first is shown at once and the screen is upgraded when the other arrives ("AI से मिलान हो रहा है" with the
   phone's reading below it; after 6 seconds "AI का इंतज़ार न करें"). A number the person has already typed
   or tapped is never overwritten by a later answer, and the phone's reading only takes part in the vote at
   confidence 0.4 or more.
2. The model only transcribes. `src/lib/vision/ai-normalize.ts` (run by the route) turns the transcription
   into values: ranges, a number must also appear in the digits the model says it saw, pounds and stone
   become kg, kitchen scales and measuring / memory / average / error displays are refused with a reason.
3. `src/lib/vision/consensus.ts` votes per field: `agreed`, `majority`, `single`, `conflict`, `missing`.
   Two answers from the same company count as one reader.
4. `src/lib/vision/display-fill.ts` decides what goes into the form field:
   - agreed or majority: filled;
   - a value only one reader gave: filled and marked "check it against the machine", unless it would by
     itself look like a crisis (at or above the patient's crisis line) or like a dangerously low reading
     (more than 10 below the low line); then it is NOT filled and is offered as a chip to tap;
   - a conflict or nothing read: the field stays empty and every value that was read is a chip
     (for example "130 AI", "135 फ़ोन");
   - the model says the display is measuring, a stored or average reading, an error, the wrong object or a
     kitchen scale: nothing is filled, not even from the phone's own reader, and the reason is shown in
     Hindi and English.
5. Another company is asked, once, only when the readers disagree, the read was hard, or a lone value is in
   an alarming range (`needsSecondOpinion` with that context; the request says `opinion: "second"` and names
   the first company in `avoidProvider`). The same company answering again is ignored. A single clear reading
   of an ordinary value costs one call: about 1.2 calls per read (an eval case counts them).
6. The person sees the whole photo, a badge per field and its alternatives. Green boxes are drawn while the
   phone's reading is not contradicted (it is the only reader so far, or among the agreeing readers). "ये अंक फ़ॉर्म में भरें" only fills the form: the
   form's range checks, its crisis / odd-reading / 5 kg-change confirmations and the alert rules then run
   exactly as for typed numbers.

### When AI is not used

AI off, never asked, no key or no connection: the dialog is the original one, crop box, reader on the phone,
confirm, and the line under the buttons says that the photo stays on the phone.

If a photo was sent and AI did not answer (over the hourly limit, a provider error, no answer within 18
seconds, or the person stopped waiting) nothing is said about it: the phone's reading, already on screen, is
the answer, and for a minute the next read of that dialog goes straight to the phone. A value only the phone
read and that is in the crisis range is not put in the field (it is a chip to tap) even then, because with
one reader it is the likeliest misread. If the phone read nothing, the "could not read" screen offers
"बॉक्स ठीक करके फिर पढ़ें", the crop step of the original flow; when it is used, both readers read the box.

### Tests

`npm run ai:eval` covers the groups *vision normalise / consensus / fill / client / flow*: normaliser edge
cases, the vote table, the crisis rule, blocking reasons, the upload plan and the JPEG encoder (against a
fake canvas), every HTTP failure the route can send, and the whole phone + AI read against a fake server:
order of arrival (phone first, AI first, phone silent), the number of calls, double taps, one encode for two
opinions. The dialog itself (React) is not covered by it. With real keys and real photos,
`npm run vision:ai-eval -- --manifest <file>` measures accuracy; the number to watch is photos that were
*agreed* and wrong, which must be about zero before the "agreed" badge is trusted. The accuracy of the AI path
on the family's own photos has not been measured yet; the figures above are for the phone's reader.

## Food recognition

`public/models/food/aiy-food-v1-fp16-embed.tflite` (10.5 MB) is Google's AIY "food_V1"
classifier (MobileNet V1, 2,023 dish classes, Apache-2.0, from TF Hub), converted to float16
with a second output: the 1,024-number image embedding; `labels-v1.json` has its class names.
`public/models/tflite-0.0.1-alpha.10/` holds the TensorFlow Lite WASM runtime (Apache-2.0,
copied from `@tensorflow/tfjs-tflite`). Everything under `/models/` is served and cached as
immutable, so a changed file must get a new name (the version is in the file or folder name).
The files are downloaded on the first photo (about 15 MB, once; cached by the browser and by
the service worker in its own `models` cache).

Flow (`src/components/vision/food-photo-dialog.tsx`):

1. The photo is decoded and analysed on the phone (`src/lib/vision/food-model.ts`): three
   crops, top labels merged, embedding averaged.
2. `POST /api/vision/food` receives **only** the embedding and the top labels and answers with
   - *learned*: this patient's earlier confirmed photos whose embedding is close (cosine ≥ 0.74),
     with the foods logged then — this is how the app learns the family's own thali;
   - *suggestions*: catalogue foods for the classifier labels (`src/lib/vision/food-labels.ts`
     maps classifier names to catalogue names).
3. The dialog also offers the person's usual foods for that meal and a search box. Every item
   gets a portion and quantity; calories come from the catalogue as elsewhere in the app.
4. On save, each item is logged with `source_note = "Logged from a meal photo"`, and the photo
   is remembered in `food_photo_examples` (embedding, foods, meal, a 64 px thumbnail; never the
   photo). The row's shape is validated on insert (`src/lib/db/server/policy.ts`: 1,024 finite
   numbers, 1-20 foods, thumbnail only as an inline JPEG/PNG/WebP data URL) and the embedding,
   foods and thumbnail never change afterwards. Learned photos are listed and can be removed
   under Settings → Data.

The classifier knows idli, upma, khichdi, rajma, chole, biryani, paneer dishes, samosa,
pakora and most sweets, but **not** plain roti, dal, sabzi or dosa. For those the learning
step does the work: after a plate has been logged once from a photo, the next similar plate is
offered first, with the same foods and portions. With the family's photo-AI switch on, a vision
model names those plain dishes too (next section); without it nothing below applies and the
dialog is exactly the flow above.

### AI reading of the plate

Browser: `src/components/vision/food-photo-dialog.tsx`, `src/services/food-photo-service.ts`
(`readMealPhotoWithAi`), `src/lib/vision/meal-map.ts`. Server: the `meal` handler
(`src/lib/ai/vision/meal.ts`, task `vision_meal`) behind `POST /api/vision/read`; providers, keys,
limits and the consent switch are in `docs/ai.md`. The switch is the same per-patient `photos`
switch as for BP and weight (it also covers voice recordings): never asked = nothing is sent.

**What happens.** The phone's model and the AI reader start together (nobody waits for the slower
one: the learned plates or the AI names appear as soon as either has them; after 6 seconds
"इंतज़ार न करें" skips AI). The first photo on a phone does not wait for the 15 MB download before
AI is asked (with "data saver" on, the download waits until AI has answered). When the model is
already in memory and a learned plate matches at 0.85 or more, **AI is not called at all** and a
button "AI से फिर देखें" offers it. The section "फोटो में AI ने देखा" sits under the learned plates
and above the classifier's chips (which are hidden while AI works and whenever it named items).
The error text appears only when BOTH the phone and AI could not help; an AI failure is silent and
the dialog is today's.

**What the model may say.** Names and counts, nothing else. The schema (`MEAL_SCHEMA` in
`src/lib/vision/ai-contract.ts`) is `{imageKind, items[]}` with `nameEn`, `nameHi`, `kind`
(bread, rice, dal, sabzi, curd, salad, sweet, snack, beverage, fruit, nonveg, egg, soup,
pickle_chutney, other), `count` (whole pieces it can SEE), `size` (small/medium/large) and
`confidence`. There is **no field for grams, millilitres, calories or nutrients**, the schema forbids
extra fields (an answer with a weight is a failed attempt: the next provider is tried), and an
amount written into a name ("roti 40 g") is stripped. The prompt offers the catalogue's everyday
cooked-food names (`src/lib/vision/meal-vocab.ts`, generated by `scripts/food/meal-vocab.mjs`),
the meal slot and at most 8 of the family's usual foods that ARE catalogue foods (the catalogue's
own name, never a person's free text); about 1,100 tokens of vocabulary, under 5,000 for the whole
request. One JPEG, at most 1024 px and 0.7 MB, re-encoded in the browser (no EXIF/GPS), not stored.
Medicine names, patient and caregiver names never go with it.

**What the app does with the names** (`mapMealItems`, pure, run on the phone against the
catalogue and the family's own foods). Queries run English name, Hindi name, then the
classifier-label synonyms; the single-word head noun ("sabzi" from "Lauki sabzi") is tried only
when nothing scored 560 or more, and a food found only that way is never pre-selected. A food is
**pre-selected only when all hold**: the catalogue name or alias equals the English name exactly,
it leads the next food by 25 points, its catalogue category fits the kind the model gave (kind
"other" never), the model was at least 0.6 sure. Everything else is a chip ("क्या यह है?", up to
3) or, when the catalogue does not know the name, a "खोजें" button that fills the search box.
A Hindi name alone is not enough to pre-select. Amounts: a count becomes that many of the food's
own counting portion (roti, idli, piece, slice; at most 20); otherwise the catalogue's first
serving, scaled 0.5 / 1 / 1.5 by the size word. Every gram, kcal and sodium figure is computed by
`dishes.ts` from the catalogue row; every AI-origin row is "Low" confidence ("लगभग · अंदाज़ा")
until the person changes the portion or the quantity, and is logged with source note "Logged from a
meal photo (AI-assisted)" (kept after an edit so an audit can tell the paths apart). A plate that
adds up to more than 2,500 kcal stops being pre-selected from the end and says "बहुत ज़्यादा लग
रहा है". Nothing is saved until the person presses the button; what is remembered as the family's
plate is only what was logged, so a model's mistake that was removed or replaced is not learned.

**A second look.** If a food photo yields no name, or two or more names the catalogue does not
know, the same photo is read once more by ANOTHER company (the route's `opinion: "second"`) and its
answer replaces the first only if it placed more names. The design asked for a "smart" tier of the
same vendor; the route has no hook for that, so this is the available equivalent (see the report
for the hook that would do it properly).

**When AI is not used.** Switch off, never asked and nobody who may answer, offline, no key,
quota, a slow or failing provider: the dialog is the original one and the line under the buttons
says so (`mealPhotoHint`: it says a photo is sent exactly when it will be). Never asked and the
person may answer: the consent sheet opens after the photo is taken (never on page load) while
the phone's model goes on.

**Measured (4 real CC thali photos, 2026-10-15, `node scripts/vision-meal-eval.mjs --manifest <file>`).** gemini-3.5-flash-lite:
3-7 s, named every visible main item on 4 of 4 plates (rice, roti/puri, dal, sabzi, raita, papad,
salad, pickle) with Hindi names, 16 of 17 truth items found, 0 wrong pre-selections after review
(the script flags items missing from the hand-written truth list; they were real: a pickle, a green
chilli). qwen3.8-27b on Groq: 1-2 s, similar names, one photo refused by the free tier's
rate limit. Counts were right on puri and papad, off on a stack of rotis; sizes are the weak
signal (both models call many bowls "small"), which is why every amount is "Low" and editable.
This is four photos, not an accuracy estimate: run it on the family's own plates.

## Database

New table `food_photo_examples` (`db/mysql/schema.sql`). `npm run db:migrate` creates it, and
so does the app itself the first time the table is used (`src/lib/db/server/late-tables.ts`,
an idempotent `CREATE TABLE IF NOT EXISTS`), so a hosted database that predates this feature
needs no manual step. Access: members read, editors and owners write, `created_by` is forced
to the caller, the embedding never changes (`src/lib/db/server/policy.ts`; covered by
`npm run db:test`).

## Medicine photo (strip, box, prescription)

"Add medicine" has a second way in: **पर्ची या दवाई की फोटो से जोड़ें** (new-medicine mode only, editors and
owners). A photo of a strip, a box or a prescription, or a prescription **pasted as text**, becomes
reviewed rows; the family ticks and fixes them, and each tick is an ordinary `addMedicine`.

| Way in | Needs | Where it is read |
|---|---|---|
| Photo | AI available, the family's photo switch not off, a connection, a provider that may see identifying content | AI service (`kind: "medicine"` of `POST /api/vision/read`) |
| Pasted / typed text | nothing | on the phone, by rules (`src/lib/medicine-parse.ts`); never sent anywhere |

There is no on-device reader for printed text, so with AI off, offline or refused the photo way is simply
not shown; the text way and the one-by-one form are always there.

**The model only copies.** Brand name, generic name, strength, form, the dosing pattern as written
(`1-0-1`, `BD`, words for the part of the day), before/after food, the dosing line and the duration, each
exactly as printed. The prompt asks for no purpose, no interaction, no dose check, no spelling correction, and
tells it never to copy the patient's or doctor's name, phone number or address. The schema has no field for
advice. Everything the family sees is code (`src/lib/vision/medicine-map.ts`, pure, also run by `npm run ai:eval`):

- **One row per dose of the day.** A medicines row is one scheduled time and `frequency` is only a label, so
  `1-0-1` is two rows (morning, night). `BD` / `TDS` / `QID` without named times are 2 / 3 / 4 rows ("dose 1 of 2").
  A count other than 1 is appended to the dose (`40 mg x 2`). As-needed (SOS) has no part of the day.
- **Names exactly as read.** Never corrected or completed towards a "known" drug. A name that is a sentence,
  carries advice words, a phone number, an e-mail or a doctor's/patient's name is refused: the row is dropped and
  the screen says the list may be incomplete.
- **Strength only by spelling.** `40mg` -> `40 mg` when a unit (mg, mcg, g, ml, IU, units, %) follows; otherwise blank
  and the person types it. Nothing is converted.
- **No time is invented.** The person taps 08:00 / 14:00 / 18:00 / 21:00 (or sets another); a row cannot be saved
  without one. The duration ("5 days") is shown, not stored: there is no column for it.
- **Flags.** Handwritten, or read with confidence under 0.5, or a pattern with an impossible count: an amber
  "पर्ची से मिलाएँ". More than 12 medicines: the first 12 and a "list may be incomplete" note. Rows that match a
  medicine already in the family's list (folded name, one typo allowed in long names, strengths must not
  contradict) say "सूची में पहले से है". Every row starts unticked.
- **A medicine absent from a new prescription** gets a neutral "not seen in this photo" tag in a separate list.
  Nothing is switched off or edited because a photo did not list it.
- A fixed, code-owned line ("दवाई या खुराक बदलने का फ़ैसला हमेशा डॉक्टर से पूछकर करें") is always on the review screen.

**Privacy.** A prescription carries names, phone numbers and doctors, so the read is `sensitivity: "identifying"`:
under `AI_PRIVACY=balanced` or `strict` only a provider that does not train on content may see it (Groq by default, or
Gemini / OpenRouter with `*_PLAN=paid`). With only a free Gemini key configured the router has no provider for it,
sends nothing, and the dialog falls back to the text way; `performance` mode (the owner's explicit choice) lifts that.
Before the photo is read the person can draw a box around the medicine lines so names, addresses and phone numbers stay
out of the upload ("सिर्फ़ दवाइयों वाली लाइनें चुनें"); the re-encoded crop (no EXIF) is what is sent, it is never stored, and
the thumbnail beside the rows is only held in the open dialog. The first photo read asks the family for the photo
switch (the same consent as BP and weight photos).

**Not verified here.** Real strips and prescriptions on a real phone, and above all handwriting: the schema and rules
are covered by fake-provider tests, but no medicine photo was read by a live model during development. Treat
"handwritten" rows as suggestions; the original photo stays beside them for that reason.

Files: `src/lib/ai/vision/medicine.ts` (handler), `src/lib/vision/medicine-map.ts`, `src/lib/medicine-parse.ts`,
`src/components/vision/medicine-photo-dialog.tsx`, entry in `src/components/forms/add-medicine-dialog.tsx`.
Tests: `npm run ai:eval` (group "medicine photo") and `scripts/db/medicine-photo-test.mjs` (route + real MySQL).

## Verification

- `npm run vision:eval` — synthetic display accuracy of the phone's reader (fast, no browser).
- `npm run ai:eval` — the AI layer and the browser-side photo logic above (no network, no keys).
- `npm run vision:ai-eval -- --manifest <file>` — AI accuracy on real photos (uses the keys in `.env.local`).
- `node scripts/vision-meal-eval.mjs --manifest <file>` — what the real models name on real plates and what the app would pre-select (group "meal photo" in `ai:eval` holds the recorded answers).
- `node scripts/db/meal-photo-test.mjs` — the meal-photo route and `/api/vision/food` against MySQL and a fake provider (consent, a weight in the answer, provider down, slot settled).
- `npm run db:test` — includes the new table's access rules.
- During development the three dialogs were driven end to end in headless Chrome with a
  Playwright script against the dev server (idli photo → logged → recognised again; Omron
  photo → 131/78/67; scale photo → 61). That script is not part of the repository.
