"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { parseDecimalInput, parseIntegerInput } from "@/components/health/format";
import { useOnline } from "@/components/layout/offline-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, NumberInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { CropEditor } from "@/components/vision/crop-editor";
import { PhotoPicker } from "@/components/vision/photo-picker";
import { ReadField, ReasonList } from "@/components/vision/photo-read-parts";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { AI_PROVIDERS } from "@/lib/ai-disclosure";
import {
  aiPlan,
  applyResolution,
  deviceReadingOf,
  photoPrivacyHint,
  stageFor,
  type FieldTexts,
  type FillKey,
  type ReadStage,
} from "@/lib/vision/display-fill";
import type { Box } from "@/lib/vision/gray";
import type { DisplayKind, DisplayReadResult } from "@/lib/vision/display-reader";
import { canvasToGray, cropCanvas, decodePhoto, previewDataUrl, type CropBox } from "@/lib/vision/image";
import { useDisplayReader } from "@/lib/vision/use-display-reader";
import { getBPThresholds } from "@/services/settings-service";
import {
  getVisionAiStatus,
  isConsentProblem,
  newRequestId,
  peekVisionAiStatus,
  readDisplayWithAi,
  type DeviceOutcome,
  type DisplayProgress,
  type VisionAiStatus,
} from "@/services/vision-ai-service";

export type BPPhotoValues = { systolic: number; diastolic: number; pulse: number | null };
export type WeightPhotoValues = { kg: number };

type Props =
  | { kind: "bp"; patientId: string; isOpen: boolean; onClose: () => void; onResult: (values: BPPhotoValues) => void }
  | { kind: "weight"; patientId: string; isOpen: boolean; onClose: () => void; onResult: (values: WeightPhotoValues) => void };

type Step = "pick" | "crop" | ReadStage;
/** first: AI reads the whole photo and the phone the default box; whole / box: both read that region. */
type ReadMode = "first" | "whole" | "box";

const COPY: Record<DisplayKind, { title: string; hindiTitle: string; what: string; tip: string }> = {
  bp: {
    title: "Read the BP machine",
    hindiTitle: "BP मशीन की फोटो",
    what: "BP मशीन की स्क्रीन",
    tip: "स्क्रीन को सीधा, पास से और बिना चमक के लें। ऊपर वाला, नीचे वाला और नब्ज़ तीनों अंक दिखने चाहिए।",
  },
  weight: {
    title: "Read the weighing scale",
    hindiTitle: "वजन मशीन की फोटो",
    what: "वजन मशीन की स्क्रीन",
    tip: "मशीन पर खड़े होकर अंक रुक जाएँ, फिर स्क्रीन की फोटो सीधी और पास से लें।",
  },
};

/** After this long the person may stop waiting for AI. */
const SLOW_AFTER_MS = 6_000;
/** After AI failed or was stopped, the next read of this dialog goes straight to the phone's reader for this long. */
const AI_PAUSE_MS = 60_000;

/** The default crop: the middle of the frame, where the person was asked to keep the screen. */
function defaultBox(width: number, height: number): CropBox {
  return { x: width * 0.1, y: height * 0.22, width: width * 0.8, height: height * 0.52 };
}

const EMPTY_TEXTS: FieldTexts = { systolic: "", diastolic: "", pulse: "", kg: "" };

/**
 * Photo of a display -> numbers in the form. Steps: take the photo, tighten the box
 * around the screen, read, confirm (every number stays editable). The reading is a
 * suggestion: nothing is saved here.
 *
 * With the family's AI switch on (and a connection) the photo is read by the phone and by an AI service at
 * the same time, with no box to draw. Nobody waits for the slower of the two: the first answer is shown
 * at once and upgraded when the other arrives (a number the person already typed is never overwritten).
 * Where they agree the number is marked as such, where they do not the person picks. Otherwise (AI off,
 * never asked, offline, a failed call) this is the original flow: crop box, the reader on the phone,
 * confirm, with no message about AI.
 */
export function DisplayPhotoDialog(props: Props) {
  // Mounted only while open, so every opening starts at the first step.
  return props.isOpen ? <DisplayPhotoDialogBody {...props} /> : null;
}

function DisplayPhotoDialogBody(props: Props) {
  const { kind, patientId, isOpen, onClose } = props;
  const copy = COPY[kind];
  const read = useDisplayReader();
  const ai = useAiSettings(patientId);
  const online = useOnline();

  // Whether this deployment can read this kind of photo with a model (cached for the session).
  const [vision, setVision] = useState<VisionAiStatus | null>(() => peekVisionAiStatus(patientId));
  useEffect(() => {
    if (!ai.available) return;
    let alive = true;
    void getVisionAiStatus(patientId).then((status) => {
      if (alive) setVision(status);
    });
    return () => {
      alive = false;
    };
  }, [ai.available, patientId]);
  const visionLive = ai.available && vision !== null && vision.available && vision.kinds.includes(kind);

  const [step, setStep] = useState<Step>("pick");
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [box, setBox] = useState<CropBox>({ x: 0, y: 0, width: 1, height: 1 });
  const [crop, setCrop] = useState<HTMLCanvasElement | null>(null);
  const [cropOrigin, setCropOrigin] = useState({ x: 0, y: 0 });
  /** The phone reader's own result for the current read (boxes, notes), for drawing. */
  const [result, setResult] = useState<DisplayReadResult | null>(null);
  /** The progressive state of an AI-assisted read; null for the original, phone-only flow. */
  const [progress, setProgress] = useState<DisplayProgress<DisplayReadResult | null> | null>(null);
  const [aiMode, setAiMode] = useState(false);
  const [slow, setSlow] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<string>("");
  const [texts, setTexts] = useState<FieldTexts>(EMPTY_TEXTS);

  const aliveRef = useRef(true);
  const stepRef = useRef<Step>("pick");
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const decodingRef = useRef(false);
  /** AI is rested for a minute after it failed or was stopped (a timer, so no clock is read while rendering). */
  const pausedRef = useRef(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Fields the person typed into or picked a chip for: a later AI answer never overwrites them. */
  const touchedRef = useRef<Set<FillKey>>(new Set());

  // One place that decides what a photo may do, from the same state as the line under the picker.
  const hintState = {
    offered: visionLive,
    photos: ai.settings?.photos ?? null,
    canChange: ai.canChange,
    online,
    // Until both answers are in, saying anything about where the photo goes could be wrong.
    loading: ai.loading || (ai.available && vision === null),
    asked,
  };
  const plan = aiPlan(hintState);
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      // Closing the dialog abandons whatever is in flight (the request is cancelled, nothing is shown).
      aliveRef.current = false;
      abortRef.current?.abort();
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, []);

  function restAi() {
    pausedRef.current = true;
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      pausedRef.current = false;
    }, AI_PAUSE_MS);
  }

  function goto(next: Step) {
    stepRef.current = next;
    setStep(next);
  }

  /** Abandons the read in flight: its answers are ignored and its AI calls are cancelled. */
  function cancelRun() {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }

  function leaveTo(next: Step) {
    cancelRun();
    goto(next);
  }

  const aiView = progress?.resolution ?? null;
  const aiPhase = progress?.ai ?? "waiting";
  // An AI answer (or the second opinion) is still expected: not answered yet, not given up on.
  const aiPending = aiMode && (aiPhase === "waiting" || aiPhase === "second") && progress?.final !== true;

  // A slow AI answer: after a few seconds the person may go on without it.
  const waitingOnAi = aiPending && (step === "reading" || step === "result");
  useEffect(() => {
    if (!waitingOnAi) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waitingOnAi, aiPhase]);

  async function handlePhoto(file: File) {
    // A second pick while the first is still being decoded or read is a double tap.
    if (decodingRef.current || stepRef.current === "reading") return;
    decodingRef.current = true;
    setDecoding(true);
    setError("");
    try {
      const canvas = await decodePhoto(file, 1600);
      if (!aliveRef.current) return;
      setPhoto(canvas);
      setPreview(previewDataUrl(canvas, 1200));
      setBox(defaultBox(canvas.width, canvas.height));
      const now = planRef.current;
      if (now === "ai" && !pausedRef.current) {
        // AI is on: no box to draw, the whole photo is read right away.
        void runReader("first", canvas, { ai: true });
        return;
      }
      goto("crop");
      // Never asked: ask now, with this photo in hand, and let the phone's reader be used meanwhile.
      if (now === "ask") {
        setAsked(true);
        setConsentOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "फोटो खोली नहीं जा सकी");
    } finally {
      decodingRef.current = false;
      setDecoding(false);
    }
  }

  /** The original flow's result screen: the phone's reading in the fields, as it was before AI existed. */
  function showDeviceResult(res: DisplayReadResult) {
    setResult(res);
    if (!res.reading) {
      goto("failed");
      return;
    }
    if (res.kind === "bp") {
      setTexts({ ...EMPTY_TEXTS, systolic: String(res.reading.systolic), diastolic: String(res.reading.diastolic), pulse: res.reading.pulse === null ? "" : String(res.reading.pulse) });
    } else {
      setTexts({ ...EMPTY_TEXTS, kg: String(res.reading.kg) });
    }
    goto("result");
  }

  /** A new snapshot of an AI-assisted read: show whatever exists now and upgrade the fields the person left alone. */
  function showProgress(p: DisplayProgress<DisplayReadResult | null>) {
    setProgress(p);
    if (p.device?.raw) setResult(p.device.raw);
    const res = p.resolution;
    if (res) setTexts((t) => applyResolution(t, touchedRef.current, res));
    const next = stageFor({ anything: res?.anything === true, final: p.final, current: stepRef.current === "result" ? "result" : "reading" });
    if (next === "failed" && p.device?.failure) setError(p.device.failure);
    if (next !== stepRef.current) goto(next);
  }

  async function runReader(mode: ReadMode, source: HTMLCanvasElement | null = photo, opts: { ai?: boolean } = {}) {
    // A second tap before the screen changed is a double tap, not a new read.
    if (!source || stepRef.current === "reading") return;
    cancelRun();
    const run = runRef.current;
    const useAi = opts.ai ?? (planRef.current === "ai" && !pausedRef.current);
    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => aliveRef.current && run === runRef.current;

    touchedRef.current = new Set();
    setTexts(EMPTY_TEXTS);
    setAiMode(useAi);
    setProgress(null);
    setResult(null);
    setSlow(false);
    setError("");
    goto("reading");
    try {
      const cropBox = mode === "first" ? defaultBox(source.width, source.height) : box;
      const region = mode === "whole" ? source : cropCanvas(source, cropBox);
      setCrop(region);
      setCropOrigin(mode === "whole" ? { x: 0, y: 0 } : { x: Math.max(0, Math.floor(cropBox.x)), y: Math.max(0, Math.floor(cropBox.y)) });

      if (!useAi) {
        // The original flow, untouched: the reader on the phone, then the confirm screen.
        const res = await read(kind, canvasToGray(region, 1100));
        if (!current()) return;
        showDeviceResult(res);
        return;
      }

      // The phone and the AI service read at the same time and each result is shown as it arrives; the AI sees
      // the photo as the person framed it.
      const outcome = await readDisplayWithAi<DisplayReadResult | null>({
        patientId,
        kind,
        canvas: mode === "box" ? region : source,
        device: () =>
          read(kind, canvasToGray(region, 1100)).then(
            (res): DeviceOutcome<DisplayReadResult | null> => ({ reading: deviceReadingOf(res), raw: res, failure: "" }),
            (err: unknown): DeviceOutcome<DisplayReadResult | null> => ({
              reading: null,
              raw: null,
              failure: err instanceof Error ? err.message : "फोटो पढ़ी नहीं जा सकी",
            }),
          ),
        thresholds: kind === "bp" ? getBPThresholds(patientId) : undefined,
        requestId: newRequestId(),
        signal: controller.signal,
        onProgress: (p) => {
          if (current()) showProgress(p);
        },
      });
      if (!current()) return;
      if (outcome.mode === "device") {
        // AI did not answer (switched off elsewhere, over its quota, slow, stopped): the screen already shows
        // the phone's reading, with no message. A stale switch is re-read; anything else rests AI for a minute.
        if (isConsentProblem(outcome.reason)) void ai.refresh();
        else restAi();
      }
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : "फोटो पढ़ी नहीं जा सकी");
      goto("failed");
    }
  }

  function stopWaitingForAi() {
    abortRef.current?.abort();
  }

  // The photo with the digits that were read drawn as boxes, for the confirmation screen.
  const marked = useMemo(() => {
    if (!crop || !result?.reading) return "";
    const boxes: Array<Box | null> = result.kind === "bp" ? [result.reading.boxes.systolic, result.reading.boxes.diastolic, result.reading.boxes.pulse] : [result.reading.box];

    if (!aiMode) {
      // The phone's own result: the crop the person framed, turned level, with the digits boxed.
      const canvas = document.createElement("canvas");
      canvas.width = crop.width;
      canvas.height = crop.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      // The boxes live in the frame the reader levelled; show the photo turned the same way.
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((result.reading.rotation * Math.PI) / 180);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);
      ctx.drawImage(crop, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = crop.width / result.reading.width;
      const sy = crop.height / result.reading.height;
      ctx.lineWidth = Math.max(2, crop.width / 250);
      ctx.strokeStyle = "#0a6a4a";
      for (const b of boxes) {
        if (!b) continue;
        const pad = 4;
        ctx.strokeRect(b.x0 * sx - pad, b.y0 * sy - pad, (b.x1 - b.x0 + 1) * sx + 2 * pad, (b.y1 - b.y0 + 1) * sy + 2 * pad);
      }
      return previewDataUrl(canvas, 900);
    }

    // With AI: the whole photo, and the boxes only while the phone's reading is not contradicted: it is the
    // only reader so far, or it is among the agreeing readers.
    if (!photo) return "";
    if (aiView && aiView.providers.length > 0 && !aiView.deviceAgrees) return "";
    const canvas = document.createElement("canvas");
    canvas.width = photo.width;
    canvas.height = photo.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(photo, 0, 0);
    const sx = crop.width / result.reading.width;
    const sy = crop.height / result.reading.height;
    // Boxes are in the levelled frame of the crop: undo that turn about the crop's centre, then place the crop.
    ctx.translate(cropOrigin.x + crop.width / 2, cropOrigin.y + crop.height / 2);
    ctx.rotate((-result.reading.rotation * Math.PI) / 180);
    ctx.translate(-crop.width / 2, -crop.height / 2);
    ctx.lineWidth = Math.max(2, photo.width / 250);
    ctx.strokeStyle = "#0a6a4a";
    for (const b of boxes) {
      if (!b) continue;
      const pad = 4;
      ctx.strokeRect(b.x0 * sx - pad, b.y0 * sy - pad, (b.x1 - b.x0 + 1) * sx + 2 * pad, (b.y1 - b.y0 + 1) * sy + 2 * pad);
    }
    return previewDataUrl(canvas, 1200);
  }, [crop, cropOrigin, result, aiMode, aiView, photo]);

  const confidence = result?.reading?.confidence ?? 0;
  const notes = result?.reading?.notes ?? [];
  const decimalAssumed = result?.kind === "weight" && result.reading?.decimalAssumed === true;

  /** A person's own entry (typed or a tapped chip) from now on wins over any later AI answer. */
  function edit(key: FillKey, value: string) {
    touchedRef.current.add(key);
    setTexts((t) => ({ ...t, [key]: value }));
  }

  function useValues() {
    if (props.kind === "bp") {
      const s = parseIntegerInput(texts.systolic);
      const d = parseIntegerInput(texts.diastolic);
      const p = texts.pulse.trim() === "" ? null : parseIntegerInput(texts.pulse);
      if (Number.isNaN(s) || Number.isNaN(d) || (p !== null && Number.isNaN(p))) {
        setError("अंक पूरे लिखें (systolic और diastolic ज़रूरी हैं)");
        return;
      }
      props.onResult({ systolic: s, diastolic: d, pulse: p });
    } else {
      const v = parseDecimalInput(texts.kg);
      if (Number.isNaN(v)) {
        setError("वजन kg में लिखें");
        return;
      }
      props.onResult({ kg: v });
    }
    cancelRun();
    onClose();
  }

  const hint = photoPrivacyHint({ ...hintState, canChange: hintState.canChange && !asked });

  const footer =
    step === "crop" ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={() => leaveTo("pick")}>
          <RefreshCw aria-hidden className="h-4 w-4" />
          <span lang="hi">दूसरी फोटो</span>
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => void runReader("whole")}>
            <span lang="hi">पूरी फोटो पढ़ें</span>
          </Button>
          <Button variant="primary" onClick={() => void runReader("box")}>
            <ScanLine aria-hidden className="h-4 w-4" />
            <span lang="hi">बॉक्स के अंदर पढ़ें</span>
          </Button>
        </div>
      </div>
    ) : step === "result" ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={() => leaveTo("pick")}>
          <RefreshCw aria-hidden className="h-4 w-4" />
          <span lang="hi">दोबारा फोटो</span>
        </Button>
        <Button variant="primary" onClick={useValues}>
          <Check aria-hidden className="h-4 w-4" />
          <span lang="hi">ये अंक फ़ॉर्म में भरें</span>
        </Button>
      </div>
    ) : step === "failed" ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onClose}>
          <span lang="hi">हाथ से लिखूँगा</span>
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {photo ? (
            <Button variant="secondary" onClick={() => leaveTo("crop")}>
              <ScanLine aria-hidden className="h-4 w-4" />
              <span lang="hi">बॉक्स ठीक करके फिर पढ़ें</span>
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => leaveTo("pick")}>
            <RefreshCw aria-hidden className="h-4 w-4" />
            <span lang="hi">दोबारा फोटो लें</span>
          </Button>
        </div>
      </div>
    ) : undefined;

  const readers = aiView
    ? [...(aiView.deviceUsed ? ["फ़ोन"] : []), ...aiView.providers.map((p) => AI_PROVIDERS.find((x) => x.id === p)?.name ?? p)].join(" · ")
    : "";

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={copy.title} hindiTitle={copy.hindiTitle} size="lg" footer={footer} closeOnBackdrop={step !== "reading"}>
        <div className="space-y-4">
          {error ? (
            <p role="alert" className="rounded-card border border-critical-line bg-critical-soft p-3 text-sm font-medium text-critical">
              {error}
            </p>
          ) : null}

          {step === "pick" ? (
            <>
              <p lang="hi" className="text-sm text-ink-muted">
                {copy.tip}
              </p>
              <PhotoPicker onPhoto={(f) => void handlePhoto(f)} busy={decoding} captureLabel={`${copy.what} की फोटो लें`} hint={hint} />
            </>
          ) : null}

          {step === "crop" && photo ? (
            <>
              <p lang="hi" className="text-sm text-ink-muted">
                बॉक्स को खींचकर सिर्फ़ स्क्रीन के अंकों के चारों ओर रखें। कोनों से छोटा-बड़ा करें।
              </p>
              <CropEditor src={preview} naturalWidth={photo.width} naturalHeight={photo.height} box={box} onChange={setBox} label="स्क्रीन के चारों ओर बॉक्स" />
            </>
          ) : null}

          {step === "reading" ? (
            <div role="status" aria-live="polite" className="tile space-y-3 rounded-card p-4">
              <div className="flex items-center gap-3">
                <span className="st-spinner h-6 w-6 shrink-0 rounded-full border-2 border-line border-t-brand" aria-hidden />
                <p lang="hi" className="text-sm text-ink">
                  {aiPhase === "second" ? "दूसरी बार मिलाकर देख रहे हैं…" : aiPending ? "फ़ोन और AI से अंक पढ़ रहे हैं…" : "अंक पढ़ रहे हैं…"}
                </p>
              </div>
              {slow && aiPending ? (
                <Button variant="ghost" size="sm" onClick={stopWaitingForAi}>
                  <span lang="hi">AI का इंतज़ार न करें, फ़ोन का नतीजा दिखाएँ</span>
                </Button>
              ) : null}
            </div>
          ) : null}

          {step === "failed" ? (
            <div className="space-y-3">
              <div className="tile space-y-2 rounded-card p-4">
                <p lang="hi" className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <AlertTriangle aria-hidden className="h-4 w-4 text-attention" />
                  {aiView?.blocked ? "इस फोटो से अंक नहीं भरे गए" : "अंक साफ़ नहीं पढ़े जा सके"}
                </p>
                {aiView?.blocked ? null : (
                  <ul lang="hi" className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
                    <li>स्क्रीन को फोटो में बड़ा और सीधा रखें (बॉक्स उसी के चारों ओर)।</li>
                    <li>रोशनी की चमक स्क्रीन पर न पड़े; फ़्लैश बंद रखें।</li>
                    <li>फोटो हिले नहीं; ज़रूरत हो तो दोबारा लें।</li>
                  </ul>
                )}
              </div>
              {aiView ? <ReasonList reasons={aiView.reasons} hide={["unreadable"]} /> : null}
            </div>
          ) : null}

          {step === "result" && aiMode ? (
            <div className="space-y-4">
              {marked || preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- the person's own photo, just taken
                <img src={marked || preview} alt={marked ? "आपकी फोटो; पढ़े गए अंकों के चारों ओर हरे बॉक्स" : "आपकी खींची हुई फोटो"} className="block w-full rounded-card" />
              ) : null}
              {aiPending ? (
                <div role="status" aria-live="polite" className="tile flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card p-3">
                  <span className="st-spinner h-5 w-5 shrink-0 rounded-full border-2 border-line border-t-brand" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span lang="hi" className="block text-sm text-ink">
                      {aiPhase === "second" ? "दूसरी बार मिलाकर देख रहे हैं…" : "AI से मिलान हो रहा है; तब तक फ़ोन का नतीजा नीचे है।"}
                    </span>
                    <span lang="en" className="block text-xs text-ink-muted">
                      Checking with AI; what the phone read is below.
                    </span>
                  </span>
                  {slow ? (
                    <Button variant="ghost" size="sm" onClick={stopWaitingForAi}>
                      <span lang="hi">AI का इंतज़ार न करें</span>
                    </Button>
                  ) : null}
                </div>
              ) : readers ? (
                <p lang="hi" className="flex items-start gap-1.5 text-xs text-ink-muted">
                  <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>पढ़ने वाले: {readers}। फोटो हमारे यहाँ सेव नहीं हुई। हर अंक मशीन से मिलाकर ही भरें।</span>
                </p>
              ) : null}
              {aiView ? <ReasonList reasons={aiView.reasons} /> : null}
              {aiView && aiView.deviceUsed && (aiView.providers.length === 0 || !aiView.deviceAgrees) && notes.length > 0 ? (
                <ul lang="hi" className="space-y-1 text-xs text-ink-muted">
                  {notes.map((n) => (
                    <li key={n}>• {n}</li>
                  ))}
                </ul>
              ) : null}
              {kind === "bp" ? (
                <div className="space-y-3">
                  <ReadField label="ऊपर वाला" hint="Systolic" value={texts.systolic} onChange={(v) => edit("systolic", v)} fill={aiView?.fields.systolic} blocked={aiView?.blocked} maxLength={3} />
                  <ReadField label="नीचे वाला" hint="Diastolic" value={texts.diastolic} onChange={(v) => edit("diastolic", v)} fill={aiView?.fields.diastolic} blocked={aiView?.blocked} maxLength={3} />
                  <ReadField label="नब्ज़" hint="Pulse" value={texts.pulse} onChange={(v) => edit("pulse", v)} fill={aiView?.fields.pulse} blocked={aiView?.blocked} maxLength={3} />
                </div>
              ) : (
                <ReadField
                  label="वजन (kg)"
                  hint={decimalAssumed && !aiView?.deviceAgrees ? "फ़ोन ने दशमलव अपने-आप माना है" : undefined}
                  value={texts.kg}
                  onChange={(v) => edit("kg", v)}
                  fill={aiView?.fields.kg}
                  blocked={aiView?.blocked}
                  maxLength={6}
                  allowDecimal
                />
              )}
              <div>
                <Button variant="ghost" size="sm" onClick={() => leaveTo("crop")}>
                  <ScanLine aria-hidden className="h-4 w-4" />
                  <span lang="hi">अंक गलत लगें तो बॉक्स ठीक करके फिर पढ़ें</span>
                </Button>
              </div>
            </div>
          ) : null}

          {step === "result" && !aiMode && result?.reading ? (
            <div className="space-y-4">
              {marked ? (
                // eslint-disable-next-line @next/next/no-img-element -- the person's own photo, just taken
                <img src={marked} alt="पढ़े गए अंकों के चारों ओर हरे बॉक्स" className="block w-full rounded-card" />
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={confidence >= 0.7 ? "positive" : "attention"}>{confidence >= 0.7 ? "साफ़ पढ़ा गया" : "जाँच लें"}</Badge>
                <span lang="hi" className="text-xs text-ink-muted">
                  हरे बॉक्स में जो दिखा, वही नीचे भरा है। मशीन से मिलाकर ज़रूरत हो तो सुधारें।
                </span>
              </div>
              {notes.length > 0 ? (
                <ul lang="hi" className="space-y-1 text-xs text-ink-muted">
                  {notes.map((n) => (
                    <li key={n}>• {n}</li>
                  ))}
                </ul>
              ) : null}
              {kind === "bp" ? (
                <div className="grid grid-cols-3 gap-3">
                  <Field label="ऊपर वाला" hint="Systolic">
                    <NumberInput value={texts.systolic} maxLength={3} onChange={(e) => edit("systolic", e.target.value)} className="text-center text-xl font-semibold" />
                  </Field>
                  <Field label="नीचे वाला" hint="Diastolic">
                    <NumberInput value={texts.diastolic} maxLength={3} onChange={(e) => edit("diastolic", e.target.value)} className="text-center text-xl font-semibold" />
                  </Field>
                  <Field label="नब्ज़" hint="Pulse">
                    <NumberInput value={texts.pulse} maxLength={3} onChange={(e) => edit("pulse", e.target.value)} className="text-center text-xl font-semibold" />
                  </Field>
                </div>
              ) : (
                <Field label="वजन (kg)" hint={result.kind === "weight" && result.reading.decimalAssumed ? "दशमलव अपने-आप माना गया है" : undefined}>
                  <NumberInput allowDecimal value={texts.kg} maxLength={6} onChange={(e) => edit("kg", e.target.value)} className="text-center text-2xl font-semibold" />
                </Field>
              )}
            </div>
          ) : null}
        </div>
      </Modal>

      {/* The first time a photo is taken and the family was never asked: while this is open the phone's reader is used. */}
      <AiConsentDialog
        isOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        patientId={patientId}
        need="photos"
        onDecided={(granted) => {
          // Yes: read this very photo again, now with AI. No: stay on the box-and-read flow already on screen.
          if (granted && photo && stepRef.current === "crop") void runReader("first", photo, { ai: true });
        }}
      />
    </>
  );
}
