/**
 * Pure cases for the browser side of AI photo reading: what the normaliser lets through, how readers
 * are reconciled, what is put in a form field (and what is held back), the upload plan and the way the
 * client service classifies every failure. No server, no database, no network: the one HTTP case uses
 * a fake `fetch`.
 */

import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { DEFAULT_BP_THRESHOLDS, classifyBP } from "@/lib/health-rules";
import type { BpModelRead, BpReading, ReasonCode, WeightModelRead, WeightReading } from "@/lib/vision/ai-contract";
import { normalizeBp, normalizeWeight } from "@/lib/vision/ai-normalize";
import type { BPReading } from "@/lib/vision/bp-reader";
import { needsSecondOpinion, prefillable, reconcileBp, reconcileWeight, type FieldVote, type ReadSource } from "@/lib/vision/consensus";
import type { DisplayReadResult } from "@/lib/vision/display-reader";
import type { WeightReading as DeviceWeightReading } from "@/lib/vision/weight-reader";
import { visionHandler } from "../vision";
import {
  HINT_AI_OFF,
  HINT_DEVICE_ONLY,
  HINT_OFFLINE,
  HINT_SENDS,
  HINT_WILL_ASK,
  aiPlan,
  applyResolution,
  deviceReadingOf,
  isAlarmingAlone,
  photoPrivacyHint,
  resolveDisplay,
  sourcesLabelHi,
  stageFor,
  statusCopy,
  type AiRead,
  type FieldFill,
  type FieldTexts,
  type FillKey,
  type HintState,
} from "@/lib/vision/display-fill";
import { AI_PHOTO_BUDGET, base64ByteLength, encodeJpeg, jpegAttempts, stripDataUrlPrefix } from "@/lib/vision/image";
import {
  isConsentProblem,
  parseVisionAnswer,
  prepareImage,
  readDisplayWithAi,
  readPhotoWithAi,
  unavailableReasonFor,
  type DeviceOutcome,
  type DisplayProgress,
} from "@/services/vision-ai-service";

const bpRaw = (over: Partial<BpModelRead> = {}): BpModelRead => ({
  is_bp_monitor: true,
  systolic: 132,
  diastolic: 84,
  pulse: 71,
  seen_text: "132 84 71",
  display: "result",
  legibility: "clear",
  irregular_heartbeat_symbol: false,
  ...over,
});

const weightRaw = (over: Partial<WeightModelRead> = {}): WeightModelRead => ({
  is_scale_display: true,
  value: 72.4,
  unit: "kg",
  seen_text: "72.4",
  legibility: "clear",
  ...over,
});

const bp = (systolic: number | null, diastolic: number | null, pulse: number | null): BpReading => ({ systolic, diastolic, pulse });
const kg = (value: number | null): WeightReading => ({ kg: value });
const read = <T>(provider: ReadSource, data: T, reasons: ReasonCode[] = []): AiRead<T> => ({ provider, data, reasons });

const vsig = (v: FieldVote) => `${v.value}|${v.status}|${v.alternatives.join(",")}|${v.sources.join("+")}`;
const fsig = (f: FieldFill | undefined) =>
  f ? `${f.value}|${f.status}|${f.heldBack ? "held" : "-"}|${f.options.map((o) => `${o.value}:${o.sources.join("+")}`).join(",")}` : "none";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Runs `fn` with `fetch` replaced; always restores the real one. */
async function withFetch(fake: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
}

type Wire = Record<string, unknown>;
type Reply = { status: number; body: unknown };

/** A fake /api/vision/read: `handler` decides every answer from the request body and the call number. */
function visionFetch(handler: (body: Wire, n: number) => Reply, log: Wire[]): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Wire;
    log.push(body);
    const reply = handler(body, log.length);
    return jsonResponse(reply.status, reply.body);
  }) as typeof fetch;
}

const okBp = (provider: string, s: number | null, d: number | null, p: number | null, reasons: ReasonCode[] = []): Reply => ({
  status: 200,
  body: { requestId: "x", provider, model: "m", ms: 1, imageKind: "bp_monitor", reasons, data: { systolic: s, diastolic: d, pulse: p } },
});
const okWeight = (provider: string, value: number | null, reasons: ReasonCode[] = []): Reply => ({
  status: 200,
  body: { requestId: "x", provider, model: "m", ms: 1, imageKind: "weight_scale", reasons, data: { kg: value } },
});
const down = (status: number, code: string): Reply => ({ status, body: { error: "x", code } });

const PID = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const PHOTO = "/9j/".repeat(40);
const phone =
  (reading: BpReading | WeightReading | null): (() => Promise<DeviceOutcome<string>>) =>
  async () => ({ reading, raw: reading ? "phone-read" : "phone-nothing", failure: "" });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Like visionFetch, but each answer takes `ms` (a slow provider), and tells `onAnswer` when it is given. */
function slowVisionFetch(handler: (body: Wire, n: number) => Reply, log: Wire[], ms: number, onAnswer: () => void): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Wire;
    log.push(body);
    const reply = handler(body, log.length);
    await sleep(ms);
    onAnswer();
    return jsonResponse(reply.status, reply.body);
  }) as typeof fetch;
}

const NOBOX = { x0: 0, y0: 0, x1: 9, y1: 9 };
/** The reader on the phone's own result, as the dialog receives it. */
const phoneBpResult = (confidence: number, s = 130, d = 80, p: number | null = 70): DisplayReadResult => {
  const reading: BPReading = {
    systolic: s,
    diastolic: d,
    pulse: p,
    confidence,
    rank: 1,
    polarity: "dark",
    rotation: 0,
    boxes: { systolic: NOBOX, diastolic: NOBOX, pulse: p === null ? null : NOBOX },
    width: 100,
    height: 100,
    notes: [],
  };
  return { kind: "bp", reading, ms: 1 };
};
const phoneWeightResult = (confidence: number, value = 72.4): DisplayReadResult => {
  const reading: DeviceWeightReading = { kg: value, confidence, polarity: "dark", rotation: 0, box: NOBOX, width: 100, height: 100, decimalAssumed: false, notes: [] };
  return { kind: "weight", reading, ms: 1 };
};

/** A canvas with no pixels: just enough surface for the encoder (sizes and what it was drawn from / exported). */
interface FakeCanvas {
  width: number;
  height: number;
  drawn: unknown[];
  exportedAt: number[];
  getContext: () => { fillStyle: string; fillRect: () => void; drawImage: (src: unknown) => void };
  toDataURL: (type?: string, quality?: number) => string;
}
function fakeCanvas(width: number, height: number, bytesFor: (w: number, h: number, q: number) => number): FakeCanvas {
  const self: FakeCanvas = {
    width,
    height,
    drawn: [],
    exportedAt: [],
    getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: (src: unknown) => void self.drawn.push(src) }),
    toDataURL: (_type?: string, quality = 0.92) => {
      self.exportedAt.push(quality);
      const bytes = Math.max(3, Math.round(bytesFor(self.width, self.height, quality)));
      const chars = Math.ceil(bytes / 3) * 4;
      return `data:image/jpeg;base64,${"A".repeat(chars)}`;
    },
  };
  return self;
}

const asCanvas = (c: FakeCanvas): HTMLCanvasElement => c as unknown as HTMLCanvasElement;

/** Runs `fn` with a `document` that makes fake canvases; `made` lists every canvas the encoder created. */
async function withFakeDocument(bytesFor: (w: number, h: number, q: number) => number, fn: (made: FakeCanvas[]) => Promise<void>): Promise<void> {
  const holder = globalThis as { document?: unknown };
  const real = holder.document;
  const made: FakeCanvas[] = [];
  holder.document = { createElement: () => { const c = fakeCanvas(1, 1, bytesFor); made.push(c); return c; } };
  try {
    await fn(made);
  } finally {
    if (real === undefined) delete holder.document;
    else holder.document = real;
  }
}

export function visionClientCases(): EvalCase[] {
  const N = "vision normalise";
  const C = "vision consensus";
  const F = "vision fill";
  const S = "vision client";

  return [
    // ---- normaliser: what the model says -> what the app may show --------------------------------
    caseOf(N, "vn-bp-clean", "a clear finished BP reading passes through unchanged", (c) => {
      const n = normalizeBp(bpRaw());
      c.eq([n.data.systolic, n.data.diastolic, n.data.pulse], [132, 84, 71], "values");
      c.eq(n.imageKind, "bp_monitor", "image kind");
      c.eq(n.reasons, [], "no reasons");
    }),
    caseOf(N, "vn-bp-gates", "a display that is not a finished reading yields no numbers and a reason", (c) => {
      const cases: Array<[Partial<BpModelRead>, ReasonCode]> = [
        [{ display: "measuring" }, "measuring_in_progress"],
        [{ display: "memory" }, "memory_or_average"],
        [{ display: "average" }, "memory_or_average"],
        [{ display: "error" }, "error_code"],
        [{ display: "off" }, "unreadable"],
        [{ legibility: "poor" }, "unreadable"],
        [{ is_bp_monitor: false, systolic: 120, diastolic: 80 }, "not_bp_monitor"],
      ];
      for (const [over, reason] of cases) {
        const n = normalizeBp(bpRaw(over));
        c.eq(n.reasons, [reason], `reason for ${JSON.stringify(over)}`);
        c.eq([n.data.systolic, n.data.diastolic, n.data.pulse], [null, null, null], `no numbers for ${JSON.stringify(over)}`);
      }
    }),
    caseOf(N, "vn-bp-grounding", "a number the model cannot find in the text it says it read is dropped", (c) => {
      const n = normalizeBp(bpRaw({ systolic: 138, diastolic: 85, pulse: 70, seen_text: "130 85 70" }));
      c.eq(n.data.systolic, null, "completed systolic dropped");
      c.eq([n.data.diastolic, n.data.pulse], [85, 70], "grounded numbers kept");
      c.ok(n.reasons.includes("partly_unreadable"), "says some digits were unclear");
    }),
    caseOf(N, "vn-bp-implausible", "numbers that cannot be a blood pressure are never swapped or offered", (c) => {
      for (const [s, d] of [
        [80, 130],
        [120, 115],
        [118, 118],
      ] as const) {
        const n = normalizeBp(bpRaw({ systolic: s, diastolic: d, pulse: 70, seen_text: `${s} ${d} 70` }));
        c.eq([n.data.systolic, n.data.diastolic], [null, null], `${s}/${d} offered neither`);
        c.ok(n.reasons.includes("implausible"), `${s}/${d} says implausible`);
      }
    }),
    caseOf(N, "vn-bp-range", "values outside the physiological windows are dropped, the irregular-heartbeat symbol is reported", (c) => {
      const n = normalizeBp(bpRaw({ systolic: 300, diastolic: 84, pulse: 250, seen_text: "300 84 250", irregular_heartbeat_symbol: true }));
      c.eq([n.data.systolic, n.data.diastolic, n.data.pulse], [null, 84, null], "windows");
      c.ok(n.reasons.includes("irregular_heartbeat"), "irregular heartbeat reported");
    }),
    caseOf(N, "vn-weight-clean", "a clear kg reading passes through", (c) => {
      const n = normalizeWeight(weightRaw());
      c.eq(n.data.kg, 72.4, "kg");
      c.eq(n.imageKind, "weight_scale", "image kind");
      c.eq(n.reasons, [], "no reasons");
    }),
    caseOf(N, "vn-weight-units", "pounds and stone are converted by code; an unlabelled unit is assumed kg and said so", (c) => {
      const lb = normalizeWeight(weightRaw({ value: 154.3, unit: "lb", seen_text: "154.3" }));
      c.eq(lb.data.kg, 70, "154.3 lb");
      c.eq(lb.reasons, ["unit_converted"], "lb reason");
      const st = normalizeWeight(weightRaw({ value: 11.5, unit: "st", seen_text: "11.5" }));
      c.eq(st.data.kg, 73, "11.5 st");
      const unknown = normalizeWeight(weightRaw({ unit: "unknown" }));
      c.eq([unknown.data.kg, unknown.reasons], [72.4, ["unit_unclear"]], "unknown unit");
    }),
    caseOf(N, "vn-weight-gates", "kitchen scales, other objects, contradicting text and absurd values give no kg", (c) => {
      const cases: Array<[Partial<WeightModelRead>, ReasonCode]> = [
        [{ unit: "g", value: 112, seen_text: "112" }, "kitchen_scale"],
        [{ unit: "oz", value: 4, seen_text: "4" }, "kitchen_scale"],
        [{ is_scale_display: false }, "not_scale"],
        [{ value: null }, "unreadable"],
        [{ legibility: "poor" }, "unreadable"],
        [{ value: 72.4, seen_text: "27.4" }, "unreadable"],
        [{ value: 400, seen_text: "400" }, "implausible"],
        [{ value: 5, seen_text: "5" }, "implausible"],
      ];
      for (const [over, reason] of cases) {
        const n = normalizeWeight(weightRaw(over));
        c.eq(n.data.kg, null, `no kg for ${JSON.stringify(over)}`);
        c.eq(n.reasons, [reason], `reason for ${JSON.stringify(over)}`);
      }
    }),

    // ---- consensus --------------------------------------------------------------------------------
    caseOf(C, "vc-table", "per-field status: agreed, majority, single, conflict, missing", (c) => {
      const agreed = reconcileBp([
        { source: "device", values: bp(130, 80, 70) },
        { source: "gemini", values: bp(130, 80, 70) },
      ]);
      c.eq([vsig(agreed.systolic), vsig(agreed.diastolic), vsig(agreed.pulse)], ["130|agreed||device+gemini", "80|agreed||device+gemini", "70|agreed||device+gemini"], "agreed");

      const majority = reconcileBp([
        { source: "gemini", values: bp(130, 80, null) },
        { source: "groq", values: bp(130, 80, null) },
        { source: "device", values: bp(135, 80, null) },
      ]);
      c.eq(vsig(majority.systolic), "130|majority|135|gemini+groq", "two AIs beat a disagreeing phone, its value is kept as an alternative");
      c.eq(vsig(majority.pulse), "null|missing||", "nobody read the pulse");

      const single = reconcileBp([{ source: "gemini", values: bp(130, 80, 70) }]);
      c.eq(vsig(single.systolic), "130|single||gemini", "single");

      const conflict = reconcileBp([
        { source: "gemini", values: bp(130, 80, 70) },
        { source: "device", values: bp(135, 80, 70) },
      ]);
      c.eq(vsig(conflict.systolic), "null|conflict|130,135|", "a tie is a conflict: no value, both offered");
    }),
    caseOf(C, "vc-swap", "sys <= dia or a gap under 10 is never decided: both numbers become conflicts with both values kept", (c) => {
      const v = reconcileBp([{ source: "gemini", values: bp(80, 130, 70) }]);
      c.eq([v.systolic.value, v.diastolic.value, v.systolic.status, v.diastolic.status], [null, null, "conflict", "conflict"], "neither decided");
      c.ok(v.systolic.alternatives.includes(80) && v.diastolic.alternatives.includes(130), "both numbers stay available to tap");
    }),
    caseOf(C, "vc-weight", "weights agree within 0.1 kg, not beyond", (c) => {
      c.eq(reconcileWeight([{ source: "gemini", values: kg(72.4) }, { source: "device", values: kg(72.5) }]).kg.status, "agreed", "72.4 vs 72.5");
      c.eq(reconcileWeight([{ source: "gemini", values: kg(72.4) }, { source: "device", values: kg(72.6) }]).kg.status, "conflict", "72.4 vs 72.6");
      c.eq(reconcileWeight([{ source: "gemini", values: kg(null) }, { source: "device", values: kg(null) }]).kg.status, "missing", "nobody");
    }),
    caseOf(C, "vc-second-opinion", "another vendor is asked on disagreement, a hard read or a lone alarming value; not for an ordinary single reading", (c) => {
      const agreed = reconcileBp([
        { source: "device", values: bp(130, 80, null) },
        { source: "gemini", values: bp(130, 80, null) },
      ]);
      c.eq(needsSecondOpinion(agreed), false, "agreed (a pulse nobody read does not count)");
      const lone = reconcileBp([{ source: "gemini", values: bp(130, 80, 70) }]);
      c.eq(needsSecondOpinion(lone), false, "one clear ordinary reading: the person confirms it, no second call");
      c.eq(needsSecondOpinion(lone, { crisis: true }), true, "a lone reading in an alarming range is cross-checked");
      c.eq(needsSecondOpinion(lone, { uncertainRead: true }), true, "so is one the reader said was hard");
      c.eq(
        needsSecondOpinion(reconcileBp([{ source: "gemini", values: bp(130, 80, 70) }, { source: "device", values: bp(135, 80, 70) }])),
        true,
        "disagreement",
      );
      const blank = reconcileBp([{ source: "gemini", values: bp(null, null, null) }]);
      c.eq(needsSecondOpinion(blank, { crisis: true, uncertainRead: true }), false, "nothing readable: a second look at a blank display does not help");
      c.eq(needsSecondOpinion(reconcileWeight([{ source: "gemini", values: kg(72.4) }, { source: "device", values: kg(72.4) }])), false, "weight agreed");
      c.eq(needsSecondOpinion(reconcileWeight([{ source: "gemini", values: kg(72.4) }])), false, "weight single and clear");
      c.eq(needsSecondOpinion(reconcileWeight([{ source: "gemini", values: kg(72.4) }]), { uncertainRead: true }), true, "weight single and hard");
      c.eq(needsSecondOpinion(reconcileWeight([{ source: "gemini", values: kg(72.4) }, { source: "device", values: kg(74.4) }])), true, "weight disagreement");
    }),
    caseOf(C, "vc-prefillable", "agreed and majority always fill; single fills unless alarming; conflict and missing never", (c) => {
      const v = (status: FieldVote["status"], value: number | null): FieldVote => ({ value, status, alternatives: [], sources: [] });
      c.eq(prefillable(v("agreed", 190), { crisis: true }), true, "agreed in the crisis range");
      c.eq(prefillable(v("majority", 190), { crisis: true }), true, "majority in the crisis range");
      c.eq(prefillable(v("single", 150)), true, "single, ordinary");
      c.eq(prefillable(v("single", 190), { crisis: true }), false, "single in the crisis range");
      c.eq(prefillable(v("conflict", null)), false, "conflict");
      c.eq(prefillable(v("missing", null)), false, "missing");
      c.eq(prefillable(v("agreed", null)), false, "no value");
    }),
    caseOf(C, "vc-alarm-lines", "the lines a single reading is held back at are the patient's own crisis and low-urgent lines", (c) => {
      const t = DEFAULT_BP_THRESHOLDS;
      c.eq([isAlarmingAlone("systolic", 179, t), isAlarmingAlone("systolic", 180, t)], [false, true], "systolic crisis line 180");
      c.eq([isAlarmingAlone("diastolic", 119, t), isAlarmingAlone("diastolic", 120, t)], [false, true], "diastolic crisis line 120");
      c.eq([isAlarmingAlone("systolic", 80, t), isAlarmingAlone("systolic", 79, t)], [false, true], "systolic urgent-low is below low_systolic - 10");
      c.eq([isAlarmingAlone("diastolic", 50, t), isAlarmingAlone("diastolic", 49, t)], [false, true], "diastolic urgent-low is below low_diastolic - 10");
      c.eq(isAlarmingAlone("pulse", 250, t), false, "pulse has no such line");
      c.eq(isAlarmingAlone("systolic", 172, { ...t, crisis_systolic: 170 }), true, "a patient with a stricter line");
      // The same lines classifyBP itself uses, so the dialog and the form agree on what "crisis" is.
      c.eq(classifyBP(180, 100).category, "crisis", "classifyBP crisis at 180");
      c.eq(classifyBP(75, 70).needsUrgentAttention, true, "classifyBP urgent-low below 80");
    }),

    // ---- what goes into the form ------------------------------------------------------------------
    caseOf(F, "vf-agreed-crisis", "a crisis-range reading two readers agree on is filled", (c) => {
      const r = resolveDisplay({
        kind: "bp",
        device: bp(190, 125, 80),
        ai: [read("gemini", bp(190, 125, 80))],
        thresholds: DEFAULT_BP_THRESHOLDS,
      });
      c.eq(fsig(r.fields.systolic), "190|agreed|-|190:gemini+device", "systolic");
      c.eq(r.deviceAgrees, true, "phone agrees (boxes may be drawn)");
      c.eq(r.wantsSecondOpinion, false, "no second opinion needed");
    }),
    caseOf(F, "vf-single-crisis-held", "a crisis-range reading only one reader gave is NOT filled, but stays tappable", (c) => {
      const r = resolveDisplay({ kind: "bp", device: null, ai: [read("gemini", bp(190, 125, 80))], thresholds: DEFAULT_BP_THRESHOLDS });
      c.eq(fsig(r.fields.systolic), "null|single|held|190:gemini", "systolic held back");
      c.eq(fsig(r.fields.diastolic), "null|single|held|125:gemini", "diastolic held back");
      c.eq(fsig(r.fields.pulse), "80|single|-|80:gemini", "pulse is filled (no crisis line)");
      c.eq(r.wantsSecondOpinion, true, "another vendor is asked");
      c.eq(r.anything, true, "the person still has something to tap");
    }),
    caseOf(F, "vf-single-ordinary", "an ordinary reading one reader gave is filled and marked as unconfirmed", (c) => {
      const r = resolveDisplay({ kind: "bp", device: null, ai: [read("gemini", bp(150, 95, 70))], thresholds: DEFAULT_BP_THRESHOLDS });
      c.eq([r.fields.systolic?.value, r.fields.diastolic?.value, r.fields.pulse?.value], [150, 95, 70], "filled");
      c.eq(statusCopy(r.fields.systolic as FieldFill).tone, "attention", "amber");
      c.eq(statusCopy(r.fields.systolic as FieldFill).hi.includes("AI ने पढ़ा"), true, "says AI read it");
      c.eq(r.wantsSecondOpinion, false, "an ordinary clear single reading asks nobody else");
    }),
    caseOf(F, "vf-patient-lines", "the patient's own crisis line decides what is held back", (c) => {
      const strict = { ...DEFAULT_BP_THRESHOLDS, crisis_systolic: 170 };
      const held = resolveDisplay({ kind: "bp", device: null, ai: [read("gemini", bp(172, 100, 70))], thresholds: strict });
      c.eq(held.fields.systolic?.heldBack, true, "172 is a crisis for this patient");
      const filled = resolveDisplay({ kind: "bp", device: null, ai: [read("gemini", bp(172, 100, 70))], thresholds: DEFAULT_BP_THRESHOLDS });
      c.eq(filled.fields.systolic?.value, 172, "172 is not a crisis on the default line");
    }),
    caseOf(F, "vf-low-urgent", "a lone dangerously low reading is held back too, a merely low one is filled", (c) => {
      const low = resolveDisplay({ kind: "bp", device: null, ai: [read("gemini", bp(75, 50, 70))], thresholds: DEFAULT_BP_THRESHOLDS });
      c.eq(low.fields.systolic?.heldBack, true, "75 is below low_systolic - 10");
      const mild = resolveDisplay({ kind: "bp", device: null, ai: [read("gemini", bp(85, 55, 70))], thresholds: DEFAULT_BP_THRESHOLDS });
      c.eq([mild.fields.systolic?.value, mild.fields.diastolic?.value], [85, 55], "85/55 is low but not urgent");
    }),
    caseOf(F, "vf-blocked", "a memory / measuring / error / wrong-object display fills nothing, even from the phone", (c) => {
      for (const reason of ["memory_or_average", "measuring_in_progress", "error_code", "not_bp_monitor"] as const) {
        const r = resolveDisplay({
          kind: "bp",
          device: bp(130, 80, 70),
          ai: [read("gemini", bp(null, null, null), [reason])],
          thresholds: DEFAULT_BP_THRESHOLDS,
        });
        c.eq(r.blocked, true, `${reason}: blocked`);
        c.eq([r.fields.systolic?.value, r.fields.diastolic?.value, r.fields.pulse?.value], [null, null, null], `${reason}: nothing filled`);
        c.eq(r.anything, false, `${reason}: no chips either`);
        c.eq(r.wantsSecondOpinion, false, `${reason}: no second opinion`);
      }
      const scale = resolveDisplay({ kind: "weight", device: kg(112), ai: [read("gemini", kg(null), ["kitchen_scale"])] });
      c.eq([scale.blocked, scale.fields.kg?.value], [true, null], "a kitchen scale's grams are not a body weight");
    }),
    caseOf(F, "vf-two-ai-beat-phone", "two AIs agreeing outvote a disagreeing phone; the phone's number stays a chip", (c) => {
      const r = resolveDisplay({
        kind: "bp",
        device: bp(135, 80, 70),
        ai: [read("gemini", bp(130, 80, 70)), read("groq", bp(130, 80, 70))],
        thresholds: DEFAULT_BP_THRESHOLDS,
      });
      c.eq(fsig(r.fields.systolic), "130|majority|-|130:gemini+groq,135:device", "systolic");
      c.eq(r.deviceAgrees, true, "the phone agrees on diastolic and pulse");
      c.eq(r.wantsSecondOpinion, false, "two AIs already");
      c.eq(r.providers, ["gemini", "groq"], "both counted");
    }),
    caseOf(F, "vf-conflict", "a phone and one AI that disagree: nothing is filled, both numbers are offered, AI's first", (c) => {
      const r = resolveDisplay({ kind: "bp", device: bp(135, 80, 70), ai: [read("gemini", bp(130, 80, 70))], thresholds: DEFAULT_BP_THRESHOLDS });
      c.eq(fsig(r.fields.systolic), "null|conflict|-|130:gemini,135:device", "systolic");
      c.eq(r.wantsSecondOpinion, true, "ask a second vendor");
    }),
    caseOf(F, "vf-same-provider", "the same provider twice is one reader, not a cross-check", (c) => {
      const r = resolveDisplay({
        kind: "bp",
        device: null,
        ai: [read("gemini", bp(130, 80, 70)), read("gemini", bp(130, 80, 70))],
        thresholds: DEFAULT_BP_THRESHOLDS,
      });
      c.eq(r.fields.systolic?.status, "single", "single, not agreed");
      c.eq(r.providers, ["gemini"], "counted once");
      c.eq(r.wantsSecondOpinion, false, "an ordinary clear reading asks nobody else");
      const hard = resolveDisplay({
        kind: "bp",
        device: null,
        ai: [read("gemini", bp(130, 80, 70), ["partly_unreadable"]), read("gemini", bp(130, 80, 70))],
        thresholds: DEFAULT_BP_THRESHOLDS,
      });
      c.eq([hard.fields.systolic?.status, hard.wantsSecondOpinion], ["single", true], "a hard read still wants a DIFFERENT vendor");
    }),
    caseOf(F, "vf-weight", "weights: tolerance, conversion reason carried, nothing alarming", (c) => {
      const r = resolveDisplay({ kind: "weight", device: kg(72.5), ai: [read("gemini", kg(72.4), ["unit_converted"])] });
      c.eq([r.fields.kg?.value, r.fields.kg?.status], [72.4, "agreed"], "agreed within 0.1 kg");
      c.eq(r.reasons, ["unit_converted"], "reason kept");
      const alone = resolveDisplay({ kind: "weight", device: null, ai: [read("groq", kg(210))] });
      c.eq([alone.fields.kg?.value, alone.fields.kg?.status], [210, "single"], "a heavy single reading is still just a number to confirm");
    }),
    caseOf(F, "vf-reason-order", "reasons that stop a prefill come first and are listed once", (c) => {
      const r = resolveDisplay({
        kind: "bp",
        device: null,
        ai: [read("gemini", bp(null, null, null), ["irregular_heartbeat", "memory_or_average"]), read("groq", bp(null, null, null), ["memory_or_average"])],
        thresholds: DEFAULT_BP_THRESHOLDS,
      });
      c.eq(r.reasons, ["memory_or_average", "irregular_heartbeat"], "order");
    }),
    caseOf(F, "vf-labels", "sources are named in words the family reads", (c) => {
      c.eq(sourcesLabelHi(["device"]), "फ़ोन", "device");
      c.eq(sourcesLabelHi(["gemini"]), "AI", "one AI");
      c.eq(sourcesLabelHi(["gemini", "groq"]), "दो AI", "two AIs");
      c.eq(sourcesLabelHi(["device", "gemini"]), "फ़ोन + AI", "phone and AI");
    }),
    caseOf(F, "vf-hint", "the line under the picker only says a photo is sent when it will be", (c) => {
      const base = { offered: true, photos: true as boolean | null, canChange: true, online: true, loading: false };
      c.eq(photoPrivacyHint({ ...base, loading: true }), undefined, "nothing is claimed while loading");
      c.eq(photoPrivacyHint({ ...base, offered: false }), HINT_DEVICE_ONLY, "AI not offered");
      c.eq(photoPrivacyHint({ ...base, photos: true }), HINT_SENDS, "on and online: says it is sent");
      c.eq(photoPrivacyHint({ ...base, photos: true, online: false }), HINT_OFFLINE, "on but offline: says it is not");
      c.eq(photoPrivacyHint({ ...base, photos: false }), HINT_AI_OFF, "off");
      c.eq(photoPrivacyHint({ ...base, photos: null }), HINT_WILL_ASK, "never asked, someone who can answer");
      c.eq(photoPrivacyHint({ ...base, photos: null, canChange: false }), HINT_DEVICE_ONLY, "never asked, view-only: nothing is sent");
      c.eq(photoPrivacyHint({ ...base, photos: null, online: false }), HINT_DEVICE_ONLY, "never asked and offline");
      for (const hint of [HINT_DEVICE_ONLY, HINT_AI_OFF, HINT_OFFLINE]) c.includes(hint, "नहीं", `${hint.slice(0, 20)}: states that nothing is sent`);
      c.includes(HINT_SENDS, "भेजी जाती है", "the sending hint says so");
      c.includes(HINT_SENDS, "सेव नहीं होती", "and that we do not keep it");
    }),

    caseOf(F, "vf-device-gate", "the phone's reading votes only at confidence 0.4 or more, in the shape the AI answers use", (c) => {
      c.eq(deviceReadingOf(phoneBpResult(0.39)), null, "0.39 stays out of the vote");
      c.eq(deviceReadingOf(phoneBpResult(0.4)), { systolic: 130, diastolic: 80, pulse: 70 }, "0.4 is in");
      c.eq(deviceReadingOf(phoneBpResult(0.9, 150, 95, null)), { systolic: 150, diastolic: 95, pulse: null }, "no pulse stays null");
      c.eq(deviceReadingOf(phoneWeightResult(0.39)), null, "weight 0.39");
      c.eq(deviceReadingOf(phoneWeightResult(0.4, 72.4)), { kg: 72.4 }, "weight 0.4");
      c.eq(deviceReadingOf({ kind: "bp", reading: null, ms: 1 }), null, "nothing read");
      c.eq(deviceReadingOf(null), null, "no result");
      // A weak phone reading therefore cannot turn a lone AI value into "agreed".
      const r = resolveDisplay({ kind: "bp", device: deviceReadingOf(phoneBpResult(0.3)) as BpReading | null, ai: [read("gemini", bp(130, 80, 70))], thresholds: DEFAULT_BP_THRESHOLDS });
      c.eq([r.fields.systolic?.status, r.deviceUsed], ["single", false], "AI stays a single reading");
    }),
    caseOf(F, "vf-upgrade-keeps-typing", "a later answer fills the fields the person left alone and never one they typed or tapped", (c) => {
      const t = (over: Partial<FieldTexts> = {}): FieldTexts => ({ systolic: "", diastolic: "", pulse: "", kg: "", ...over });
      const phoneOnly = resolveDisplay({ kind: "bp", device: bp(130, 80, 70), ai: [], thresholds: DEFAULT_BP_THRESHOLDS });
      const shown = applyResolution(t(), new Set<FillKey>(), phoneOnly);
      c.eq([shown.systolic, shown.diastolic, shown.pulse, shown.kg], ["130", "80", "70", ""], "the phone's reading appears first");
      // AI disagrees on systolic and the person had already corrected diastolic by hand.
      const upgraded = resolveDisplay({ kind: "bp", device: bp(130, 80, 70), ai: [read("gemini", bp(135, 80, 70))], thresholds: DEFAULT_BP_THRESHOLDS });
      const next = applyResolution({ ...shown, diastolic: "82" }, new Set<FillKey>(["diastolic"]), upgraded);
      c.eq([next.systolic, next.diastolic, next.pulse], ["", "82", "70"], "conflict empties the untouched field, the typed one stays, the agreed one stays");
      // A display that is refused empties what the phone had put there, not what the person typed.
      const refused = resolveDisplay({ kind: "bp", device: bp(130, 80, 70), ai: [read("gemini", bp(null, null, null), ["memory_or_average"])], thresholds: DEFAULT_BP_THRESHOLDS });
      const cleared = applyResolution(shown, new Set<FillKey>(["pulse"]), refused);
      c.eq([cleared.systolic, cleared.diastolic, cleared.pulse], ["", "", "70"], "refused display");
      // Weight leaves the BP fields alone, and the other way round.
      const w = applyResolution(t({ systolic: "120" }), new Set<FillKey>(), resolveDisplay({ kind: "weight", device: kg(72.4), ai: [] }));
      c.eq([w.kg, w.systolic], ["72.4", "120"], "weight fields only");
    }),
    caseOf(F, "vf-stage", "the result screen opens on the first reader with something and never closes by itself", (c) => {
      c.eq(stageFor({ anything: false, final: false, current: "reading" }), "reading", "still waiting");
      c.eq(stageFor({ anything: true, final: false, current: "reading" }), "result", "the phone (or AI) has something");
      c.eq(stageFor({ anything: false, final: true, current: "reading" }), "failed", "everyone answered, nobody read anything");
      c.eq(stageFor({ anything: false, final: true, current: "result" }), "result", "a late 'memory reading' answer does not pull the screen away");
      c.eq(stageFor({ anything: true, final: true, current: "failed" }), "result", "a late phone result still opens the screen");
    }),
    caseOf(F, "vf-plan", "what a new photo does always matches what the line under the picker said", (c) => {
      let combos = 0;
      for (const offered of [true, false])
        for (const photos of [true, false, null] as Array<boolean | null>)
          for (const canChange of [true, false])
            for (const online of [true, false])
              for (const loading of [true, false])
                for (const asked of [true, false]) {
                  combos++;
                  const s: HintState & { asked: boolean } = { offered, photos, canChange, online, loading, asked };
                  // The dialog shows the hint with `canChange && !asked`.
                  const hint = photoPrivacyHint({ offered, photos, canChange: canChange && !asked, online, loading });
                  const plan = aiPlan(s);
                  const label = JSON.stringify(s);
                  c.eq(plan === "ai", hint === HINT_SENDS, `ai <=> "is sent" line: ${label}`);
                  c.eq(plan === "ask", hint === HINT_WILL_ASK, `ask <=> "will ask" line: ${label}`);
                  if (plan !== "ai") c.ok(hint !== HINT_SENDS, `never says a photo is sent when it will not be: ${label}`);
                  if (loading) c.ok(hint === undefined && plan === "device", `nothing is claimed or sent while loading: ${label}`);
                  if (photos !== true) c.ok(plan !== "ai", `no AI without a yes: ${label}`);
                  if (photos === null && !canChange) c.ok(plan !== "ask", `a person who cannot answer is not asked: ${label}`);
                }
      c.eq(combos, 96, "every combination was checked");
    }),

    // ---- the upload and the client service --------------------------------------------------------
    caseOf(S, "vs-jpeg-plan", "the encoder never enlarges, steps quality down then size down, and stays bounded", (c) => {
      const a = jpegAttempts(4000, 3000, { maxSide: 1280 });
      c.eq([a[0].width, a[0].height, a[0].quality], [1280, 960, 0.82], "first try: scaled to the budget, best quality");
      c.eq(a.slice(0, 4).map((x) => x.quality), [0.82, 0.72, 0.62, 0.5], "quality steps at one size");
      c.ok(a.every((x) => Math.max(x.width, x.height) <= 1280), "never above the maximum side");
      c.ok(a.length <= 16, `bounded number of tries (${a.length})`);
      const sizes = [...new Set(a.map((x) => x.width))];
      c.ok(sizes.every((w, i) => i === 0 || w < sizes[i - 1]), "sizes only shrink");
      const small = jpegAttempts(400, 300, { maxSide: 1280 });
      c.eq([small[0].width, small[0].height], [400, 300], "a small photo is not enlarged");
      c.ok(jpegAttempts(0, 0).length >= 1, "degenerate input still yields a try");
    }),
    caseOf(S, "vs-b64", "base64 sizes and data-URL prefixes", (c) => {
      c.eq(base64ByteLength("QUJD"), 3, "3 bytes");
      c.eq(base64ByteLength("QQ=="), 1, "1 byte");
      c.eq(base64ByteLength("QUI="), 2, "2 bytes");
      c.eq(stripDataUrlPrefix("data:image/jpeg;base64,AAAA"), "AAAA", "prefix stripped");
      c.eq(stripDataUrlPrefix("AAAA"), "AAAA", "bare base64 untouched");
    }),
    caseOf(S, "vs-status-map", "every failure the route can send maps to one typed reason", (c) => {
      const t: Array<[number, string | null, string]> = [
        [401, null, "signed_out"],
        [403, "ai_photos_off", "consent_off"],
        [403, "ai_photos_unasked", "consent_unasked"],
        [403, "view_only", "view_only"],
        [403, null, "forbidden"],
        [413, "too_large", "too_large"],
        [400, "invalid_image", "bad_request"],
        [429, "rate_limited", "rate_limited"],
        [503, "ai_unavailable", "ai_unavailable"],
        [499, null, "cancelled"],
        [500, null, "error"],
      ];
      for (const [status, code, expected] of t) c.eq(unavailableReasonFor(status, code), expected, `${status} ${code}`);
      c.eq(isConsentProblem("consent_off"), true, "consent_off re-reads the switch");
      c.eq(isConsentProblem("rate_limited"), false, "quota does not");
    }),
    caseOf(S, "vs-parse", "an answer is trusted only in the shape the contract promises", (c) => {
      const ok = parseVisionAnswer("bp", {
        requestId: "r1",
        kind: "bp",
        provider: "groq",
        model: "qwen",
        ms: 412,
        imageKind: "bp_monitor",
        reasons: ["irregular_heartbeat", "constructor", "not-a-reason"],
        data: { systolic: 132, diastolic: 84, pulse: 300 },
      });
      c.eq(ok?.status, "ok", "ok");
      c.eq(ok?.provider, "groq", "provider");
      c.eq(ok?.reasons, ["irregular_heartbeat"], "unknown reasons and prototype names dropped");
      c.eq(ok?.data, { systolic: 132, diastolic: 84, pulse: null }, "pulse outside its window dropped");
      c.eq(parseVisionAnswer("bp", { provider: "someone", data: {} }), null, "unknown provider");
      c.eq(parseVisionAnswer("bp", "nope"), null, "not an object");
      c.eq(parseVisionAnswer("weight", { provider: "gemini", data: { kg: 72.44 } })?.data, { kg: 72.4 }, "weight rounded to 0.1");
      c.eq(parseVisionAnswer("weight", { provider: "gemini", data: { kg: 4000 } })?.data, { kg: null }, "weight outside its window dropped");
    }),
    caseOf(S, "vs-fetch", "readPhotoWithAi never throws and sends what the route expects", async (c) => {
      const seen: Array<{ url: string; body: Record<string, unknown>; type: string | null }> = [];
      const answer = (status: number, body: unknown): typeof fetch =>
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          seen.push({
            url: String(input),
            body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
            type: new Headers(init?.headers).get("content-type"),
          });
          return jsonResponse(status, body);
        }) as typeof fetch;
      const pid = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
      const image = "/9j/".repeat(40);
      const good = { requestId: "r1", provider: "gemini", model: "m", ms: 5, imageKind: "weight_scale", reasons: [], data: { kg: 72.4 } };

      await withFetch(answer(200, good), async () => {
        const r = await readPhotoWithAi({ patientId: pid, kind: "weight", image, requestId: "r1", opinion: "second", avoidProvider: "gemini" });
        c.eq(r.status, "ok", "ok");
        c.eq(r.status === "ok" ? r.data : null, { kg: 72.4 }, "typed data");
        c.eq(seen[0]?.url, "/api/vision/read", "url");
        c.eq(seen[0]?.type, "application/json", "JSON, not multipart");
        c.eq(
          [seen[0]?.body.patientId, seen[0]?.body.kind, seen[0]?.body.opinion, seen[0]?.body.avoidProvider, seen[0]?.body.requestId, seen[0]?.body.image === image],
          [pid, "weight", "second", "gemini", "r1", true],
          "body",
        );
      });

      const expectations: Array<[number, unknown, string]> = [
        [403, { code: "ai_photos_off" }, "consent_off"],
        [403, { code: "ai_photos_unasked" }, "consent_unasked"],
        [429, { code: "rate_limited" }, "rate_limited"],
        [503, { code: "ai_unavailable" }, "ai_unavailable"],
        [401, { error: "x" }, "signed_out"],
        [200, { provider: "nobody" }, "bad_answer"],
      ];
      for (const [status, body, reason] of expectations) {
        await withFetch(answer(status, body), async () => {
          const r = await readPhotoWithAi({ patientId: pid, kind: "bp", image });
          c.eq(r.status === "unavailable" ? r.reason : r.status, reason, `${status} -> ${reason}`);
        });
      }

      await withFetch((async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch, async () => {
        const r = await readPhotoWithAi({ patientId: pid, kind: "bp", image });
        c.eq(r.status === "unavailable" ? r.reason : "ok", "network", "network failure");
      });

      const hang = ((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as typeof fetch;
      await withFetch(hang, async () => {
        const t0 = Date.now();
        const r = await readPhotoWithAi({ patientId: pid, kind: "bp", image, timeoutMs: 60 });
        c.eq(r.status === "unavailable" ? r.reason : "ok", "timeout", "client timeout");
        c.ok(Date.now() - t0 < 2000, "returned promptly");
        const controller = new AbortController();
        const pending = readPhotoWithAi({ patientId: pid, kind: "bp", image, signal: controller.signal, timeoutMs: 5000 });
        controller.abort();
        const cancelled = await pending;
        c.eq(cancelled.status === "unavailable" ? cancelled.reason : "ok", "cancelled", "caller abort");
        const already = new AbortController();
        already.abort();
        const instant = await readPhotoWithAi({ patientId: pid, kind: "bp", image, signal: already.signal });
        c.eq(instant.status === "unavailable" ? instant.reason : "ok", "cancelled", "aborted before start");
      });

      const none = await readPhotoWithAi({ patientId: pid, kind: "bp" });
      c.eq(none.status === "unavailable" ? none.reason : "ok", "bad_request", "no photo given");
    }),
    caseOf(S, "vs-inflight", "the same request id in flight is one call (a double tap does not double-spend)", async (c) => {
      let calls = 0;
      const slow = (async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
        return jsonResponse(200, { provider: "gemini", model: "m", ms: 1, imageKind: "bp_monitor", reasons: [], data: { systolic: 120, diastolic: 80, pulse: 70 } });
      }) as typeof fetch;
      await withFetch(slow, async () => {
        const args = { patientId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b", kind: "bp" as const, image: "/9j/".repeat(40), requestId: "dup-1" };
        const [a, b] = await Promise.all([readPhotoWithAi(args), readPhotoWithAi(args)]);
        c.eq(calls, 1, "one network call");
        c.eq([a.status, b.status], ["ok", "ok"], "both callers get the answer");
        await readPhotoWithAi(args);
        c.eq(calls, 2, "a later call with the same id is a new call (the id only guards what is in flight)");
      });
    }),
    caseOf(S, "vs-encode", "the photo is redrawn onto a fresh canvas, never exported as it was, and steps down to fit the budget", async (c) => {
      // Size model: bytes grow with pixels and quality, like a real JPEG.
      const bytesFor = (w: number, h: number, q: number) => (w * h * q) / 8;
      await withFakeDocument(bytesFor, async (made) => {
        const source = fakeCanvas(4000, 3000, bytesFor);
        const roomy = await encodeJpeg(asCanvas(source), { maxSide: 1280, maxBytes: 900_000 });
        c.eq([roomy.width, roomy.height, roomy.quality, roomy.withinBudget], [1280, 960, 0.82, true], "first try fits");
        c.eq(source.exportedAt.length, 0, "the camera canvas itself is never exported (it may carry what the file carried)");
        c.eq(made.length, 1, "one redraw");
        c.ok(made[0].drawn.includes(source), "the new canvas was drawn from the photo");
        c.eq(made[0].exportedAt, [0.82], "and that is what was encoded");
        c.ok(roomy.bytes <= 900_000, "under the budget");

        made.length = 0;
        const tight = await encodeJpeg(asCanvas(source), { maxSide: 1280, maxBytes: 60_000 });
        c.ok(tight.withinBudget && tight.bytes <= 60_000, `a tight budget is met (${tight.bytes} bytes)`);
        c.ok(tight.quality < 0.82 || tight.width < 1280, "by lowering quality or size");
        c.ok(made.length >= 1 && made.length <= 4, "a bounded number of redraws");

        const hopeless = await encodeJpeg(asCanvas(source), { maxSide: 1280, maxBytes: 100 });
        c.eq(hopeless.withinBudget, false, "an impossible budget is reported, not hidden");
      });
    }),
    caseOf(S, "vs-budgets", "what the browser sends fits what the handlers and the route accept", (c) => {
      for (const kind of ["bp", "weight"] as const) {
        const handler = visionHandler(kind);
        c.ok(!!handler, `${kind} has a handler`);
        if (!handler) continue;
        const budget = AI_PHOTO_BUDGET[kind];
        c.ok(budget.maxBytes <= handler.maxImageBytes, `${kind}: ${budget.maxBytes} bytes fits the handler's ${handler.maxImageBytes}`);
        // Base64 grows the bytes by a third; the route reads at most 3.2 MB of JSON.
        c.ok(Math.ceil((budget.maxBytes * 4) / 3) + 2_048 < 3_200_000, `${kind}: base64 body fits the route's read limit`);
      }
    }),
    caseOf(S, "vs-prepare", "prepareImage encodes a canvas once, passes encoded bytes through and refuses what cannot be sent", async (c) => {
      const bytesFor = (w: number, h: number, q: number) => (w * h * q) / 8;
      await withFakeDocument(bytesFor, async () => {
        const ok = await prepareImage("bp", { canvas: asCanvas(fakeCanvas(2000, 1500, bytesFor)) });
        c.eq(ok.ok, true, "a canvas is encoded");
        c.ok(ok.ok && ok.bytes > 0 && !ok.image.startsWith("data:"), "as bare base64");
        const given = await prepareImage("weight", { image: "QUJD".repeat(40) });
        c.eq(given.ok && given.image, "QUJD".repeat(40), "an encoded image is passed through untouched");
        const none = await prepareImage("bp", {});
        c.eq(none.ok ? "ok" : none.reason, "bad_request", "nothing to send");
      });
      // Over budget even at the smallest size: refused before any network call.
      await withFakeDocument(() => 5_000_000, async () => {
        const huge = await prepareImage("bp", { canvas: asCanvas(fakeCanvas(6000, 6000, () => 5_000_000)) });
        c.eq(huge.ok ? "ok" : huge.reason, "too_large", "over the budget");
      });
    }),
    // ---- the phone and AI together: the whole read, with a fake server ---------------------------
    caseOf("vision flow", "vfl-agree", "phone and AI agree: one AI call, filled, the phone's boxes may be drawn", async (c) => {
      const log: Wire[] = [];
      await withFetch(visionFetch(() => okBp("gemini", 130, 80, 70), log), async () => {
        const o = await readDisplayWithAi({ patientId: PID, kind: "bp", image: PHOTO, device: phone(bp(130, 80, 70)) });
        c.eq(o.mode, "ai", "mode");
        if (o.mode !== "ai") return;
        c.eq(o.second, "not_asked", "no second opinion");
        c.eq(log.length, 1, "one network call");
        c.eq([o.resolution.fields.systolic?.value, o.resolution.fields.systolic?.status], [130, "agreed"], "systolic");
        c.eq(o.resolution.deviceAgrees, true, "device agrees");
        c.eq(o.device.raw, "phone-read", "the phone's own result is handed back for drawing");
      });
    }),
    caseOf("vision flow", "vfl-single-clear", "the phone read nothing and AI read a clear ordinary value: filled as unconfirmed, still one call", async (c) => {
      const log: Wire[] = [];
      await withFetch(visionFetch(() => okBp("gemini", 128, 82, 70), log), async () => {
        const o = await readDisplayWithAi({ patientId: PID, kind: "bp", image: PHOTO, device: phone(null) });
        c.eq(o.mode, "ai", "mode");
        if (o.mode !== "ai") return;
        c.eq([o.resolution.fields.systolic?.value, o.resolution.fields.systolic?.status], [128, "single"], "systolic");
        c.eq(o.second, "not_asked", "no second opinion");
        c.eq(log.length, 1, "one call");
      });
    }),
    caseOf("vision flow", "vfl-second-opinion", "a disagreement asks a DIFFERENT company, once, with the same request id", async (c) => {
      const log: Wire[] = [];
      let announced = 0;
      const handler = (body: Wire): Reply => (body.opinion === "second" ? okBp("groq", 130, 80, 70) : okBp("gemini", 130, 80, 70));
      await withFetch(visionFetch(handler, log), async () => {
        const o = await readDisplayWithAi({
          patientId: PID,
          kind: "bp",
          image: PHOTO,
          device: phone(bp(135, 80, 70)),
          requestId: "req-1",
          onSecondOpinion: () => {
            announced++;
          },
        });
        c.eq(o.mode, "ai", "mode");
        if (o.mode !== "ai") return;
        c.eq(log.length, 2, "two calls");
        c.eq([log[0].opinion, log[1].opinion, log[1].avoidProvider], ["primary", "second", "gemini"], "the second asks for another vendor");
        c.eq([log[0].requestId, log[1].requestId], ["req-1", "req-1"], "same request id");
        c.eq(announced, 1, "the dialog is told once");
        c.eq(o.second, "answered", "second answered");
        c.eq([o.resolution.fields.systolic?.value, o.resolution.fields.systolic?.status], [130, "majority"], "two AIs outvote the phone");
        c.eq(o.resolution.fields.systolic?.options.map((x) => x.value), [130, 135], "the phone's number stays a chip");
      });
    }),
    caseOf("vision flow", "vfl-second-same-company", "a second answer from the same company is not a cross-check", async (c) => {
      const log: Wire[] = [];
      await withFetch(visionFetch(() => okBp("gemini", 130, 80, 70), log), async () => {
        const o = await readDisplayWithAi({ patientId: PID, kind: "bp", image: PHOTO, device: phone(bp(135, 80, 70)) });
        c.eq(o.mode, "ai", "mode");
        if (o.mode !== "ai") return;
        c.eq(o.second, "same_provider", "labelled");
        c.eq([o.resolution.fields.systolic?.value, o.resolution.fields.systolic?.status], [null, "conflict"], "still a conflict: nothing is filled");
        c.eq(o.resolution.providers, ["gemini"], "counted once");
      });
    }),
    caseOf("vision flow", "vfl-second-down", "when the second opinion is unavailable the first answer stands, unconfirmed", async (c) => {
      const log: Wire[] = [];
      const handler = (body: Wire): Reply => (body.opinion === "second" ? down(429, "rate_limited") : okBp("gemini", 190, 125, 80));
      await withFetch(visionFetch(handler, log), async () => {
        const o = await readDisplayWithAi({ patientId: PID, kind: "bp", image: PHOTO, device: phone(null) });
        c.eq(o.mode, "ai", "mode");
        if (o.mode !== "ai") return;
        c.eq(o.second, "unavailable", "second unavailable");
        c.eq(log.length, 2, "it was asked (a lone crisis-range value is cross-checked)");
        c.eq(fsig(o.resolution.fields.systolic), "null|single|held|190:gemini", "190 is held back, still tappable");
      });
    }),
    caseOf("vision flow", "vfl-alarming-confirmed", "a lone crisis-range value confirmed by another vendor is filled; a different second answer fills nothing", async (c) => {
      for (const [second, expected] of [
        [okBp("groq", 190, 125, 80), 190],
        [okBp("groq", 150, 95, 70), null],
      ] as const) {
        const log: Wire[] = [];
        const handler = (body: Wire): Reply => (body.opinion === "second" ? second : okBp("gemini", 190, 125, 80));
        await withFetch(visionFetch(handler, log), async () => {
          const o = await readDisplayWithAi({ patientId: PID, kind: "bp", image: PHOTO, device: phone(null) });
          if (o.mode !== "ai") return c.ok(false, "mode ai");
          c.eq(o.resolution.fields.systolic?.value, expected, `second says ${JSON.stringify(second.body)}`);
        });
      }
    }),
    caseOf("vision flow", "vfl-ai-down", "AI unavailable: the phone's own reading comes back untouched, no second call", async (c) => {
      for (const [reply, reason] of [
        [down(503, "ai_unavailable"), "ai_unavailable"],
        [down(403, "ai_photos_off"), "consent_off"],
        [down(403, "ai_photos_unasked"), "consent_unasked"],
        [down(429, "rate_limited"), "rate_limited"],
      ] as const) {
        const log: Wire[] = [];
        await withFetch(visionFetch(() => reply, log), async () => {
          const o = await readDisplayWithAi({ patientId: PID, kind: "bp", image: PHOTO, device: phone(bp(130, 80, 70)) });
          c.eq(o.mode, "device", `${reason}: mode`);
          if (o.mode !== "device") return;
          c.eq([o.reason, o.device.raw, log.length], [reason, "phone-read", 1], `${reason}: reason, phone result, one call`);
        });
      }
    }),
    caseOf("vision flow", "vfl-blocked", "a memory/average display fills nothing and asks nobody else", async (c) => {
      const log: Wire[] = [];
      await withFetch(visionFetch(() => okBp("gemini", null, null, null, ["memory_or_average"]), log), async () => {
        const o = await readDisplayWithAi({ patientId: PID, kind: "bp", image: PHOTO, device: phone(bp(130, 80, 70)) });
        c.eq(o.mode, "ai", "mode");
        if (o.mode !== "ai") return;
        c.eq([o.resolution.blocked, o.resolution.anything, o.second, log.length], [true, false, "not_asked", 1], "blocked, nothing to tap, one call");
        c.eq(o.resolution.reasons, ["memory_or_average"], "the reason reaches the dialog");
      });
    }),
    caseOf("vision flow", "vfl-resilience", "a throwing phone reader, failing BP lines or a cancelled read never throws out of the flow", async (c) => {
      const log: Wire[] = [];
      await withFetch(visionFetch(() => okBp("gemini", 128, 82, 70), log), async () => {
        const o = await readDisplayWithAi({
          patientId: PID,
          kind: "bp",
          image: PHOTO,
          device: async () => {
            throw new Error("worker died");
          },
          thresholds: Promise.reject(new Error("settings unavailable")),
        });
        c.eq(o.mode, "ai", "AI still served");
        c.eq(o.device.failure, "worker died", "the failure is reported");
        c.eq(o.device.reading, null, "no phone reading");
        if (o.mode === "ai") c.eq(o.resolution.fields.systolic?.value, 128, "filled from AI with the standard lines");

        const gone = new AbortController();
        gone.abort();
        log.length = 0;
        const cancelled = await readDisplayWithAi({ patientId: PID, kind: "bp", image: PHOTO, device: phone(bp(130, 80, 70)), signal: gone.signal });
        c.eq([cancelled.mode, cancelled.mode === "device" ? cancelled.reason : "", log.length], ["device", "cancelled", 0], "cancelled before the call: nothing sent");
      });
    }),
    caseOf("vision flow", "vfl-weight", "weights: a converted pound reading agrees with the phone within 0.1 kg", async (c) => {
      const log: Wire[] = [];
      await withFetch(visionFetch(() => okWeight("gemini", 70, ["unit_converted"]), log), async () => {
        const o = await readDisplayWithAi({ patientId: PID, kind: "weight", image: PHOTO, device: phone(kg(70.1)) });
        c.eq(o.mode, "ai", "mode");
        if (o.mode !== "ai") return;
        c.eq([o.resolution.fields.kg?.value, o.resolution.fields.kg?.status, o.resolution.reasons], [70, "agreed", ["unit_converted"]], "agreed with the conversion noted");
        c.eq(log[0].kind, "weight", "kind sent");
      });
    }),
    caseOf("vision flow", "vfl-progressive-phone-first", "the phone's reading is shown before the slow AI answers, then upgraded", async (c) => {
      const log: Wire[] = [];
      let answered = false;
      const seen: Array<{ aiAnswered: boolean; p: DisplayProgress<string> }> = [];
      await withFetch(slowVisionFetch(() => okBp("gemini", 130, 80, 70), log, 60, () => (answered = true)), async () => {
        const o = await readDisplayWithAi<string>({
          patientId: PID,
          kind: "bp",
          image: PHOTO,
          device: phone(bp(130, 80, 70)),
          onProgress: (p) => void seen.push({ aiAnswered: answered, p }),
        });
        c.ok(seen.length >= 2, `at least two snapshots (${seen.length})`);
        const first = seen[0];
        c.eq(first.aiAnswered, false, "the first snapshot came before AI answered");
        c.eq([first.p.device?.raw, first.p.ai, first.p.final, first.p.resolution?.providers], ["phone-read", "waiting", false, []], "phone only, AI pending");
        c.eq(first.p.resolution?.fields.systolic?.value, 130, "the phone's number is already in the field");
        const last = seen[seen.length - 1].p;
        c.eq([last.ai, last.final, last.resolution?.fields.systolic?.status], ["done", true, "agreed"], "upgraded to agreed");
        c.eq(o.mode, "ai", "mode");
      });
    }),
    caseOf("vision flow", "vfl-progressive-ai-first", "an AI answer is shown while a slow phone reader is still working, and the phone's vote joins later", async (c) => {
      const log: Wire[] = [];
      const seen: Array<DisplayProgress<string>> = [];
      await withFetch(visionFetch(() => okBp("gemini", 130, 80, 70), log), async () => {
        const o = await readDisplayWithAi<string>({
          patientId: PID,
          kind: "bp",
          image: PHOTO,
          device: async () => {
            await sleep(60);
            return { reading: bp(130, 80, 70), raw: "phone-read", failure: "" };
          },
          onProgress: (p) => void seen.push(p),
        });
        const first = seen[0];
        c.eq([first.device, first.resolution?.providers, first.resolution?.fields.systolic?.status], [null, ["gemini"], "single"], "AI alone first");
        const last = seen[seen.length - 1];
        c.eq([last.final, last.resolution?.fields.systolic?.status, last.resolution?.deviceAgrees], [true, "agreed", true], "then agreed with the phone");
        c.eq(log.length, 1, "one call: the phone agreed before a cross-check was decided");
        c.eq(o.mode, "ai", "mode");
      });
    }),
    caseOf("vision flow", "vfl-device-hangs", "a phone reader that never answers does not hold the AI result, the second opinion or the end of the read", async (c) => {
      const never = () => new Promise<DeviceOutcome<string>>(() => {});
      const log: Wire[] = [];
      const handler = (body: Wire): Reply => (body.opinion === "second" ? okBp("groq", 190, 125, 80) : okBp("gemini", 190, 125, 80));
      await withFetch(visionFetch(handler, log), async () => {
        const seen: Array<DisplayProgress<string>> = [];
        const t0 = Date.now();
        const o = await readDisplayWithAi<string>({
          patientId: PID,
          kind: "bp",
          image: PHOTO,
          device: never,
          deviceGraceMs: 30,
          deviceMaxWaitMs: 30,
          onProgress: (p) => void seen.push(p),
        });
        c.ok(Date.now() - t0 < 2000, "returned promptly");
        c.eq(log.length, 2, "a lone crisis-range value was cross-checked without waiting for the phone");
        c.eq(o.mode, "ai", "mode");
        if (o.mode === "ai") c.eq(o.resolution.fields.systolic?.value, 190, "two companies agree");
        c.ok(seen.some((p) => p.device === null && p.resolution !== null), "AI's answer was shown while the phone was silent");
      });
      await withFetch(visionFetch(() => down(503, "ai_unavailable"), []), async () => {
        const t0 = Date.now();
        const o = await readDisplayWithAi<string>({ patientId: PID, kind: "bp", image: PHOTO, device: never, deviceMaxWaitMs: 30 });
        c.eq([o.mode, o.mode === "device" ? o.reason : ""], ["device", "ai_unavailable"], "AI down and the phone silent");
        c.ok(Date.now() - t0 < 2000, "does not wait forever");
      });
    }),
    caseOf("vision flow", "vfl-call-budget", "ordinary reads cost about 1.2 AI calls: a second company is asked only when it can change the outcome", async (c) => {
      type Scenario = { name: string; phone: BpReading | null; first: Reply; second?: Reply; calls: number };
      const scenarios: Scenario[] = [
        { name: "phone and AI agree", phone: bp(130, 80, 70), first: okBp("gemini", 130, 80, 70), calls: 1 },
        { name: "AI alone, clear, ordinary", phone: null, first: okBp("gemini", 128, 82, 70), calls: 1 },
        { name: "phone misread one digit", phone: bp(138, 82, 70), first: okBp("gemini", 128, 82, 70), second: okBp("groq", 128, 82, 70), calls: 2 },
        { name: "AI alone, crisis range", phone: null, first: okBp("gemini", 190, 125, 80), second: okBp("groq", 190, 125, 80), calls: 2 },
        { name: "phone and AI agree on a crisis", phone: bp(190, 125, 80), first: okBp("gemini", 190, 125, 80), calls: 1 },
        { name: "blank display", phone: null, first: okBp("gemini", null, null, null, ["unreadable"]), calls: 1 },
        { name: "memory reading", phone: bp(130, 80, 70), first: okBp("gemini", null, null, null, ["memory_or_average"]), calls: 1 },
        { name: "agree 2", phone: bp(118, 76, 64), first: okBp("gemini", 118, 76, 64), calls: 1 },
        { name: "agree 3", phone: bp(142, 90, 78), first: okBp("gemini", 142, 90, 78), calls: 1 },
        { name: "agree 4", phone: bp(125, 79, 72), first: okBp("gemini", 125, 79, 72), calls: 1 },
      ];
      let total = 0;
      for (const sc of scenarios) {
        const log: Wire[] = [];
        const handler = (body: Wire): Reply => (body.opinion === "second" ? (sc.second ?? sc.first) : sc.first);
        await withFetch(visionFetch(handler, log), async () => {
          await readDisplayWithAi({ patientId: PID, kind: "bp", image: PHOTO, device: phone(sc.phone) });
        });
        c.eq(log.length, sc.calls, `${sc.name}: calls`);
        total += log.length;
      }
      c.ok(total / scenarios.length <= 1.3, `average ${(total / scenarios.length).toFixed(2)} calls per read`);
    }),
    caseOf("vision flow", "vfl-double-tap", "two taps with one request id are one call", async (c) => {
      const log: Wire[] = [];
      await withFetch(slowVisionFetch(() => okBp("gemini", 130, 80, 70), log, 30, () => {}), async () => {
        const args = { patientId: PID, kind: "bp" as const, image: PHOTO, device: phone(bp(130, 80, 70)), requestId: "tap-1" };
        const [a, b] = await Promise.all([readDisplayWithAi(args), readDisplayWithAi(args)]);
        c.eq(log.length, 1, "one network call");
        c.eq([a.mode, b.mode], ["ai", "ai"], "both taps get the answer");
      });
    }),
    caseOf("vision flow", "vfl-encode-once", "the photo is encoded once and the same bytes go to both companies", async (c) => {
      const log: Wire[] = [];
      const bytesFor = (w: number, h: number, q: number) => (w * h * q) / 8;
      await withFakeDocument(bytesFor, async (made) => {
        const handler = (body: Wire): Reply => (body.opinion === "second" ? okBp("groq", 130, 80, 70) : okBp("gemini", 130, 80, 70));
        await withFetch(visionFetch(handler, log), async () => {
          const o = await readDisplayWithAi({
            patientId: PID,
            kind: "bp",
            canvas: asCanvas(fakeCanvas(2400, 1800, bytesFor)),
            device: phone(bp(135, 80, 70)),
          });
          c.eq(o.mode, "ai", "mode");
        });
        c.eq(log.length, 2, "asked twice");
        c.ok(typeof log[0]?.image === "string" && log[0].image === log[1]?.image, "identical bytes for both");
        c.eq(made.length, 1, "one redraw of the photo for both calls");
        c.ok(String(log[0]?.image).startsWith("QUFB") || !String(log[0]?.image).startsWith("data:"), "bare base64 on the wire");
      });
    }),
    caseOf("vision flow", "vfl-listener-and-stop", "a throwing listener cannot break a read; stopping the wait leaves the phone's reading and asks nobody else", async (c) => {
      const log: Wire[] = [];
      await withFetch(visionFetch(() => okBp("gemini", 130, 80, 70), log), async () => {
        const o = await readDisplayWithAi<string>({
          patientId: PID,
          kind: "bp",
          image: PHOTO,
          device: phone(bp(130, 80, 70)),
          onProgress: () => {
            throw new Error("render failed");
          },
        });
        c.eq(o.mode, "ai", "the read completed");
      });

      const stopLog: Wire[] = [];
      const stop = new AbortController();
      const seen: Array<DisplayProgress<string>> = [];
      await withFetch(
        ((_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            stopLog.push(JSON.parse(String(init?.body ?? "{}")) as Wire);
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          })) as typeof fetch,
        async () => {
          const pending = readDisplayWithAi<string>({
            patientId: PID,
            kind: "bp",
            image: PHOTO,
            device: phone(bp(150, 95, 70)),
            signal: stop.signal,
            timeoutMs: 5_000,
            onProgress: (p) => void seen.push(p),
          });
          await sleep(20);
          stop.abort();
          const o = await pending;
          c.eq([o.mode, o.mode === "device" ? o.reason : ""], ["device", "cancelled"], "stopped");
          c.eq(stopLog.length, 1, "no second call after a stop");
          c.eq(seen[0]?.resolution?.fields.systolic?.value, 150, "the phone's reading was on screen while AI was pending");
        },
      );
    }),
    caseOf("vision flow", "vfl-no-ai-text", "when AI could not answer the flow says nothing about it: the phone's reading is the whole answer", async (c) => {
      for (const reply of [down(503, "ai_unavailable"), down(429, "rate_limited"), down(403, "ai_photos_off"), down(403, "ai_photos_unasked"), down(401, "x")]) {
        const seen: Array<DisplayProgress<string>> = [];
        await withFetch(visionFetch(() => reply, []), async () => {
          const o = await readDisplayWithAi<string>({ patientId: PID, kind: "bp", image: PHOTO, device: phone(bp(130, 80, 70)), onProgress: (p) => void seen.push(p) });
          c.eq(o.mode, "device", `${reply.status}: mode`);
          const last = seen[seen.length - 1];
          c.eq([last.ai, last.final, last.resolution?.reasons, last.resolution?.fields.systolic?.value], ["unavailable", true, [], 130], `${reply.status}: the phone's reading stands, no reasons are invented`);
        });
      }
      // A fast refusal and a slow phone: the dialog is told AI is out as soon as it is, not when the phone ends.
      const seen: Array<DisplayProgress<string>> = [];
      await withFetch(visionFetch(() => down(429, "rate_limited"), []), async () => {
        await readDisplayWithAi<string>({
          patientId: PID,
          kind: "bp",
          image: PHOTO,
          device: async () => {
            await sleep(40);
            return { reading: bp(130, 80, 70), raw: "phone-read", failure: "" };
          },
          onProgress: (p) => void seen.push(p),
        });
      });
      c.eq(
        seen.map((p) => `${p.ai}:${p.device ? "phone" : "-"}:${p.final ? "final" : "open"}`),
        ["unavailable:-:open", "unavailable:phone:open", "unavailable:phone:final"],
        "AI out first, then the phone's reading, then the end",
      );
    }),
  ];
}
