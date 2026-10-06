# Photo recognition (camera features)

Three things can now be entered from a photo instead of being typed:

| Where | Button | What happens |
| :--- | :--- | :--- |
| BP form (dashboard quick log, Health page) | **BP मशीन की फोटो से अंक भरें** | The three numbers on the monitor's screen are read and pre-filled; the person confirms. |
| Weight form | **वजन मशीन की फोटो से भरें** | The number on the scale's screen is read and pre-filled; the person confirms. |
| Food page, dashboard quick food entry | **खाने की फोटो से दर्ज करें** | The dish(es) on the plate are suggested; the person picks, sets portions and logs them all at once. The plate is remembered. |

Nothing is uploaded to any AI service. There is **no API key**: the display reader is
plain TypeScript and the food model runs inside the browser. A reading is always a
suggestion shown next to the photo; the person edits or confirms before anything is saved.

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
offered first, with the same foods and portions.

## Database

New table `food_photo_examples` (`db/mysql/schema.sql`). `npm run db:migrate` creates it, and
so does the app itself: once at every server start (`src/instrumentation.ts`, not awaited) and
again before any query that touches the table (`src/lib/db/server/late-tables.ts`), both as an
idempotent `CREATE TABLE IF NOT EXISTS`. Deploying the new version is therefore the migration;
a hosted database that predates this feature needs no manual step. Access: members read, editors and owners write, `created_by` is forced
to the caller, the embedding never changes (`src/lib/db/server/policy.ts`; covered by
`npm run db:test`).

## Verification

- `npm run vision:eval` — synthetic display accuracy (fast, no browser).
- `npm run db:test` — includes the new table's access rules.
- During development the three dialogs were driven end to end in headless Chrome with a
  Playwright script against the dev server (idli photo → logged → recognised again; Omron
  photo → 131/78/67; scale photo → 61). That script is not part of the repository.
