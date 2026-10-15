/**
 * Browser-side photo handling for the camera features: decode a captured file
 * with its EXIF orientation applied, scale it, crop it, turn it into the grey
 * buffer the display reader works on, make the tiny thumbnail that is kept for a
 * learned meal photo, and (encodeJpeg) prepare the bytes an AI reader is sent.
 * Nothing here touches the network: sending is src/services/vision-ai-service.ts.
 */
import { grayFromRGBA, type GrayImage } from "./gray";

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("इस ब्राउज़र में फोटो प्रोसेस नहीं हो सकती (canvas unavailable)");
  return ctx;
}

function fitScale(width: number, height: number, maxSide: number): number {
  const longest = Math.max(width, height);
  return longest > maxSide ? maxSide / longest : 1;
}

/**
 * Decodes a photo file into a canvas no larger than `maxSide`, the way the camera
 * saw it (EXIF rotation applied). Phones store photos sideways with an orientation
 * tag; `createImageBitmap` honours it, and so does an <img> in every current browser.
 */
export async function decodePhoto(file: Blob, maxSide = 1600): Promise<HTMLCanvasElement> {
  let source: ImageBitmap | HTMLImageElement;
  let width: number;
  let height: number;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      source = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("फोटो खोली नहीं जा सकी (unsupported image)"));
        img.src = url;
      });
      width = source.naturalWidth;
      height = source.naturalHeight;
    } finally {
      // The image is drawn synchronously below before the URL is released.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  const scale = fitScale(width, height, maxSide);
  const canvas = canvasOf(width * scale, height * scale);
  context(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  return canvas;
}

/** A copy of part of a canvas (box in the canvas's own pixels). */
export function cropCanvas(canvas: HTMLCanvasElement, box: CropBox): HTMLCanvasElement {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const w = Math.min(canvas.width - x, Math.ceil(box.width));
  const h = Math.min(canvas.height - y, Math.ceil(box.height));
  const out = canvasOf(w, h);
  context(out).drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return out;
}

/** The grey buffer the display reader takes (longest side at most `maxSide`). */
export function canvasToGray(canvas: HTMLCanvasElement, maxSide = 1100): GrayImage {
  const scale = fitScale(canvas.width, canvas.height, maxSide);
  let source = canvas;
  if (scale < 1) {
    source = canvasOf(canvas.width * scale, canvas.height * scale);
    context(source).drawImage(canvas, 0, 0, source.width, source.height);
  }
  const { data } = context(source).getImageData(0, 0, source.width, source.height);
  return grayFromRGBA(data, source.width, source.height);
}

/** A small JPEG data URL (default 64 px on the longer side) for lists and the learned-photo store. */
export function thumbnailDataUrl(canvas: HTMLCanvasElement, maxSide = 64, quality = 0.6): string {
  const scale = fitScale(canvas.width, canvas.height, maxSide);
  const out = canvasOf(canvas.width * scale, canvas.height * scale);
  context(out).drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", quality);
}

/** A data URL of the canvas for an <img> preview (JPEG, modest quality). */
export function previewDataUrl(canvas: HTMLCanvasElement, maxSide = 1200, quality = 0.82): string {
  const scale = fitScale(canvas.width, canvas.height, maxSide);
  if (scale >= 1) return canvas.toDataURL("image/jpeg", quality);
  const out = canvasOf(canvas.width * scale, canvas.height * scale);
  context(out).drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", quality);
}

// ---- Photos that go to an AI reader ----------------------------------------------

/**
 * Longest side (px) and size budget (decoded JPEG bytes) of a photo sent to an AI reader, per kind.
 * Well under the server's own caps (src/lib/ai/vision/*: 1.8 MB decoded) and under Vercel's 4.5 MB body
 * limit once base64 has made the bytes a third bigger.
 */
export const AI_PHOTO_BUDGET = {
  bp: { maxSide: 1280, maxBytes: 900_000 },
  weight: { maxSide: 1280, maxBytes: 900_000 },
  meal: { maxSide: 1024, maxBytes: 700_000 },
  medicine: { maxSide: 2048, maxBytes: 1_800_000 },
  label: { maxSide: 2048, maxBytes: 1_800_000 },
} as const;

export interface JpegAttempt {
  width: number;
  height: number;
  quality: number;
}

const JPEG_QUALITIES = [0.82, 0.72, 0.62, 0.5] as const;
const JPEG_SIZE_STEPS = 4;
const JPEG_SIZE_FACTOR = 0.8;

/**
 * Pure: the tries encodeJpeg walks, best first. At each size the quality steps down (digits stay
 * legible at a lower quality longer than at a smaller size); when the lowest quality still does not
 * fit, the sides shrink by a fifth and the qualities start over. Never enlarges the photo.
 */
export function jpegAttempts(width: number, height: number, opts: { maxSide?: number; minSide?: number } = {}): JpegAttempt[] {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const maxSide = opts.maxSide ?? 1280;
  const minSide = opts.minSide ?? 480;
  let scale = Math.min(1, maxSide / Math.max(w, h));
  const attempts: JpegAttempt[] = [];
  for (let step = 0; step < JPEG_SIZE_STEPS; step++) {
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));
    if (step > 0 && Math.max(sw, sh) < minSide) break;
    for (const quality of JPEG_QUALITIES) attempts.push({ width: sw, height: sh, quality });
    scale *= JPEG_SIZE_FACTOR;
  }
  return attempts;
}

/** Decoded size of a base64 string (no prefix, no line breaks). */
export function base64ByteLength(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** "data:image/jpeg;base64,AAAA" -> "AAAA"; anything without that prefix is returned as it is. */
export function stripDataUrlPrefix(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
}

export interface EncodedJpeg {
  /** The JPEG as base64, without a `data:` prefix. */
  base64: string;
  /** Decoded size in bytes. */
  bytes: number;
  width: number;
  height: number;
  quality: number;
  /** False only when even the smallest try was over the budget: the caller must not send it. */
  withinBudget: boolean;
}

function toJpegBase64(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const viaDataUrl = () => {
      try {
        resolve(stripDataUrlPrefix(canvas.toDataURL("image/jpeg", quality)));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("फोटो तैयार नहीं हो सकी"));
      }
    };
    if (typeof canvas.toBlob !== "function") {
      viaDataUrl();
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          viaDataUrl();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(stripDataUrlPrefix(String(reader.result)));
        reader.onerror = viaDataUrl;
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * The bytes an AI reader is sent: the canvas redrawn onto a fresh canvas (a canvas export carries no
 * EXIF, GPS or camera model, and the original File is never uploaded), as a JPEG that fits the budget.
 * `canvas` is what decodePhoto / cropCanvas returned. Resolves with the first try under `maxBytes`.
 */
export async function encodeJpeg(canvas: HTMLCanvasElement, opts: { maxSide?: number; maxBytes?: number } = {}): Promise<EncodedJpeg> {
  const maxSide = opts.maxSide ?? AI_PHOTO_BUDGET.bp.maxSide;
  const maxBytes = opts.maxBytes ?? AI_PHOTO_BUDGET.bp.maxBytes;
  let drawn: HTMLCanvasElement | null = null;
  let drawnFor = "";
  let last: EncodedJpeg | null = null;
  for (const attempt of jpegAttempts(canvas.width, canvas.height, { maxSide })) {
    const sizeKey = `${attempt.width}x${attempt.height}`;
    // One redraw per size; between tries at the same size only the quality changes.
    if (!drawn || drawnFor !== sizeKey) {
      const out = canvasOf(attempt.width, attempt.height);
      const ctx = context(out);
      // JPEG has no transparency: paint white under a canvas that has any.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, 0, 0, out.width, out.height);
      drawn = out;
      drawnFor = sizeKey;
    }
    const base64 = await toJpegBase64(drawn, attempt.quality);
    const bytes = base64ByteLength(base64);
    last = { base64, bytes, width: drawn.width, height: drawn.height, quality: attempt.quality, withinBudget: bytes <= maxBytes };
    if (last.withinBudget) return last;
  }
  if (!last) throw new Error("फोटो तैयार नहीं हो सकी");
  return last;
}
