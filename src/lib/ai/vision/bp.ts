import { BP_SCHEMA, type BpModelRead, type BpReading } from "@/lib/vision/ai-contract";
import { normalizeBp } from "@/lib/vision/ai-normalize";
import { TRANSCRIBER_SYSTEM, type VisionHandler } from "./handler";

export const bpHandler: VisionHandler<BpModelRead, BpReading> = {
  kind: "bp",
  task: "vision_bp",
  tier: "fast",
  sensitivity: "health",
  maxImageBytes: 1_800_000,
  maxOutputTokens: 400,
  system: TRANSCRIBER_SYSTEM,
  schemaName: "bp_display",
  schema: BP_SCHEMA as unknown as Record<string, unknown>,
  prompt: () =>
    [
      "This is a photo of a home blood-pressure monitor.",
      "Transcribe only digits you can clearly see on its display.",
      "systolic = the larger number labelled SYS (usually the top number); diastolic = DIA (usually the middle number);",
      "pulse = the number beside PUL, the heart symbol or /min (usually the bottom).",
      "Ignore the date, the time, the memory number (M1, M2, A), the battery and any number printed on the casing.",
      "If a digit is uncertain return null for that field. Do not correct, estimate or complete a number.",
      "In seen_text write the digits exactly as they appear on the display, separated by spaces.",
      "display: result (a finished measurement is shown), measuring (the cuff is inflating or a number is changing), memory, average, error (E-, Err), off (blank), unknown.",
      "If the picture is not a blood-pressure monitor display set is_bp_monitor=false, display=unknown and every number null.",
    ].join(" "),
  normalize: (raw) => normalizeBp(raw),
};
