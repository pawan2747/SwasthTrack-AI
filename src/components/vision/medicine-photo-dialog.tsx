"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, ClipboardPaste, FileText, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { useOnline } from "@/components/layout/offline-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, TextArea, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { CropEditor } from "@/components/vision/crop-editor";
import { PhotoPicker } from "@/components/vision/photo-picker";
import { ReasonList } from "@/components/vision/photo-read-parts";
import { useAuth } from "@/context/auth-context";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { notifyMedicinesChanged } from "@/hooks/use-medicine-marking";
import { MEAL_RELATIONS, MEDICINE_FREQUENCIES, MEDICINE_PHOTO_SAFETY, normalizeMealRelation } from "@/lib/medicine-format";
import { parseMedicineText } from "@/lib/medicine-parse";
import type { MedicineReadData, MedicineRowData, ReasonCode } from "@/lib/vision/ai-contract";
import { aiPlan } from "@/lib/vision/display-fill";
import { cropCanvas, decodePhoto, previewDataUrl, type CropBox } from "@/lib/vision/image";
import {
  SLOT_LABEL_EN,
  SLOT_LABEL_HI,
  TIME_CHIPS,
  coerceMedicineData,
  findDuplicate,
  mapMedicineItems,
  missingFromPrescription,
  type ExistingMedicine,
} from "@/lib/vision/medicine-map";
import { addMedicine, getMedicines } from "@/services/patient-service";
import {
  getVisionAiStatus,
  isConsentProblem,
  newRequestId,
  peekVisionAiStatus,
  readPhotoWithAi,
  type AiUnavailableReason,
  type VisionAiStatus,
} from "@/services/vision-ai-service";

// ---- who may use the photo path --------------------------------------------------------------------

/**
 * Whether this person is offered the PHOTO way in: AI exists here and can read medicine photos, the family has
 * not switched photo reading off, there is a connection, and the person may write. A prescription or a strip
 * cannot be read on the phone (there is no on-device reader for text), so when this is false the photo way is
 * simply not shown; the typed / pasted text way never depends on it.
 */
export function useMedicinePhotoOffer(patientId: string | null): { photoOffered: boolean; photos: boolean | null; canChange: boolean; loading: boolean; refresh: () => Promise<void> } {
  const { canWrite } = useAuth();
  // A null patient (the form is editing, not adding) asks the server nothing.
  const ai = useAiSettings(patientId);
  const online = useOnline();
  const [vision, setVision] = useState<VisionAiStatus | null>(() => (patientId ? peekVisionAiStatus(patientId) : null));

  useEffect(() => {
    if (!patientId || !ai.available) return;
    let alive = true;
    void getVisionAiStatus(patientId).then((status) => {
      if (alive) setVision(status);
    });
    return () => {
      alive = false;
    };
  }, [ai.available, patientId]);

  const kindLive = ai.available && vision !== null && vision.available && vision.kinds.includes("medicine");
  const photos = ai.settings?.photos ?? null;
  return {
    photoOffered: canWrite && kindLive && photos !== false && online,
    photos,
    canChange: ai.canChange,
    loading: ai.loading || (ai.available && vision === null),
    refresh: ai.refresh,
  };
}

// ---- copy -------------------------------------------------------------------------------------------

const TIP_HI = "दवाई की स्ट्रिप, डिब्बे या डॉक्टर की पर्ची की सीधी, साफ़ और रोशनी वाली फोटो लें। एक बार में पूरी पर्ची की फोटो ठीक है।";
const HINT_WILL_ASK = "फोटो पढ़ने से पहले पूछा जाएगा कि AI से पढ़वाना है या नहीं; हाँ कहने तक कुछ नहीं भेजा जाता।";
const HINT_SENDS = "फोटो इंटरनेट से AI सेवा को पढ़ने के लिए भेजी जाती है और हमारे यहाँ सेव नहीं होती। पर्ची में नाम, पता या फ़ोन नंबर हों तो अगले कदम पर उतना हिस्सा बाहर रखें।";

const FAILURE_COPY: Record<AiUnavailableReason | "empty", { hi: string; en: string }> = {
  signed_out: { hi: "फिर से साइन-इन करें, फिर कोशिश करें।", en: "Please sign in again." },
  forbidden: { hi: "इस खाते से फोटो AI से नहीं पढ़ी जा सकती।", en: "This account cannot use photo reading." },
  view_only: { hi: "इस खाते से फोटो AI से नहीं पढ़ी जा सकती।", en: "This account cannot use photo reading." },
  consent_off: { hi: "इस परिवार ने फोटो AI से पढ़वाना बंद रखा है।", en: "Photo reading by AI is switched off for this family." },
  consent_unasked: { hi: "फोटो AI से पढ़वाने की अनुमति अभी नहीं दी गई है।", en: "Photo reading by AI has not been allowed yet." },
  too_large: { hi: "फोटो बहुत बड़ी है; थोड़ी दूर से या छोटा हिस्सा चुनकर लें।", en: "The photo is too large." },
  bad_request: { hi: "यह फोटो पढ़ी नहीं जा सकी; दूसरी फोटो लें।", en: "This photo could not be read." },
  rate_limited: { hi: "अभी AI की सीमा पूरी है; थोड़ी देर बाद कोशिश करें।", en: "The AI limit is reached for now; try again later." },
  ai_unavailable: { hi: "AI अभी पर्ची नहीं पढ़ पाया।", en: "AI could not read the prescription right now." },
  offline: { hi: "इंटरनेट नहीं है।", en: "You are offline." },
  network: { hi: "इंटरनेट की दिक्कत से फोटो भेजी नहीं जा सकी।", en: "The photo could not be sent." },
  timeout: { hi: "AI ने समय पर जवाब नहीं दिया।", en: "AI took too long to answer." },
  cancelled: { hi: "पढ़ना रोक दिया गया।", en: "Reading was stopped." },
  bad_answer: { hi: "AI का जवाब समझ नहीं आया।", en: "The answer could not be understood." },
  error: { hi: "फोटो पढ़ी नहीं जा सकी।", en: "The photo could not be read." },
  empty: { hi: "इस फोटो से कोई दवाई साफ़ नहीं पढ़ी जा सकी।", en: "No medicine could be read clearly from this photo." },
};

// ---- the dialog ---------------------------------------------------------------------------------------

type DialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  /** Called after at least one medicine was saved (the caller refreshes its list / shows its confirmation). */
  onDone?: (savedCount: number) => void;
};

type Step = "pick" | "crop" | "reading" | "review" | "failed";

/** What the person may change on one row before it is saved. */
interface RowEdit {
  include: boolean;
  name: string;
  dose: string;
  meal: string;
  frequency: string;
  time: string;
}

const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLOW_AFTER_MS = 9_000;
/** The route's own budget is 22 s; handwriting and small print are slower than a display. */
const READ_TIMEOUT_MS = 26_000;

/**
 * Photo (or pasted text) of a prescription / medicine strip -> reviewed medicine rows.
 *
 * Nothing is saved or ticked for the person: every row starts unticked, names are shown exactly as read, the
 * time of each dose is always chosen by the person, and the original photo stays beside the rows. Medicines
 * that are already in the list are flagged, and a medicine of the family that this prescription does not list
 * only gets a neutral note: it is never switched off here.
 */
export function MedicinePhotoDialog(props: DialogProps) {
  // Mounted only while open, so every opening starts at the first step.
  return props.isOpen ? <MedicinePhotoDialogBody {...props} /> : null;
}

function MedicinePhotoDialogBody({ isOpen, onClose, patientId, onDone }: DialogProps) {
  const { canWrite } = useAuth();
  const offer = useMedicinePhotoOffer(patientId);
  const online = useOnline();

  const [step, setStep] = useState<Step>("pick");
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [cropPreview, setCropPreview] = useState("");
  const [box, setBox] = useState<CropBox>({ x: 0, y: 0, width: 1, height: 1 });
  /** The part that was read (what the thumbnail beside the rows shows). */
  const [readPreview, setReadPreview] = useState("");
  const [bigPhoto, setBigPhoto] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [text, setText] = useState("");
  const [data, setData] = useState<MedicineReadData | null>(null);
  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [skippedLines, setSkippedLines] = useState(0);
  const [failure, setFailure] = useState<AiUnavailableReason | "empty" | null>(null);
  const [slow, setSlow] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [existing, setExisting] = useState<ExistingMedicine[]>([]);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const decodingRef = useRef(false);
  const readingRef = useRef(false);
  const pendingModeRef = useRef<"whole" | "box">("whole");
  /** Rows saved (or being saved) for this photo: a double tap or a retry never adds a row twice. */
  const savedRef = useRef<Set<string>>(new Set());
  const savingRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      // Closing the dialog abandons a read in flight: it is cancelled and nothing is shown.
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // The family's own list, to flag rows that are already in it. A failed read just means no flags.
  useEffect(() => {
    let alive = true;
    getMedicines(patientId)
      .then((list) => {
        if (alive) setExisting(list.map((m) => ({ id: m.id, medicine_name: m.medicine_name, dose: m.dose, active: m.active })));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [patientId]);

  // A slow read: after a few seconds the person may stop waiting.
  useEffect(() => {
    if (step !== "reading") return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [step]);

  const plan = aiPlan({
    offered: offer.photoOffered,
    photos: offer.photos,
    canChange: offer.canChange,
    online,
    loading: offer.loading,
  });

  const hint = offer.photos === true ? HINT_SENDS : offer.photos === null && offer.canChange ? HINT_WILL_ASK : undefined;

  /** Abandons the read in flight: its answer is ignored and its request is cancelled. */
  function cancelRead() {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    readingRef.current = false;
  }

  function goBack(next: Step) {
    cancelRead();
    setError("");
    setSlow(false);
    setStep(next);
  }

  // ---- entering the review ----------------------------------------------------------------------

  function openReview(result: MedicineReadData, why: ReasonCode[], skipped: number, preview: string) {
    const start: Record<string, RowEdit> = {};
    for (const row of result.medicines) {
      start[row.key] = {
        include: false,
        name: row.name,
        dose: row.dose,
        meal: row.mealRelation ?? "",
        frequency: row.frequency,
        time: "",
      };
    }
    savedRef.current = new Set();
    setSaved({});
    setInvalid({});
    setError("");
    setEdits(start);
    setData(result);
    setReasons(why);
    setSkippedLines(skipped);
    setReadPreview(preview);
    setBigPhoto(false);
    setStep("review");
  }

  // ---- the photo way -----------------------------------------------------------------------------

  async function handlePhoto(file: File) {
    // A second pick while the first is still being decoded is a double tap.
    if (decodingRef.current || readingRef.current) return;
    decodingRef.current = true;
    setDecoding(true);
    setError("");
    try {
      // 2048 px: small print needs the pixels. It is re-encoded to the 1.8 MB budget before it is sent.
      const canvas = await decodePhoto(file, 2048);
      if (!aliveRef.current) return;
      setPhoto(canvas);
      setCropPreview(previewDataUrl(canvas, 1200));
      setBox({ x: 0, y: 0, width: canvas.width, height: canvas.height });
      setStep("crop");
    } catch (err) {
      setError(err instanceof Error && /[ऀ-ॿ]/.test(err.message) ? err.message : "फोटो खोली नहीं जा सकी। दूसरी फोटो लें।");
    } finally {
      decodingRef.current = false;
      setDecoding(false);
    }
  }

  /** The tap on "read": asks the family first if they were never asked, otherwise reads. */
  function requestRead(mode: "whole" | "box") {
    if (!photo || readingRef.current) return;
    pendingModeRef.current = mode;
    // Never asked: every tap on "read" asks (nothing is sent until the family says yes); never on opening.
    if (plan === "ask") {
      setConsentOpen(true);
      return;
    }
    if (plan !== "ai") {
      showFailure(!online ? "offline" : offer.photos === false ? "consent_off" : "ai_unavailable");
      return;
    }
    void runRead(mode);
  }

  function showFailure(reason: AiUnavailableReason | "empty", why: ReasonCode[] = []) {
    readingRef.current = false;
    setReasons(why);
    setFailure(reason);
    setStep("failed");
  }

  async function runRead(mode: "whole" | "box") {
    if (!photo || readingRef.current) return;
    cancelRead();
    readingRef.current = true;
    const run = runRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => aliveRef.current && run === runRef.current;
    setError("");
    setSlow(false);
    setStep("reading");

    const region = mode === "box" ? cropCanvas(photo, box) : photo;
    const preview = previewDataUrl(region, 900);
    const result = await readPhotoWithAi({ patientId, kind: "medicine", canvas: region, requestId: newRequestId(), signal: controller.signal, timeoutMs: READ_TIMEOUT_MS });
    if (!current()) return;
    readingRef.current = false;

    if (result.status !== "ok") {
      if (result.reason === "cancelled") {
        setStep("crop");
        return;
      }
      // A stale switch (changed on another phone) is re-read so the next screen tells the truth.
      if (isConsentProblem(result.reason)) void offer.refresh();
      showFailure(result.reason);
      return;
    }
    const parsed = coerceMedicineData(result.data);
    if (!parsed) {
      showFailure("bad_answer");
      return;
    }
    if (parsed.medicines.length === 0) {
      showFailure("empty", result.reasons);
      return;
    }
    openReview(parsed, result.reasons, 0, preview);
  }

  // ---- the text way ------------------------------------------------------------------------------

  function readTypedText() {
    const parsed = parseMedicineText(text);
    const mapped = mapMedicineItems(parsed.items, { source: "typed", handwritten: false, partial: false, truncated: parsed.truncated });
    if (mapped.data.medicines.length === 0) {
      setError("इस पाठ में कोई दवाई नहीं मिली। हर दवाई नई लाइन में लिखें, जैसे: Tab Telma 40 mg 1-0-1 खाने के बाद");
      return;
    }
    const why: ReasonCode[] = mapped.truncated ? ["partial_list"] : [];
    openReview(mapped.data, why, parsed.skipped + mapped.dropped, "");
  }

  // ---- review rows -------------------------------------------------------------------------------

  const rows = useMemo(() => data?.medicines ?? [], [data]);
  const duplicates = useMemo(() => {
    const out: Record<string, { id: string; active: boolean }> = {};
    for (const row of rows) {
      const hit = findDuplicate({ name: edits[row.key]?.name ?? row.name, strength: row.strength }, existing);
      if (hit) out[row.key] = hit;
    }
    return out;
  }, [rows, edits, existing]);

  const missing = useMemo(() => {
    const prescription = data?.source === "prescription_printed" || data?.source === "prescription_handwritten";
    if (!prescription || reasons.includes("partial_list") || rows.length === 0) return [];
    return missingFromPrescription(existing, rows.map((r) => ({ name: edits[r.key]?.name ?? r.name, strength: r.strength })));
  }, [data, reasons, rows, existing, edits]);

  const ticked = rows.filter((r) => edits[r.key]?.include && !saved[r.key]);
  const anyDuration = rows.some((r) => r.durationText);

  function edit(key: string, patch: Partial<RowEdit>) {
    setEdits((all) => ({ ...all, [key]: { ...all[key], ...patch } }));
    if (invalid[key]) setInvalid((all) => ({ ...all, [key]: false }));
  }

  async function save() {
    if (savingRef.current || !canWrite) return;
    const chosen = rows.filter((r) => edits[r.key]?.include && !savedRef.current.has(r.key));
    if (chosen.length === 0) {
      setError("जोड़ने के लिए कम से कम एक दवाई पर टिक करें।");
      return;
    }
    const bad: Record<string, boolean> = {};
    for (const r of chosen) {
      const e = edits[r.key];
      if (!e.name.trim() || !e.dose.trim() || !TIME_24H.test(e.time)) bad[r.key] = true;
    }
    if (Object.keys(bad).length > 0) {
      setInvalid(bad);
      setError("टिक की हुई हर दवाई में नाम, खुराक और लेने का समय भरें।");
      requestAnimationFrame(() => document.getElementById(`med-row-${chosen.find((r) => bad[r.key])?.key}`)?.scrollIntoView({ block: "center" }));
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    let added = 0;
    try {
      for (const r of chosen) {
        const e = edits[r.key];
        if (savedRef.current.has(r.key)) continue;
        // Marked before the request: a second tap or a retry cannot add this row again.
        savedRef.current.add(r.key);
        try {
          await addMedicine({
            patient_id: patientId,
            medicine_name: e.name.trim(),
            dose: e.dose.trim(),
            scheduled_time: `${e.time}:00`,
            meal_relation: normalizeMealRelation(e.meal) ?? null,
            frequency: e.frequency || "daily",
            active: true,
          });
        } catch {
          savedRef.current.delete(r.key);
          throw new Error("save");
        }
        added += 1;
        if (aliveRef.current) setSaved((all) => ({ ...all, [r.key]: true }));
      }
      notifyMedicinesChanged(patientId);
      if (aliveRef.current) {
        onDone?.(savedRef.current.size);
        onClose();
      }
    } catch {
      if (added > 0) notifyMedicinesChanged(patientId);
      if (aliveRef.current) {
        setError(
          added > 0
            ? `${added} दवाइयाँ जुड़ गईं; बाकी नहीं जुड़ पाईं। इंटरनेट जाँचकर फिर "जोड़ें" दबाएँ।`
            : "दवाई सेव नहीं हो पाई। इंटरनेट जाँचकर दोबारा कोशिश करें।",
        );
      }
    } finally {
      savingRef.current = false;
      if (aliveRef.current) setSaving(false);
    }
  }

  function closeAll() {
    cancelRead();
    // Rows that were already saved: tell the caller so its list refreshes.
    if (savedRef.current.size > 0) onDone?.(savedRef.current.size);
    onClose();
  }

  // ---- footer ----------------------------------------------------------------------------------

  const footer =
    step === "crop" ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={() => goBack("pick")}>
          <RefreshCw aria-hidden className="h-4 w-4" />
          <span lang="hi">दूसरी फोटो</span>
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => requestRead("whole")}>
            <span lang="hi">पूरी फोटो पढ़ें</span>
          </Button>
          <Button variant="primary" onClick={() => requestRead("box")}>
            <ScanLine aria-hidden className="h-4 w-4" />
            <span lang="hi">बॉक्स के अंदर पढ़ें</span>
          </Button>
        </div>
      </div>
    ) : step === "failed" ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={closeAll}>
          <span lang="hi">हाथ से जोड़ूँगा</span>
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {photo ? (
            <Button variant="secondary" onClick={() => goBack("crop")}>
              <ScanLine aria-hidden className="h-4 w-4" />
              <span lang="hi">बॉक्स ठीक करके फिर पढ़ें</span>
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => goBack("pick")}>
            <RefreshCw aria-hidden className="h-4 w-4" />
            <span lang="hi">दूसरी फोटो या पाठ</span>
          </Button>
        </div>
      </div>
    ) : step === "review" ? (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" disabled={saving} onClick={() => goBack("pick")}>
          <RefreshCw aria-hidden className="h-4 w-4" />
          <span lang="hi">दोबारा शुरू करें</span>
        </Button>
        <Button variant="primary" loading={saving} disabled={!canWrite || ticked.length === 0} onClick={() => void save()}>
          <Check aria-hidden className="h-4 w-4" />
          <span lang="hi">{ticked.length > 0 ? `${ticked.length} दवाई जोड़ें` : "दवाई चुनें"}</span>
        </Button>
      </div>
    ) : undefined;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={saving ? () => undefined : closeAll}
        title="Add from a prescription"
        hindiTitle="पर्ची या फोटो से दवाइयाँ जोड़ें"
        size="lg"
        footer={footer}
        closeOnBackdrop={step !== "reading" && step !== "review"}
      >
        <div className="space-y-4">
          {!canWrite ? (
            <p role="status" lang="hi" className="rounded-card border border-info-line bg-info-soft p-3 text-sm text-info">
              आपके पास केवल देखने का एक्सेस है, इसलिए दवाई जोड़ी नहीं जा सकती।
            </p>
          ) : null}

          {error ? (
            <p role="alert" lang="hi" className="rounded-card border border-critical-line bg-critical-soft p-3 text-sm font-medium text-critical">
              {error}
            </p>
          ) : null}

          {step === "pick" ? (
            <>
              {offer.photoOffered ? (
                <section className="space-y-3" aria-labelledby="med-photo-way">
                  <h3 id="med-photo-way" className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Camera aria-hidden className="h-4 w-4" />
                    <span lang="hi">फोटो से</span>
                    <span lang="en" className="font-normal text-ink-muted">Photo</span>
                  </h3>
                  <p lang="hi" className="text-sm text-ink-muted">
                    {TIP_HI}
                  </p>
                  <PhotoPicker onPhoto={(f) => void handlePhoto(f)} busy={decoding} captureLabel="पर्ची या दवाई की फोटो लें" hint={hint} />
                </section>
              ) : null}

              <section className="space-y-3" aria-labelledby="med-text-way">
                <h3 id="med-text-way" className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <ClipboardPaste aria-hidden className="h-4 w-4" />
                  <span lang="hi">पर्ची का लिखा हुआ पाठ चिपकाएँ</span>
                  <span lang="en" className="font-normal text-ink-muted">Paste the text</span>
                </h3>
                <Field label="पर्ची का पाठ" hint="हर दवाई नई लाइन में, जैसे: Tab Telma 40 mg 1-0-1 खाने के बाद">
                  <TextArea
                    value={text}
                    maxLength={4000}
                    rows={5}
                    placeholder={"Tab Telma 40 mg 1-0-1 after food\nTab Metformin 500 BD PC\nTab Ecosprin 75 HS"}
                    onChange={(e) => {
                      setText(e.target.value);
                      if (error) setError("");
                    }}
                  />
                </Field>
                <p lang="hi" className="text-xs text-ink-muted">
                  यह पाठ फ़ोन पर ही पढ़ा जाता है; कहीं भेजा नहीं जाता।
                </p>
                <Button variant={offer.photoOffered ? "secondary" : "primary"} disabled={!text.trim() || !canWrite} onClick={readTypedText}>
                  <FileText aria-hidden className="h-4 w-4" />
                  <span lang="hi">पाठ से दवाइयाँ निकालें</span>
                </Button>
              </section>
            </>
          ) : null}

          {step === "crop" && photo ? (
            <>
              <p lang="hi" className="text-sm font-medium text-ink">
                सिर्फ़ दवाइयों वाली लाइनें चुनें; नाम, पता और फ़ोन नंबर बाहर रखें।
              </p>
              <p lang="en" className="text-xs text-ink-muted">
                Keep only the lines with the medicines inside the box; leave out names, addresses and phone numbers.
              </p>
              <CropEditor src={cropPreview} naturalWidth={photo.width} naturalHeight={photo.height} box={box} onChange={setBox} label="दवाइयों वाली लाइनों के चारों ओर बॉक्स" />
              <p lang="hi" className="flex items-start gap-1.5 text-xs text-ink-muted">
                <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>&ldquo;बॉक्स के अंदर पढ़ें&rdquo; दबाने पर सिर्फ़ बॉक्स का हिस्सा भेजा जाता है; &ldquo;पूरी फोटो पढ़ें&rdquo; पूरी फोटो भेजता है। फोटो हमारे यहाँ सेव नहीं होती।</span>
              </p>
            </>
          ) : null}

          {step === "reading" ? (
            <div role="status" aria-live="polite" className="tile space-y-3 rounded-card p-4">
              <div className="flex items-center gap-3">
                <span className="st-spinner h-6 w-6 shrink-0 rounded-full border-2 border-line border-t-brand" aria-hidden />
                <p lang="hi" className="text-sm text-ink">
                  पर्ची पढ़ रहे हैं…
                </p>
              </div>
              {slow ? (
                <Button variant="ghost" size="sm" onClick={() => (cancelRead(), setStep("crop"))}>
                  <span lang="hi">इंतज़ार न करें</span>
                </Button>
              ) : null}
            </div>
          ) : null}

          {step === "failed" && failure ? (
            <div className="space-y-3">
              <div className="tile space-y-2 rounded-card p-4">
                <p lang="hi" className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-attention" />
                  {FAILURE_COPY[failure].hi}
                </p>
                <p lang="en" className="text-xs text-ink-muted">
                  {FAILURE_COPY[failure].en}
                </p>
                <p lang="hi" className="text-xs text-ink-muted">
                  दवाई एक-एक करके जोड़ना या पर्ची का पाठ चिपकाना हमेशा चलता है।
                </p>
              </div>
              <ReasonList reasons={reasons.filter((r) => r !== "unreadable")} />
              {failure === "empty" ? (
                <ul lang="hi" className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
                  <li>पर्ची सीधी और रोशनी में लें; परछाईं न पड़े।</li>
                  <li>सिर्फ़ दवाइयों वाली लाइनें बॉक्स में रखें।</li>
                </ul>
              ) : null}
            </div>
          ) : null}

          {step === "review" && data ? (
            <ReviewBody
              rows={rows}
              edits={edits}
              saved={saved}
              invalid={invalid}
              duplicates={duplicates}
              missing={missing}
              reasons={reasons}
              skippedLines={skippedLines}
              anyDuration={anyDuration}
              preview={readPreview}
              big={bigPhoto}
              onBig={setBigPhoto}
              disabled={saving || !canWrite}
              onEdit={edit}
            />
          ) : null}
        </div>
      </Modal>

      {/* Asked only now, when a photo is about to be read and the family was never asked. */}
      <AiConsentDialog
        isOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        patientId={patientId}
        need="photos"
        onDecided={(granted) => {
          if (granted) void runRead(pendingModeRef.current);
          else showFailure("consent_off");
        }}
      />
    </>
  );
}

// ---- the review screen -----------------------------------------------------------------------------

function ReviewBody({
  rows,
  edits,
  saved,
  invalid,
  duplicates,
  missing,
  reasons,
  skippedLines,
  anyDuration,
  preview,
  big,
  onBig,
  disabled,
  onEdit,
}: {
  rows: MedicineRowData[];
  edits: Record<string, RowEdit>;
  saved: Record<string, boolean>;
  invalid: Record<string, boolean>;
  duplicates: Record<string, { id: string; active: boolean }>;
  missing: ExistingMedicine[];
  reasons: ReasonCode[];
  skippedLines: number;
  anyDuration: boolean;
  preview: string;
  big: boolean;
  onBig: (v: boolean) => void;
  disabled: boolean;
  onEdit: (key: string, patch: Partial<RowEdit>) => void;
}) {
  const list = (
    <div className="min-w-0 space-y-3">
      <p lang="hi" className="text-sm text-ink">
        {rows.length} पंक्तियाँ मिलीं। हर दवाई को पर्ची से मिलाएँ, ठीक लगे तो टिक करें और लेने का समय चुनें।
      </p>
      <p lang="en" className="text-xs text-ink-muted">
        Nothing is added until you tick a row and choose its time.
      </p>
      <ReasonList reasons={reasons} />
      {skippedLines > 0 ? (
        <p lang="hi" className="text-xs text-ink-muted">
          {skippedLines} पंक्तियाँ दवाई नहीं लगीं या साफ़ नहीं थीं और छोड़ दी गईं; ज़रूरत हो तो उन्हें हाथ से जोड़ें।
        </p>
      ) : null}
      {anyDuration ? (
        <p lang="hi" className="text-xs text-ink-muted">
          पर्ची में लिखी अवधि (जैसे &ldquo;5 दिन&rdquo;) सिर्फ़ यहाँ दिखाई जाती है, ऐप में सेव नहीं होती।
        </p>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.key}>
            <RowEditor row={row} edit={edits[row.key]} saved={saved[row.key] === true} invalid={invalid[row.key] === true} duplicate={duplicates[row.key] ?? null} disabled={disabled} onEdit={(patch) => onEdit(row.key, patch)} />
          </li>
        ))}
      </ul>

      {missing.length > 0 ? (
        <div className="tile space-y-1 rounded-card p-3">
          <p lang="hi" className="text-sm font-medium text-ink">
            सूची की ये दवाइयाँ इस फोटो में नहीं दिखीं
          </p>
          <p lang="hi" className="text-xs text-ink-muted">
            सूची में कुछ बदला नहीं गया है। बदलाव करना हो तो पर्ची देखकर या डॉक्टर से पूछकर हाथ से करें।
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {missing.map((m) => (
              <Badge key={m.id} variant="neutral">
                {m.medicine_name}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <p lang="hi" className="flex items-start gap-1.5 text-xs text-ink-muted">
        <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {MEDICINE_PHOTO_SAFETY.hi}
          <span lang="en" className="block">
            {MEDICINE_PHOTO_SAFETY.en}
          </span>
        </span>
      </p>
    </div>
  );

  if (!preview) return list;

  return (
    <div className="space-y-3 sm:grid sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:items-start sm:gap-4 sm:space-y-0">
      <div className="space-y-2 sm:sticky sm:top-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- the person's own photo, just taken */}
        <img
          src={preview}
          alt="आपकी खींची हुई पर्ची या दवाई की फोटो"
          className={big ? "block max-h-[60dvh] w-full rounded-card bg-surface-sunken object-contain" : "block max-h-28 w-full rounded-card bg-surface-sunken object-cover object-top sm:max-h-64 sm:object-contain"}
        />
        <Button variant="ghost" size="sm" className="sm:hidden" onClick={() => onBig(!big)}>
          <span lang="hi">{big ? "फोटो छोटी करें" : "फोटो बड़ी देखें"}</span>
        </Button>
      </div>
      {list}
    </div>
  );
}

function RowEditor({
  row,
  edit,
  saved,
  invalid,
  duplicate,
  disabled,
  onEdit,
}: {
  row: MedicineRowData;
  edit: RowEdit;
  saved: boolean;
  invalid: boolean;
  duplicate: { id: string; active: boolean } | null;
  disabled: boolean;
  onEdit: (patch: Partial<RowEdit>) => void;
}) {
  if (!edit) return null;
  const lock = disabled || saved;
  const sig = [row.sigText, row.durationText].filter(Boolean).join(" · ");
  const nameMissing = invalid && !edit.name.trim();
  const doseMissing = invalid && !edit.dose.trim();
  const timeMissing = invalid && !TIME_24H.test(edit.time);

  return (
    <div id={`med-row-${row.key}`} className="tile space-y-3 rounded-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-control cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={edit.include || saved}
            disabled={lock}
            onChange={(e) => onEdit({ include: e.target.checked })}
            className="h-5 w-5 shrink-0 accent-brand"
          />
          <span lang="hi" className="text-sm font-semibold text-ink">
            {saved ? "जुड़ गई" : "यह दवाई जोड़ें"}
          </span>
        </label>
        {row.slot ? (
          <Badge variant="info">
            <span lang="hi">{SLOT_LABEL_HI[row.slot]} की खुराक</span>
          </Badge>
        ) : row.doseOf > 0 ? (
          <Badge variant="info">
            <span lang="hi">खुराक {row.doseNo}/{row.doseOf}</span>
          </Badge>
        ) : row.frequency === "as needed" ? (
          <Badge variant="info">
            <span lang="hi">ज़रूरत पड़ने पर</span>
          </Badge>
        ) : null}
        {duplicate ? (
          <Badge variant="neutral">
            <span lang="hi">{duplicate.active ? "सूची में पहले से है" : "सूची में है (बंद की हुई)"}</span>
          </Badge>
        ) : null}
        {row.check ? (
          <Badge variant="attention">
            <span lang="hi">पर्ची से मिलाएँ</span>
          </Badge>
        ) : null}
      </div>

      {duplicate ? (
        <p lang="hi" className="text-xs text-ink-muted">
          यह नाम सूची में पहले से है। दोबारा जोड़ना हो तभी टिक करें।
        </p>
      ) : null}

      <Field label="दवाई का नाम (Medicine name)" error={nameMissing ? "नाम लिखें" : undefined} hint={row.genericName ? `जेनेरिक नाम: ${row.genericName}` : undefined}>
        <TextInput type="text" autoComplete="off" maxLength={80} value={edit.name} disabled={lock} onChange={(e) => onEdit({ name: e.target.value })} />
      </Field>

      {sig ? (
        <p className="text-xs text-ink-muted">
          <span lang="hi">पर्ची में लिखा: </span>
          <span className="text-ink">{sig}</span>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="खुराक (Dose)"
          error={doseMissing ? "खुराक लिखें, जैसे 40 mg" : undefined}
          hint={!edit.dose.trim() && row.count !== null && row.count !== 1 ? `पर्ची में हर बार ${row.count}` : "जैसे 40 mg, 1 टैबलेट"}
        >
          <TextInput type="text" autoComplete="off" maxLength={40} value={edit.dose} disabled={lock} onChange={(e) => onEdit({ dose: e.target.value })} />
        </Field>
        <Field label="भोजन से संबंध (Meal relation)">
          <Select value={edit.meal} disabled={lock} onChange={(e) => onEdit({ meal: e.target.value })}>
            <option value="">निर्देश नहीं (Not specified)</option>
            {MEAL_RELATIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.hi} ({m.en})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="कितनी बार (Frequency)">
        <Select value={edit.frequency} disabled={lock} onChange={(e) => onEdit({ frequency: e.target.value })}>
          {MEDICINE_FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.hi} ({f.en})
            </option>
          ))}
        </Select>
      </Field>

      <Field label="लेने का समय (Time)" group error={timeMissing ? "समय चुनें" : undefined} hint="समय आपको चुनना है; पर्ची में जो समय का हिस्सा लिखा है वह ऊपर बताया गया है।">
        <div className="space-y-2">
          <div role="group" aria-label="लेने का समय चुनें" className="flex flex-wrap gap-2">
            {TIME_CHIPS.map((chip) => {
              const selected = edit.time === chip.time;
              return (
                <Button key={chip.time} size="sm" variant={selected ? "primary" : "secondary"} aria-pressed={selected} disabled={lock} onClick={() => onEdit({ time: selected ? "" : chip.time })}>
                  <span lang="hi" className="text-xs font-normal">
                    {SLOT_LABEL_HI[chip.slot]}
                  </span>
                  <span className="tabular text-sm">{chip.time}</span>
                  <span className="sr-only">{SLOT_LABEL_EN[chip.slot]}</span>
                </Button>
              );
            })}
          </div>
          <TextInput type="time" aria-label="दूसरा समय (Other time)" value={edit.time} disabled={lock} onChange={(e) => onEdit({ time: e.target.value })} />
        </div>
      </Field>
    </div>
  );
}
