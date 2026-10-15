/** Server only. The registry of photo-reading kinds the route can dispatch to. */
import type { VisionKind } from "@/lib/vision/ai-contract";
import { bpHandler } from "./bp";
import type { VisionHandler } from "./handler";
import { mealHandler } from "./meal";
import { medicineHandler } from "./medicine";
import { weightHandler } from "./weight";

// A kind is live as soon as it is listed here; the route answers 400 for kinds without a handler.
const HANDLERS: Partial<Record<VisionKind, VisionHandler<never, unknown>>> = {
  bp: bpHandler as unknown as VisionHandler<never, unknown>,
  weight: weightHandler as unknown as VisionHandler<never, unknown>,
  meal: mealHandler as unknown as VisionHandler<never, unknown>,
  medicine: medicineHandler as unknown as VisionHandler<never, unknown>,
};

export function visionHandler(kind: string): VisionHandler<never, unknown> | null {
  return (HANDLERS as Record<string, VisionHandler<never, unknown> | undefined>)[kind] ?? null;
}

export function liveVisionKinds(): VisionKind[] {
  return Object.keys(HANDLERS) as VisionKind[];
}
