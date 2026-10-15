"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, History, Plus, Search, Sparkles, Trash2, Utensils } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { useOnline } from "@/components/layout/offline-banner";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, NumberInput, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { consumedAtFor, isCatalogueId, type Confidence } from "@/components/food/food-math";
import { PhotoPicker } from "@/components/vision/photo-picker";
import { useAuth } from "@/context/auth-context";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { loggedUnit } from "@/lib/food/catalogue";
import { summariseMealSave, unsavedMessage } from "@/lib/food/meal-save";
import { todayIST } from "@/lib/health-rules";
import { cn, getExactFoodEmoji } from "@/lib/utils";
import { aiPlan } from "@/lib/vision/display-fill";
import { analyseFoodPhoto, isFoodModelLoaded, loadFoodModel, type FoodAnalysis } from "@/lib/vision/food-model";
import { decodePhoto, previewDataUrl, thumbnailDataUrl } from "@/lib/vision/image";
import { MEAL_PLATE_KCAL_CAP, learnedCoversPlate, mealPhotoHint, type MealMapped, type MealPick } from "@/lib/vision/meal-map";
import {
  getAllActiveFoods,
  getFoodPortions,
  logFood,
  searchFoodItems,
  type FoodItem,
  type FoodPortion,
} from "@/services/patient-service";
import {
  matchFoodPhoto,
  readMealPhotoWithAi,
  rememberFoodPhoto,
  type FoodMatchResponse,
  type FoodPhotoFood,
  type FoodSuggestionItem,
  type LearnedMatch,
  type MealAiOutcome,
  type MealAiRead,
} from "@/services/food-photo-service";
import { getPersonalizedQuickFoods, type PersonalizedQuickFoodItem } from "@/services/quick-food-service";
import { getVisionAiStatus, isConsentProblem, peekVisionAiStatus, type VisionAiStatus } from "@/services/vision-ai-service";

type FoodPhotoDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  mealType: string;
  /** IST day the meal is saved onto. */
  logDate: string;
  /** Exact instant the meal was eaten (ISO); when given it wins over logDate's typical meal time. */
  consumedAt?: string;
  /**
   * Called after at least one food was saved. `complete: true` is followed by onClose(); `complete: false` means a
   * save failed part-way and this dialog stays open with the rest: a host must then only refresh, never close.
   */
  onLogged: (result: { complete: boolean }) => void;
};

/** A Hindi explanation for whatever stopped the photo from being analysed. */
function describeFailure(err: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "इंटरनेट नहीं है। खाना पहचानने वाला मॉडल पहली बार डाउनलोड होना ज़रूरी है; इंटरनेट चालू करके फिर कोशिश करें।";
  }
  const message = err instanceof Error ? err.message : "";
  if (/[ऀ-ॿ]/.test(message)) return message;
  if (/HTTP|fetch|network|load|wasm|tflite|model|labels/i.test(message)) {
    return "खाना पहचानने वाला मॉडल लोड नहीं हो पाया। इंटरनेट जाँचकर दोबारा कोशिश करें; तब तक खाना खोजकर दर्ज कर सकते हैं।";
  }
  if (/canvas|image|decode/i.test(message)) return "फोटो खोली नहीं जा सकी। दूसरी फोटो लें।";
  return "फोटो पहचानी नहीं जा सकी। दोबारा कोशिश करें या खोजकर दर्ज करें।";
}

const isDataImage = (url: string | null | undefined): url is string => typeof url === "string" && url.startsWith("data:image/");

type Step = "pick" | "analysing" | "choose" | "saving";

/** One food the person has agreed is on the plate, with how much. */
type Picked = {
  key: string;
  food: FoodItem;
  portions: FoodPortion[];
  portionId: string;
  quantity: string;
  /** kcal for one portion/unit when the catalogue has none. */
  manualKcal: string;
  /**
   * The food was named by an AI reader (pre-selected, or a chip the person tapped). The row is logged with a source
   * note that says so, so a later accuracy audit can tell the paths apart; the flag stays after an edit.
   */
  fromAi: boolean;
  /** The amount is still the AI path's guess: "Low" confidence until the person changes the portion or the quantity. */
  aiEstimated: boolean;
  /** The model's own words for it, shown under the catalogue name ("फोटो में: Roti"). */
  aiSeen: { name: string; nameHi: string | null } | null;
};

function estimate(p: Picked): { kcal: number; grams: number; confidence: Confidence } | null {
  const qty = parseFloat(p.quantity);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 20) return null;
  const portion = p.portions.find((x) => x.id === p.portionId) ?? p.portions[0] ?? null;
  const grams = (portion ? portion.standardized_grams : p.food.reference_weight_g || 100) * qty;
  if (p.food.calories_per_100g == null) {
    const manual = parseFloat(p.manualKcal);
    if (!Number.isFinite(manual) || manual < 0 || manual > 5000) return null;
    return { kcal: Math.round(manual * qty), grams, confidence: "Low" };
  }
  return { kcal: Math.round((p.food.calories_per_100g / 100) * grams), grams, confidence: portion && !p.aiEstimated ? "Medium" : "Low" };
}

type AddPreset = {
  quantity?: number;
  unit?: string;
  /** A catalogue portion row (wins over `unit`). */
  portionId?: string | null;
  caloriesPerUnit?: number | null;
  /** The AI reader named this food: the row is flagged, and says what the model called it. */
  ai?: { name: string; nameHi: string | null } | null;
  /** Nobody tapped: no toast when the food is already on the list. */
  quiet?: boolean;
};

const EMPTY_MATCH: FoodMatchResponse = { learned: [], suggestions: [], dishes: [] };
/** A model that is already in memory answers in about a second; that long is spent before deciding to call AI. */
const EARLY_DEVICE_MS = 2_500;
/** After AI failed, the next photo of this dialog goes straight to the phone's model for this long. */
const AI_PAUSE_MS = 60_000;
/** After this long the person may stop waiting for AI. */
const SLOW_AFTER_MS = 6_000;

type AiState = "idle" | "running" | "second" | "done" | "unavailable" | "skipped";
type DeviceState = "idle" | "running" | "done" | "failed";

/** `p`'s value, or null when it has not settled within `ms` (the timer never outlives the wait). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Photo of a meal -> the foods on the plate, logged in one go.
 *
 * The photo is always analysed on the phone (the food model never sends it anywhere). Suggestions come in
 * four kinds, best first: meals the family confirmed before that look like this photo; what an AI service named
 * on the plate, mapped to catalogue foods with household portions (only when the family has said yes to photo
 * AI, never otherwise: nothing leaves the phone before that); catalogue foods the classifier recognised; and
 * the foods this person usually eats at this meal. Every suggestion is a tap to add; portions and quantities
 * stay editable; and once saved, what the person CONFIRMED is remembered so the next similar plate is recognised
 * straight away. Nothing is saved from a model's output without the person pressing the button.
 */
export function FoodPhotoDialog(props: FoodPhotoDialogProps) {
  // Mounted only while open, so every opening starts fresh.
  return props.isOpen ? <FoodPhotoDialogBody {...props} /> : null;
}

function FoodPhotoDialogBody({ isOpen, onClose, patientId, mealType, logDate, consumedAt, onLogged }: FoodPhotoDialogProps) {
  const toast = useToast();
  const { canWrite } = useAuth();
  const aiSettings = useAiSettings(patientId);
  const online = useOnline();

  const [step, setStep] = useState<Step>("pick");
  const [stage, setStage] = useState<string>("");
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState("");
  const [analysis, setAnalysis] = useState<FoodAnalysis | null>(null);
  const [match, setMatch] = useState<FoodMatchResponse | null>(null);
  const [matchError, setMatchError] = useState("");
  const [deviceState, setDeviceState] = useState<DeviceState>("idle");
  const [aiState, setAiState] = useState<AiState>("idle");
  const [mealAi, setMealAi] = useState<MealAiRead | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const [usual, setUsual] = useState<PersonalizedQuickFoodItem[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FoodItem[]>([]);
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLElement | null>(null);
  // The latest list, for checks that run after an await (a double tap must not add a food twice).
  const pickedRef = useRef<Picked[]>([]);
  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);
  const keySeq = useRef(0);
  // Everything logged for this photo so far, across a retry after a partial failure.
  const savedRef = useRef<FoodPhotoFood[]>([]);
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const usualRef = useRef<PersonalizedQuickFoodItem[]>([]);
  const pausedRef = useRef(false);
  /** Why the phone's model could not help for the current photo (null while it has not failed). */
  const deviceFailRef = useRef<unknown>(null);
  const [aiPaused, setAiPaused] = useState(false);
  const [slow, setSlow] = useState(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  // Whether this deployment can read plates with a model at all (cached for the session).
  const [vision, setVision] = useState<VisionAiStatus | null>(() => peekVisionAiStatus(patientId));
  useEffect(() => {
    if (!aiSettings.available) return;
    let alive = true;
    void getVisionAiStatus(patientId).then((status) => {
      if (alive) setVision(status);
    });
    return () => {
      alive = false;
    };
  }, [aiSettings.available, patientId]);
  const visionLive = aiSettings.available && vision !== null && vision.available && vision.kinds.includes("meal");

  // One place decides what a photo may do, from the same state as the line under the picker.
  const hintState = {
    // A view-only member cannot spend the family's quota (the server refuses too); they see the on-phone wording.
    offered: visionLive && canWrite,
    photos: aiSettings.settings?.photos ?? null,
    canChange: aiSettings.canChange,
    online,
    // Until both answers are in, saying anything about where the photo goes could be wrong.
    loading: aiSettings.loading || (aiSettings.available && vision === null),
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
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    getPersonalizedQuickFoods(patientId, mealType, 8)
      .then((list) => {
        if (active) {
          setUsual(list);
          usualRef.current = list;
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [patientId, mealType]);

  // Typing is debounced so the catalogue is matched once per pause, not per key.
  function handleQuery(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = value.trim();
    if (!q) {
      setHits([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      searchFoodItems(q, 8)
        .then((r) => setHits([...r.exactMatches, ...r.suggestions].slice(0, 8)))
        .catch(() => setHits([]));
    }, 250);
  }

  function restAi() {
    pausedRef.current = true;
    setAiPaused(true);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      pausedRef.current = false;
      if (aliveRef.current) setAiPaused(false);
    }, AI_PAUSE_MS);
  }

  /** Abandons the read in flight: its answers are ignored and its AI call is cancelled. */
  function cancelRun() {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }

  async function addFood(food: FoodItem, preset?: AddPreset) {
    if (pickedRef.current.some((p) => p.food.id === food.id)) {
      if (!preset?.quiet) toast.info(`${food.name} पहले से सूची में है`);
      return;
    }
    const portions = isCatalogueId(food.id) ? await getFoodPortions(food.id).catch(() => [] as FoodPortion[]) : [];
    const byId = preset?.portionId ? portions.find((p) => p.id === preset.portionId) : undefined;
    const byUnit = !byId && preset?.unit ? portions.find((p) => loggedUnit(p.portion_name) === preset.unit) : undefined;
    const manual = food.calories_per_100g == null && preset?.caloriesPerUnit != null ? String(Math.round(preset.caloriesPerUnit)) : "";
    keySeq.current += 1;
    const entry: Picked = {
      key: `${food.id}-${keySeq.current}`,
      food,
      portions,
      portionId: (byId ?? byUnit)?.id ?? portions[0]?.id ?? "",
      quantity: String(preset?.quantity ?? 1),
      manualKcal: manual,
      fromAi: !!preset?.ai,
      aiEstimated: !!preset?.ai,
      aiSeen: preset?.ai ?? null,
    };
    // Checked again inside the update: two taps may have been waiting on the portions together.
    setPicked((list) => (list.some((p) => p.food.id === food.id) ? list : [...list, entry]));
  }

  async function addSuggestion(s: FoodSuggestionItem) {
    const all = await getAllActiveFoods().catch(() => [] as FoodItem[]);
    const food = all.find((f) => f.id === s.id);
    if (!food) {
      toast.error("यह भोजन सूची में नहीं मिला");
      return;
    }
    await addFood(food);
  }

  async function addLearned(m: LearnedMatch) {
    const all = await getAllActiveFoods().catch(() => [] as FoodItem[]);
    for (const f of m.foods) await addFromPhotoFood(f, all);
  }

  async function addFromPhotoFood(f: FoodPhotoFood, all: FoodItem[]) {
    const food = f.food_item_id ? all.find((x) => x.id === f.food_item_id) : undefined;
    if (food) {
      await addFood(food, { quantity: f.quantity, unit: f.unit, caloriesPerUnit: f.quantity > 0 ? f.calories / f.quantity : f.calories });
      return;
    }
    // A typed food from an earlier photo: carry its name and calories as a one-off item.
    const perUnit = f.quantity > 0 ? f.calories / f.quantity : f.calories;
    await addFood(
      {
        id: `photo-${f.name}`,
        name: f.name,
        name_hi: null,
        category: "indian_preparation",
        subcategory: null,
        reference_weight_g: 100,
        reference_unit: f.unit || "serving",
        calories_per_100g: null,
        protein_g_100g: 0,
        carbs_g_100g: 0,
        fat_g_100g: 0,
        fibre_g_100g: 0,
        sodium_mg_100g: null,
        source_type: "user_entered",
        source_name: "Meal photo",
        source_note: "पिछली फोटो से",
        is_verified: false,
        is_custom: true,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { quantity: f.quantity, unit: f.unit, caloriesPerUnit: perUnit },
    );
  }

  async function addUsual(q: PersonalizedQuickFoodItem) {
    let food: FoodItem | undefined;
    try {
      food = (await searchFoodItems(q.name)).exactMatches[0];
    } catch {
      food = undefined;
    }
    await addFood(
      food ?? {
        id: `quick-${q.canonicalKey}`,
        name: q.name,
        name_hi: q.name_hi,
        category: q.category,
        subcategory: "quick_food",
        reference_weight_g: 100,
        reference_unit: "serving",
        calories_per_100g: q.caloriesKnown ? q.defaultCal : null,
        protein_g_100g: 0,
        carbs_g_100g: 0,
        fat_g_100g: 0,
        fibre_g_100g: 0,
        sodium_mg_100g: null,
        source_type: "user_entered",
        source_name: "Quick food (your past entries)",
        source_note: "आपके पिछले रिकॉर्ड का औसत",
        is_verified: false,
        is_custom: false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );
  }

  /** Puts one of the AI reader's catalogue foods on the plate (a pre-selection or a chip the person tapped). */
  async function addAiPick(item: MealMapped, pick: MealPick, opts: { quiet?: boolean; foods?: FoodItem[] } = {}) {
    const all = opts.foods ?? (await getAllActiveFoods().catch(() => [] as FoodItem[]));
    const food = all.find((f) => f.id === pick.foodId);
    if (!food) {
      if (!opts.quiet) toast.error("यह भोजन सूची में नहीं मिला");
      return;
    }
    await addFood(food, { quantity: pick.labelQuantity, unit: pick.unit, portionId: pick.portionId, ai: { name: item.aiName, nameHi: item.aiNameHi }, quiet: opts.quiet });
  }

  function update(key: string, patch: Partial<Picked>) {
    // Changing the portion or the quantity is the person looking at the amount: the AI path's guess no longer applies.
    const looked = "portionId" in patch || "quantity" in patch;
    setPicked((list) => list.map((p) => (p.key === key ? { ...p, ...patch, aiEstimated: looked ? false : p.aiEstimated } : p)));
  }

  /** A finished (or failed) AI read: pre-select what is certain, leave the rest as choices. Never throws. */
  async function applyAi(outcome: MealAiOutcome, run: number) {
    if (!aliveRef.current || run !== runRef.current) return;
    if (outcome.status !== "ok") {
      // AI did not help (switched off elsewhere, over its quota, slow, stopped): the phone's result stands, silently.
      setAiState("unavailable");
      if (isConsentProblem(outcome.reason)) void aiSettings.refresh();
      else if (outcome.reason !== "cancelled") restAi();
      return;
    }
    setMealAi(outcome);
    setAiState("done");
    // Earlier AI pre-selections the person never touched are replaced by the new read.
    setPicked((list) => list.filter((p) => !(p.fromAi && p.aiEstimated)));
    pickedRef.current = pickedRef.current.filter((p) => !(p.fromAi && p.aiEstimated));
    const foods = await getAllActiveFoods().catch(() => [] as FoodItem[]);
    for (const item of outcome.result.items) {
      if (run !== runRef.current) return;
      if (item.pick) await addAiPick(item, item.pick, { quiet: true, foods });
    }
  }

  function startAi(canvas: HTMLCanvasElement, run: number): Promise<MealAiOutcome> {
    setAiState("running");
    if (!abortRef.current || abortRef.current.signal.aborted) abortRef.current = new AbortController();
    const controller = abortRef.current;
    return readMealPhotoWithAi({
      patientId,
      canvas,
      mealType,
      usualNames: usualRef.current.map((u) => u.name),
      signal: controller.signal,
      onSecondLook: () => {
        if (aliveRef.current && run === runRef.current) setAiState("second");
      },
    }).then(async (outcome) => {
      await applyAi(outcome, run);
      return outcome;
    });
  }

  async function runDevice(canvas: HTMLCanvasElement, run: number): Promise<{ analysis: FoodAnalysis; match: FoodMatchResponse; matchError: string }> {
    const current = () => aliveRef.current && run === runRef.current;
    setStage(isFoodModelLoaded() ? "फोटो तैयार हो रही है…" : "पहली बार: खाना पहचानने वाला मॉडल डाउनलोड हो रहा है (लगभग 15 MB, एक ही बार)…");
    await loadFoodModel((s) => {
      if (!current()) return;
      if (s === "model") setStage("मॉडल लोड हो रहा है…");
      if (s === "ready") setStage("खाना पहचान रहे हैं…");
    });
    if (current()) setStage("खाना पहचान रहे हैं…");
    const result = await analyseFoodPhoto(canvas, 8);
    if (current()) setStage("पिछले खाने से मिला रहे हैं…");
    let found: FoodMatchResponse = EMPTY_MATCH;
    let failure = "";
    try {
      found = await matchFoodPhoto(patientId, result.embedding, result.predictions);
    } catch (err) {
      failure = err instanceof Error ? err.message : "सुझाव नहीं मिल सके";
    }
    return { analysis: result, match: found, matchError: failure };
  }

  async function handlePhoto(file: File) {
    cancelRun();
    const run = runRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => aliveRef.current && run === runRef.current;

    setError("");
    setStep("analysing");
    savedRef.current = [];
    setAnalysis(null);
    setMatch(null);
    setMatchError("");
    setMealAi(null);
    setAiState("idle");
    setSlow(false);
    deviceFailRef.current = null;
    setDeviceState("running");
    try {
      setStage("फोटो तैयार हो रही है…");
      const canvas = await decodePhoto(file, 1280);
      if (!current()) return;
      photoRef.current = canvas;
      setPhoto(canvas);
      setPreview(previewDataUrl(canvas, 800));

      // The phone's model and (when the family said yes) the AI reader work at the same time.
      const now = planRef.current;
      const wantsAi = now === "ai" && !pausedRef.current;
      let aiPromise: Promise<MealAiOutcome> | null = null;
      // On a metered connection ("data saver") the 15 MB model is not downloaded before AI has answered.
      const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
      const deferDevice = wantsAi && !isFoodModelLoaded() && connection?.saveData === true;
      if (deferDevice) aiPromise = startAi(canvas, run);

      const devicePromise = (aiPromise ? aiPromise.then(() => runDevice(canvas, run)) : runDevice(canvas, run)).then((r) => {
        if (current()) {
          setAnalysis(r.analysis);
          setMatch(r.match);
          setMatchError(r.matchError);
          setDeviceState("done");
        }
        return r;
      });
      // A failure is judged once both have answered (below); this only keeps it from being reported twice.
      devicePromise.catch((err: unknown) => {
        if (!current()) return;
        deviceFailRef.current = err;
        setDeviceState("failed");
      });

      if (wantsAi && !aiPromise) {
        if (isFoodModelLoaded()) {
          // The model is in memory: the phone answers in about a second. A plate the family has logged before needs
          // no AI at all (the dialog offers it on request).
          const early = await within(devicePromise.catch(() => null), EARLY_DEVICE_MS);
          if (!current()) return;
          if (early && learnedCoversPlate(early.match.learned)) setAiState("skipped");
          else aiPromise = startAi(canvas, run);
        } else {
          // The first photo: do not wait for a 15 MB download, ask AI straight away.
          aiPromise = startAi(canvas, run);
        }
      } else if (now === "ask") {
        // Never asked: ask now, with this photo in hand; the phone's model goes on meanwhile.
        setAsked(true);
        setConsentOpen(true);
      }

      const [device, ai] = await Promise.allSettled([devicePromise, aiPromise ?? Promise.resolve(null)]);
      if (!current()) return;
      const aiAnswered = ai.status === "fulfilled" && ai.value !== null && ai.value.status === "ok";
      if (device.status === "rejected") {
        // Only when BOTH could not help is it an error; an AI-only answer is a result.
        if (!aiAnswered) {
          setError(describeFailure(device.reason));
          setStep("pick");
          return;
        }
        setMatch(EMPTY_MATCH);
        setDeviceState("failed");
      }
      setStep((s) => (s === "analysing" ? "choose" : s));
    } catch (err) {
      if (!current()) return;
      setError(describeFailure(err));
      setStep("pick");
    }
  }

  /** "AI से फिर देखें": the same photo, read by AI now (after it was skipped because a learned plate matched). */
  async function retryAi() {
    const canvas = photoRef.current;
    if (!canvas || aiState === "running" || aiState === "second") return;
    const run = runRef.current;
    if (!abortRef.current || abortRef.current.signal.aborted) abortRef.current = new AbortController();
    await startAi(canvas, run);
  }

  const estimates = picked.map((p) => ({ p, e: estimate(p) }));
  const allValid = picked.length > 0 && estimates.every((x) => x.e !== null);
  const totalKcal = estimates.reduce((n, x) => n + (x.e?.kcal ?? 0), 0);
  const tooMuch = totalKcal > MEAL_PLATE_KCAL_CAP;

  // Early reveal: the phone's learned plates, or what AI named, are shown without waiting for the slower reader.
  const aiRunning = aiState === "running" || aiState === "second";
  const aiHasItems = mealAi !== null && mealAi.items.length > 0;
  const learnedNow = (match?.learned.length ?? 0) > 0;
  // A slow AI answer: after a few seconds the person may go on without it.
  useEffect(() => {
    if (!aiRunning) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [aiRunning]);

  function stopWaitingForAi() {
    abortRef.current?.abort();
  }

  // (Adjusting state while rendering: the documented pattern for state derived from other state; it only fires once.)
  if (step === "analysing" && (aiHasItems || (deviceState === "done" && (learnedNow || !aiRunning)))) setStep("choose");

  async function save() {
    if (!allValid || !photo) return;
    setStep("saving");
    setError("");
    const saved: FoodPhotoFood[] = [];
    try {
      for (const { p, e } of estimates) {
        if (!e) continue;
        const qty = parseFloat(p.quantity);
        const portion = p.portions.find((x) => x.id === p.portionId) ?? p.portions[0] ?? null;
        const per100 = (n: number | null | undefined) => ((n ?? 0) / 100) * e.grams;
        const unit = portion ? loggedUnit(portion.portion_name) : p.food.reference_unit;
        await logFood({
          patient_id: patientId,
          food_item_id: isCatalogueId(p.food.id) ? p.food.id : null,
          meal_type: mealType,
          food_name: p.food.name_hi ? `${p.food.name} (${p.food.name_hi})` : p.food.name,
          quantity: qty,
          unit,
          standardized_grams: Math.round(e.grams),
          calories: e.kcal,
          protein_g: Math.round(per100(p.food.protein_g_100g)),
          carbs_g: Math.round(per100(p.food.carbs_g_100g)),
          fat_g: Math.round(per100(p.food.fat_g_100g)),
          fibre_g: Math.round(per100(p.food.fibre_g_100g)),
          sodium_mg: p.food.sodium_mg_100g ? Math.round(per100(p.food.sodium_mg_100g)) : null,
          oil_quantity: "None",
          oil_calories: 0,
          calorie_confidence: e.confidence,
          source_type: p.food.calories_per_100g == null ? "user_entered" : p.food.source_type,
          source_note: p.fromAi ? "Logged from a meal photo (AI-assisted)" : "Logged from a meal photo",
          consumed_at: consumedAt ?? consumedAtFor(logDate, mealType, todayIST()),
          notes: null,
        });
        const item: FoodPhotoFood = { food_item_id: isCatalogueId(p.food.id) ? p.food.id : null, name: p.food.name, quantity: qty, unit, calories: e.kcal };
        saved.push(item);
        savedRef.current.push(item);
        // Off the list as soon as it is in the database, so a retry after a failure logs only the rest.
        setPicked((list) => list.filter((x) => x.key !== p.key));
      }
      // Remember what the person CONFIRMED (the foods just logged, including anything logged before a retry), never what a
      // model said: a mistake the person removed or replaced is not learned. Without the phone's embedding (only AI
      // answered) there is nothing to key a plate on, so nothing is remembered.
      const plate = savedRef.current;
      const plateKcal = plate.reduce((n, f) => n + f.calories, 0);
      let remembered = false;
      if (analysis) {
        try {
          await rememberFoodPhoto({ patientId, mealType, foods: plate, embedding: analysis.embedding, thumbnail: thumbnailDataUrl(photo, 64) });
          remembered = true;
        } catch {
          remembered = false;
        }
      }
      toast.success(
        `${plate.length} चीज़ें दर्ज हुईं · ~${plateKcal} kcal`,
        remembered ? "यह खाना याद रख लिया: अगली बार फोटो से तुरंत पहचान जाएगा।" : analysis ? "फोटो याद नहीं रखी जा सकी (खाना दर्ज हो गया है)।" : undefined,
      );
      onLogged({ complete: true });
      onClose();
    } catch (err) {
      const why = err instanceof Error && /[ऀ-ॿ]/.test(err.message) ? err.message : "इंटरनेट जाँचकर फिर कोशिश करें।";
      // Everything on the list that is not in the database yet (the failed one and those after it).
      const { unsaved } = summariseMealSave({ rows: estimates.length, ready: estimates.length, savedNow: saved.length, unparsed: 0 });
      setError(unsavedMessage({ unsaved: Math.max(1, unsaved), savedTotal: savedRef.current.length, hint: why }));
      setStep("choose");
      // Part of the plate is saved: the page behind refreshes, but this dialog stays open with the rest to retry.
      if (saved.length > 0) onLogged({ complete: false });
    }
  }

  function anotherPhoto() {
    cancelRun();
    setStep("pick");
  }

  const hint = mealPhotoHint({ ...hintState, canChange: hintState.canChange && !asked });
  const showAiSection = aiState === "running" || aiState === "second" || (aiState === "done" && mealAi !== null);
  const aiCanRun = plan === "ai" && !aiPaused;
  const suggestionFoods = match?.suggestions.some((s) => s.foods.length > 0) ?? false;
  // The phone's classifier chips are noisy next to a real read: held back while AI works, hidden when it named items.
  const showClassifier = !aiRunning && !aiHasItems;

  // In the list step the message sits in the pinned footer, beside the button that retries: a long list scrolls.
  const footer =
    step === "choose" ? (
      <div className="space-y-2">
        {error ? (
          <p role="alert" className="rounded-card border border-critical-line bg-critical-soft p-3 text-sm font-medium text-critical">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" onClick={anotherPhoto}>
            <Camera aria-hidden className="h-4 w-4" />
            <span lang="hi">दूसरी फोटो</span>
          </Button>
          <Button variant="primary" disabled={!allValid} onClick={() => void save()}>
            <Utensils aria-hidden className="h-4 w-4" />
            <span lang="hi">{picked.length > 0 ? `${picked.length} चीज़ें दर्ज करें (~${totalKcal} kcal)` : "पहले खाना चुनें"}</span>
          </Button>
        </div>
      </div>
    ) : undefined;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Log a meal from a photo" hindiTitle="खाने की फोटो से दर्ज करें" size="lg" footer={footer} closeOnBackdrop={step === "pick"}>
        <div className="space-y-5">
          {error && step !== "choose" ? (
            <p role="alert" className="rounded-card border border-critical-line bg-critical-soft p-3 text-sm font-medium text-critical">
              {error}
            </p>
          ) : null}

          {step === "pick" ? (
            <>
              <p lang="hi" className="text-sm text-ink-muted">
                थाली या प्लेट की फोटो ऊपर से लें, पूरा खाना दिखे। ऐप फोटो देखकर खाना सुझाएगा; आप चुनकर मात्रा तय करें।
              </p>
              <PhotoPicker onPhoto={(f) => void handlePhoto(f)} captureLabel="खाने की फोटो लें" hint={hint} />
            </>
          ) : null}

          {step === "analysing" ? (
            <div role="status" aria-live="polite" className="tile space-y-2 rounded-card p-4">
              <div className="flex items-center gap-3">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the person's own photo, just taken
                  <img src={preview} alt="" className="h-16 w-16 shrink-0 rounded-control object-cover" />
                ) : null}
                <div className="min-w-0 space-y-1">
                  <p lang="hi" className="text-sm text-ink">
                    {stage}
                  </p>
                  {aiRunning ? (
                    <p lang="hi" className="text-xs text-ink-muted">
                      {aiState === "second" ? "दूसरी बार मिलाकर देख रहे हैं…" : "साथ में AI से भी थाली देख रहे हैं…"}
                    </p>
                  ) : null}
                </div>
              </div>
              {aiRunning && slow ? (
                <Button variant="ghost" size="sm" onClick={stopWaitingForAi}>
                  <span lang="hi">AI का इंतज़ार न करें, फ़ोन का नतीजा दिखाएँ</span>
                </Button>
              ) : null}
            </div>
          ) : null}

          {(step === "choose" || step === "saving") && (match ?? mealAi) ? (
            <>
              <div className="flex items-start gap-3">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the person's own photo, just taken
                  <img src={preview} alt="आपकी खाने की फोटो" className="h-24 w-24 shrink-0 rounded-card object-cover ring-1 ring-line" />
                ) : null}
                <div className="min-w-0 text-sm text-ink-muted">
                  <p lang="hi">नीचे के सुझावों में से जो थाली में है उसे टैप करें, मात्रा जाँचें और दर्ज करें।</p>
                  {matchError && !aiHasItems ? (
                    <p lang="hi" className="mt-1 text-xs text-attention">
                      सुझाव नहीं मिल सके ({matchError}); खोजकर जोड़ें।
                    </p>
                  ) : null}
                  {deviceState === "running" ? (
                    <p lang="hi" className="mt-1 text-xs text-ink-subtle">
                      फ़ोन पर भी मिलाकर देख रहे हैं; पहले दर्ज की थालियाँ आने पर ऊपर दिखेंगी।
                    </p>
                  ) : null}
                </div>
              </div>

              {match && match.learned.length > 0 ? (
                <section aria-labelledby="learned-heading" className="space-y-2">
                  <h3 id="learned-heading" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <History aria-hidden className="h-4 w-4 text-brand" />
                    <span lang="hi">पहले जैसा खाना</span>
                    <span className="text-xs font-normal text-ink-subtle">आपकी पिछली फोटो से</span>
                  </h3>
                  <ul className="space-y-2">
                    {match.learned.map((m) => (
                      <li key={m.exampleId} className="tile flex items-center gap-3 rounded-card p-3">
                        {isDataImage(m.thumbnail) ? (
                          // eslint-disable-next-line @next/next/no-img-element -- stored 64px thumbnail
                          <img src={m.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded-control object-cover" />
                        ) : (
                          <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-control bg-food-soft text-food">
                            <Utensils className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{m.foods.map((f) => f.name).join(", ")}</p>
                          <p className="text-xs text-ink-muted">
                            <Badge variant={m.similarity >= 0.85 ? "positive" : "info"}>{Math.round(m.similarity * 100)}% मेल</Badge>{" "}
                            {m.foods.reduce((n, f) => n + f.calories, 0)} kcal
                          </p>
                        </div>
                        <Button variant="primary" size="sm" onClick={() => void addLearned(m)}>
                          <Check aria-hidden className="h-4 w-4" />
                          <span lang="hi">यही है</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {aiState === "skipped" && aiCanRun ? (
                    <Button variant="ghost" size="sm" onClick={() => void retryAi()}>
                      <Sparkles aria-hidden className="h-4 w-4" />
                      <span lang="hi">AI से फिर देखें</span>
                    </Button>
                  ) : null}
                </section>
              ) : null}

              {showAiSection ? (
                <AiSeenSection
                  state={aiState}
                  read={mealAi}
                  picked={picked}
                  tooMuch={tooMuch}
                  slow={slow}
                  onStop={stopWaitingForAi}
                  onAdd={(item, pick) => void addAiPick(item, pick)}
                  onSearch={(text) => {
                    handleQuery(text);
                    searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                />
              ) : null}

              {showClassifier && suggestionFoods ? (
                <section aria-labelledby="seen-heading" className="space-y-2">
                  <h3 id="seen-heading" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <Sparkles aria-hidden className="h-4 w-4 text-brand" />
                    <span lang="hi">फोटो में ऐसा लग रहा है</span>
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {(match?.suggestions ?? []).flatMap((s) =>
                      s.foods.map((f) => (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => void addSuggestion(f)}
                            className={cn(
                              "pressable inline-flex min-h-control cursor-pointer items-center gap-1.5 rounded-field border px-3 text-sm font-medium",
                              picked.some((p) => p.food.id === f.id) ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink hover:border-gold-line",
                            )}
                          >
                            <span aria-hidden>{f.emoji ?? getExactFoodEmoji(f.name, f.category)}</span>
                            <span className="max-w-48 truncate">
                              {f.name}
                              {f.name_hi ? <span lang="hi" className="ml-1 text-ink-muted">({f.name_hi})</span> : null}
                            </span>
                            <Plus aria-hidden className="h-3.5 w-3.5 text-ink-subtle" />
                          </button>
                        </li>
                      )),
                    )}
                  </ul>
                </section>
              ) : showClassifier && !aiHasItems ? (
                <p lang="hi" className="rounded-card border border-line bg-surface-sunken p-3 text-xs text-ink-muted">
                  फोटो से कोई पक्का भोजन नहीं पहचाना गया। नीचे से चुनें या खोजें; दर्ज करने के बाद ऐप इस थाली को याद रख लेगा।
                </p>
              ) : null}

              {usual.length > 0 ? (
                <section aria-labelledby="usual-heading" className="space-y-2">
                  <h3 id="usual-heading" className="text-sm font-semibold text-ink">
                    <span lang="hi">इस समय का आपका नियमित भोजन</span>
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {usual.map((q) => (
                      <li key={q.canonicalKey}>
                        <button
                          type="button"
                          onClick={() => void addUsual(q)}
                          className="pressable inline-flex min-h-control cursor-pointer items-center gap-1.5 rounded-field border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-gold-line"
                        >
                          <span aria-hidden>{getExactFoodEmoji(q.name, q.category)}</span>
                          <span className="max-w-40 truncate">{q.name}</span>
                          <Plus aria-hidden className="h-3.5 w-3.5 text-ink-subtle" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section ref={searchRef} className="space-y-2">
                <Field label="कुछ और खोजें (Search)" labelHidden>
                  <div className="relative">
                    <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
                    <TextInput inputMode="search" autoComplete="off" placeholder="कुछ और खोजें, जैसे रोटी, दाल, सलाद" value={query} onChange={(e) => handleQuery(e.target.value)} className="pl-10" />
                  </div>
                </Field>
                {hits.length > 0 ? (
                  <ul className="divide-y divide-line rounded-card border border-line bg-surface">
                    {hits.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => {
                            void addFood(f);
                            handleQuery("");
                          }}
                          className="flex min-h-control w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-ink hover:bg-surface-sunken"
                        >
                          <span aria-hidden>{f.emoji ?? getExactFoodEmoji(f.name, f.category)}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {f.name}
                            {f.name_hi ? <span lang="hi" className="ml-1 text-ink-muted">({f.name_hi})</span> : null}
                          </span>
                          <Plus aria-hidden className="h-4 w-4 text-ink-subtle" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <section aria-labelledby="picked-heading" className="space-y-2 border-t border-line pt-4">
                <h3 id="picked-heading" className="flex items-center justify-between text-sm font-semibold text-ink">
                  <span lang="hi">थाली में क्या है ({picked.length})</span>
                  {picked.length > 0 ? <span className="tabular text-xs font-normal text-ink-muted">कुल ~{totalKcal} kcal</span> : null}
                </h3>
                {tooMuch ? (
                  <p role="status" lang="hi" className="flex items-start gap-2 rounded-card border border-attention-line bg-attention-soft p-3 text-xs text-ink">
                    <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-attention" />
                    <span>बहुत ज़्यादा लग रहा है: एक थाली के लिए ~{totalKcal} kcal। चीज़ें और मात्रा जाँच लें।</span>
                  </p>
                ) : null}
                {picked.length === 0 ? (
                  <p lang="hi" className="text-xs text-ink-subtle">
                    ऊपर के सुझावों से या खोजकर खाना जोड़ें।
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {estimates.map(({ p, e }) => (
                      <li key={p.key} className="tile space-y-2 rounded-card p-3">
                        <div className="flex items-center gap-2">
                          <span aria-hidden className="text-lg">{p.food.emoji ?? getExactFoodEmoji(p.food.name, p.food.category)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink">
                              {p.food.name}
                              {p.food.name_hi ? <span lang="hi" className="ml-1 font-normal text-ink-muted">({p.food.name_hi})</span> : null}
                            </p>
                            {p.aiSeen ? (
                              <p lang="hi" className="truncate text-xs text-ink-subtle">
                                फोटो में: {p.aiSeen.name}
                                {p.aiSeen.nameHi ? ` · ${p.aiSeen.nameHi}` : ""}
                              </p>
                            ) : null}
                          </div>
                          <span className="tabular shrink-0 text-xs font-semibold text-brand-ink">{e ? `~${e.kcal} kcal` : "—"}</span>
                          <IconButton variant="ghost" size="sm" aria-label={`${p.food.name} हटाएँ`} onClick={() => setPicked((list) => list.filter((x) => x.key !== p.key))}>
                            <Trash2 aria-hidden className="h-4 w-4" />
                          </IconButton>
                        </div>
                        {p.aiEstimated ? (
                          <p lang="hi" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                            <Badge variant="attention">
                              <Sparkles aria-hidden className="h-3 w-3" />
                              <span lang="hi">लगभग · अंदाज़ा</span>
                            </Badge>
                            <span>मात्रा AI के अंदाज़े की है; थाली से मिलाकर बदल लें।</span>
                          </p>
                        ) : null}
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="मात्रा की इकाई">
                            {p.portions.length > 0 ? (
                              <Select value={p.portionId} onChange={(ev) => update(p.key, { portionId: ev.target.value })}>
                                {p.portions.map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.portion_name_hi || x.portion_name} (~{x.standardized_grams}g)
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <Select value="default" disabled onChange={() => {}}>
                                <option value="default">{p.food.reference_unit} ({p.food.reference_weight_g || 100} g)</option>
                              </Select>
                            )}
                          </Field>
                          <Field label="कितनी?" error={p.quantity && !estimate({ ...p, manualKcal: p.manualKcal || "1" }) ? "0 से 20 के बीच" : undefined}>
                            <NumberInput allowDecimal maxLength={5} value={p.quantity} onChange={(ev) => update(p.key, { quantity: ev.target.value })} />
                          </Field>
                        </div>
                        {p.food.calories_per_100g == null ? (
                          <Field label="एक मात्रा की कैलोरी (kcal)" hint="इसकी कैलोरी सूची में नहीं है; अंदाज़े से लिखें" required>
                            <NumberInput allowDecimal maxLength={5} placeholder="जैसे 120" value={p.manualKcal} onChange={(ev) => update(p.key, { manualKcal: ev.target.value })} />
                          </Field>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}

          {step === "saving" ? (
            <p role="status" lang="hi" className="text-sm text-ink-muted">
              दर्ज हो रहा है…
            </p>
          ) : null}
        </div>
      </Modal>

      {/* Never asked, the photo is in hand, and this person may answer: the phone's model goes on meanwhile. */}
      <AiConsentDialog
        isOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        patientId={patientId}
        need="photos"
        onDecided={(granted) => {
          // Yes: read this very photo with AI now. No: the phone's result is already on its way.
          const canvas = photoRef.current;
          if (!granted || !canvas || !aliveRef.current) return;
          const run = runRef.current;
          setError("");
          setStep((s) => (s === "pick" ? "analysing" : s));
          void startAi(canvas, run).then((outcome) => {
            if (!aliveRef.current || run !== runRef.current) return;
            if (outcome.status === "ok") setStep((s) => (s === "analysing" ? "choose" : s));
            else if (deviceFailRef.current !== null) {
              // The phone's model had failed and AI did not help either: that is the (only) error to show.
              setError(describeFailure(deviceFailRef.current));
              setStep("pick");
            }
          });
        }}
      />
    </>
  );
}

/**
 * "फोटो में AI ने देखा": each name the reader gave, with what it was mapped to. A sure match is already on the
 * plate below; a likely one is a chip ("क्या यह है?"); a name the catalogue does not know is a search to run.
 */
function AiSeenSection({
  state,
  read,
  picked,
  tooMuch,
  slow,
  onStop,
  onAdd,
  onSearch,
}: {
  state: AiState;
  read: MealAiRead | null;
  picked: Picked[];
  tooMuch: boolean;
  slow: boolean;
  onStop: () => void;
  onAdd: (item: MealMapped, pick: MealPick) => void;
  onSearch: (text: string) => void;
}) {
  const running = state === "running" || state === "second";
  const items = (read?.result.items ?? []).filter((m) => !m.duplicate);
  const onPlate = (id: string) => picked.some((p) => p.food.id === id);
  return (
    <section aria-labelledby="ai-seen-heading" className="space-y-2">
      <h3 id="ai-seen-heading" className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
        <Sparkles aria-hidden className="h-4 w-4 text-brand" />
        <span lang="hi">फोटो में AI ने देखा</span>
        <span className="text-xs font-normal text-ink-subtle">What AI saw in the photo</span>
        <Badge variant="info">AI</Badge>
      </h3>

      {running ? (
        <p role="status" aria-live="polite" lang="hi" className="tile flex items-center gap-3 rounded-card p-3 text-sm text-ink">
          <span className="st-spinner h-5 w-5 shrink-0 rounded-full border-2 border-line border-t-brand" aria-hidden />
          <span className="min-w-0 flex-1">{state === "second" ? "दूसरी बार मिलाकर देख रहे हैं…" : "AI थाली देख रहा है…"}</span>
          {slow ? (
            <Button variant="ghost" size="sm" onClick={onStop}>
              <span lang="hi">इंतज़ार न करें</span>
            </Button>
          ) : null}
        </p>
      ) : null}

      {!running && read && items.length === 0 ? (
        <p lang="hi" className="rounded-card border border-line bg-surface-sunken p-3 text-xs text-ink-muted">
          {read.reasons.includes("not_food") || read.imageKind === "other"
            ? "यह खाने की फोटो नहीं लग रही। खाने की फोटो लें, या नीचे से खोजकर चुनें।"
            : "AI को इस फोटो में कोई खाना साफ़ नहीं दिखा। नीचे से चुनें या खोजें।"}
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="tile divide-y divide-line rounded-card">
          {items.map((m) => {
            return (
              <li key={m.key} className="space-y-2 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">
                      {m.status === "selected" && m.pick ? (
                        <>
                          {m.pick.name}
                          {m.pick.nameHi ? <span lang="hi" className="ml-1 font-normal text-ink-muted">({m.pick.nameHi})</span> : null}
                        </>
                      ) : (
                        <>
                          <span lang="hi">फोटो में:</span> {m.aiName}
                          {m.aiNameHi ? <span lang="hi" className="ml-1 font-normal text-ink-muted">({m.aiNameHi})</span> : null}
                        </>
                      )}
                    </p>
                    {m.status === "selected" ? (
                      <p lang="hi" className="text-xs text-ink-subtle">
                        फोटो में: {m.aiName}
                        {m.aiNameHi ? ` · ${m.aiNameHi}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {m.status === "selected" && m.pick ? (
                    onPlate(m.pick.foodId) ? (
                      <Badge variant="positive">
                        <Check aria-hidden className="h-3 w-3" />
                        <span lang="hi">थाली में जुड़ा</span>
                      </Badge>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => onAdd(m, m.pick as MealPick)}>
                        <Plus aria-hidden className="h-4 w-4" />
                        <span lang="hi">फिर जोड़ें</span>
                      </Button>
                    )
                  ) : null}
                </div>

                {m.status === "candidates" ? (
                  <div className="space-y-1.5">
                    <p lang="hi" className="text-xs text-ink-muted">
                      {m.heldBack === "plate_cap" ? "थाली बहुत बड़ी हो रही थी, इसलिए अपने-आप नहीं जोड़ा। क्या यह है?" : "क्या यह है?"}
                    </p>
                    <ul className="flex flex-wrap gap-2">
                      {m.candidates.map((c) => (
                        <li key={c.foodId}>
                          <button
                            type="button"
                            disabled={onPlate(c.foodId)}
                            onClick={() => onAdd(m, c)}
                            className={cn(
                              "pressable inline-flex min-h-control max-w-full cursor-pointer items-center gap-1.5 rounded-field border px-3 text-sm font-medium",
                              onPlate(c.foodId) ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink hover:border-gold-line",
                            )}
                          >
                            <span aria-hidden>{c.summary.emoji ?? getExactFoodEmoji(c.name, c.category)}</span>
                            <span className="truncate">{c.name}</span>
                            {onPlate(c.foodId) ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Plus aria-hidden className="h-3.5 w-3.5 text-ink-subtle" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {m.status === "unmatched" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span lang="hi" className="text-xs text-ink-muted">सूची में पक्का नहीं मिला।</span>
                    <Button variant="secondary" size="sm" onClick={() => onSearch(m.searchQuery)}>
                      <Search aria-hidden className="h-4 w-4" />
                      <span lang="hi">खोजें</span>
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {read && read.reasons.includes("partial_list") ? (
        <p lang="hi" className="text-xs text-ink-subtle">सूची लंबी थी; कुछ चीज़ें छूट सकती हैं। नीचे से और जोड़ें।</p>
      ) : null}
      {read && read.result.capped && !tooMuch ? (
        <p lang="hi" className="text-xs text-attention">थाली का कुल बहुत ज़्यादा बन रहा था, इसलिए कुछ चीज़ें अपने-आप नहीं जोड़ीं।</p>
      ) : null}
      {read ? (
        <p lang="hi" className="text-xs text-ink-subtle">
          मात्रा AI का अंदाज़ा है, पक्की नहीं; दर्ज करने से पहले थाली से मिला लें।
        </p>
      ) : null}
    </section>
  );
}
