import { WEIGHT_SCHEMA, type WeightModelRead, type WeightReading } from "@/lib/vision/ai-contract";
import { normalizeWeight } from "@/lib/vision/ai-normalize";
import { TRANSCRIBER_SYSTEM, type VisionHandler } from "./handler";

export const weightHandler: VisionHandler<WeightModelRead, WeightReading> = {
  kind: "weight",
  task: "vision_weight",
  tier: "fast",
  sensitivity: "health",
  maxImageBytes: 1_800_000,
  maxOutputTokens: 300,
  system: TRANSCRIBER_SYSTEM,
  schemaName: "weight_display",
  schema: WEIGHT_SCHEMA as unknown as Record<string, unknown>,
  prompt: () =>
    [
      "This is a photo of a weighing scale's display.",
      "Transcribe the large main weight number and its unit exactly as shown (kg, lb, st, g, oz; unknown if no unit is visible).",
      "Ignore BMI, body-fat, water, muscle, bone, user number, memory and battery indicators.",
      "If the digits are uncertain or the reading is still changing return value null. Do not correct, estimate or complete the number.",
      "In seen_text write the number exactly as displayed.",
      "If the picture is not a weighing-scale display set is_scale_display=false and value null.",
    ].join(" "),
  normalize: (raw) => normalizeWeight(raw),
};
