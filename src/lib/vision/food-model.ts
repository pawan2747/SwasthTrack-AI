/**
 * On-device food recognition: the Google AIY "food_V1" image classifier (MobileNet
 * V1, 2,023 dish classes, Apache-2.0) running in the browser through TensorFlow
 * Lite for the web. The file served from /models/food/ is a float16 copy of the
 * published model with a second output added: the 1,024-number image embedding
 * (the pooled features before the classifier), L2-normalised. The embedding is
 * what lets the app learn the family's own dishes: two photos of the same thali
 * have a cosine similarity of about 0.85 or more, unrelated dishes about 0.55-0.65.
 *
 * Everything here is lazy: nothing (about 15 MB: model + WASM runtime) is fetched
 * until the first photo. This module itself never uploads anything: the classifier
 * runs on the phone and only its result (labels and the 1,024-number embedding) goes
 * to the app's own server. Whether the photo is ALSO sent to an outside AI service
 * (src/lib/ai, behind the family's per-patient photos switch in Settings > AI) is a
 * separate, opt-in path and not decided here: src/services/food-photo-service.ts
 * (readMealPhotoWithAi) asks it for dish NAMES while this model runs, and the dialog
 * shows both. The AI reader never replaces this model's embedding: the family's
 * learned plates (food_photo_examples) live in THIS embedding space and are immutable,
 * so an API embedding must never be mixed in. A plate is learned from what the person
 * confirmed, with this embedding, whichever reader named the foods.
 */
import type { Tensor } from "@tensorflow/tfjs-core";

// File names carry a version because /models/* is served and cached as immutable.
export const FOOD_MODEL_URL = "/models/food/aiy-food-v1-fp16-embed.tflite";
export const FOOD_LABELS_URL = "/models/food/labels-v1.json";
const TFLITE_WASM_PREFIX = "/models/tflite-0.0.1-alpha.10/";
export const INPUT_SIZE = 192;
export const EMBEDDING_SIZE = 1024;

export interface FoodPrediction {
  /** Index into the label list (0 = background). */
  id: number;
  label: string;
  /** 0..1 */
  probability: number;
}

export interface FoodAnalysis {
  /** Top labels across the crops tried, best first (probabilities merged by max). */
  predictions: FoodPrediction[];
  /** L2-normalised 1,024-d embedding of the whole photo (mean of the crops, re-normalised). */
  embedding: Float32Array;
  /** Milliseconds spent in inference. */
  ms: number;
}

type Tflite = typeof import("@tensorflow/tfjs-tflite/dist/tf-tflite.min.js");
type TfCore = typeof import("@tensorflow/tfjs-core");

interface Loaded {
  tf: TfCore;
  model: import("@tensorflow/tfjs-tflite").TFLiteModel;
  labels: string[];
}

let loading: Promise<Loaded> | null = null;
let ready = false;

/** Loads the runtime, the model and the labels once. Rejects (and forgets) on failure so a retry is possible. */
export function loadFoodModel(onProgress?: (stage: "runtime" | "model" | "ready") => void): Promise<Loaded> {
  if (!loading) {
    loading = (async () => {
      onProgress?.("runtime");
      const [tf, tflite, labels] = await Promise.all([
        import("@tensorflow/tfjs-core") as Promise<TfCore>,
        // The bundled build: the package's ES entry references a file it does not ship.
        import("@tensorflow/tfjs-tflite/dist/tf-tflite.min.js") as Promise<Tflite>,
        fetch(FOOD_LABELS_URL).then((r) => {
          if (!r.ok) throw new Error(`labels: HTTP ${r.status}`);
          return r.json() as Promise<string[]>;
        }),
      ]);
      await import("@tensorflow/tfjs-backend-cpu");
      // TFLite runs its own WASM kernels; the tfjs backend only holds the input tensor.
      await tf.setBackend("cpu");
      await tf.ready();
      tflite.setWasmPath(TFLITE_WASM_PREFIX);
      onProgress?.("model");
      const model = await tflite.loadTFLiteModel(FOOD_MODEL_URL);
      ready = true;
      onProgress?.("ready");
      return { tf, model, labels };
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

/** True once the model is in memory (so the UI can say "ready" instead of "downloading"). */
export function isFoodModelLoaded(): boolean {
  return ready;
}

/** The crops of a photo that are run through the model: the whole frame, then the centre. */
function cropsOf(width: number, height: number): Array<{ sx: number; sy: number; sw: number; sh: number }> {
  const side = Math.min(width, height);
  const crops = [{ sx: 0, sy: 0, sw: width, sh: height }];
  if (Math.abs(width - height) > side * 0.08) crops.push({ sx: (width - side) / 2, sy: (height - side) / 2, sw: side, sh: side });
  // A tighter centre crop: the dish usually sits in the middle of the frame.
  const inner = side * 0.72;
  crops.push({ sx: (width - inner) / 2, sy: (height - inner) / 2, sw: inner, sh: inner });
  return crops;
}

function drawCrop(source: CanvasImageSource, crop: { sx: number; sy: number; sw: number; sh: number }): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, INPUT_SIZE, INPUT_SIZE);
  return canvas;
}

/**
 * Classifies and embeds a photo (an HTMLImageElement, ImageBitmap or canvas with
 * its natural orientation already applied). Several crops are tried and merged.
 */
export async function analyseFoodPhoto(source: CanvasImageSource & { width: number; height: number }, topK = 8): Promise<FoodAnalysis> {
  const { tf, model, labels } = await loadFoodModel();
  const started = performance.now();
  const best = new Map<number, number>();
  const sum = new Float32Array(EMBEDDING_SIZE);
  let crops = 0;
  for (const crop of cropsOf(source.width, source.height)) {
    const canvas = drawCrop(source, crop);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const rgb = new Int32Array(INPUT_SIZE * INPUT_SIZE * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    // The model takes raw uint8 RGB; tfjs-tflite maps that to an int32 tensor.
    const input = tf.tensor(rgb, [1, INPUT_SIZE, INPUT_SIZE, 3], "int32");
    const out = model.predict(input) as Tensor[] | Record<string, Tensor> | Tensor;
    const list = Array.isArray(out) ? out : out instanceof Object && "dataSync" in out ? [out as Tensor] : Object.values(out as Record<string, Tensor>);
    const features = list.find((t) => t.shape[t.shape.length - 1] === EMBEDDING_SIZE);
    const probs = list.find((t) => t.shape[t.shape.length - 1] === labels.length);
    if (!features || !probs) throw new Error("unexpected model outputs");
    const f = features.dataSync() as Float32Array;
    const p = probs.dataSync() as Float32Array;
    for (let i = 0; i < EMBEDDING_SIZE; i++) sum[i] += f[i];
    for (let i = 1; i < p.length; i++) {
      if (p[i] < 0.01) continue;
      best.set(i, Math.max(best.get(i) ?? 0, p[i]));
    }
    input.dispose();
    for (const t of list) t.dispose();
    crops++;
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_SIZE; i++) {
    sum[i] /= Math.max(1, crops);
    norm += sum[i] * sum[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_SIZE; i++) sum[i] /= norm;
  const predictions = [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, probability]) => ({ id, label: labels[id], probability: Math.round(probability * 1000) / 1000 }));
  return { predictions, embedding: sum, ms: Math.round(performance.now() - started) };
}

/** Cosine similarity of two L2-normalised embeddings. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Compact wire form of an embedding: 3 decimals is plenty for cosine matching (about 6 KB as JSON). */
export function packEmbedding(e: ArrayLike<number>): number[] {
  return Array.from(e, (v) => Math.round(v * 1000) / 1000);
}
