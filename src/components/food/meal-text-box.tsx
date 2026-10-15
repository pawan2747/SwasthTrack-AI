"use client";

import { useRef, useState } from "react";
import { MessageSquareText, Sparkles } from "lucide-react";
import { EmergencyBanner } from "@/components/ask/emergency-banner";
import { VoiceInput } from "@/components/ask/voice-input";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/form-field";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/context/auth-context";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { AI_MEAL_WORDS_NOTE } from "@/lib/ai-disclosure";
import { isEmergencyMealOutcome } from "@/lib/food/meal-save";
import { cn } from "@/lib/utils";
import { MealReview } from "@/components/food/meal-review";
import { explainWithAi, loadMealCatalogue, parseMeal, warmMealCatalogue, type MealCatalogue, type MealParseOutcome, type MealResolution } from "@/services/meal-parse-service";

type Props = {
  patientId: string;
  /** The meal chosen on the page (the text may name another). */
  mealType: string;
  /** The IST day the page is showing. */
  logDate: string;
  /** Exact instant, when the caller has one. */
  consumedAt?: string;
  /**
   * Called after rows were saved, so the page can refresh its list. `complete` is false when part of the meal is
   * still on the review list (a row failed, or waits for a food): a host that closes itself must then only
   * refresh, or the person never sees what was left.
   */
  onLogged: (result: { complete: boolean }) => void;
  /** Less chrome, for use inside a dialog. */
  compact?: boolean;
  className?: string;
};

const MAX_CHARS = 300;

function noteFor(step: MealParseOutcome["ai"], unplaced: number): string | null {
  if (unplaced === 0) return null;
  switch (step.reason) {
    case "offline":
      return "इंटरनेट नहीं है, इसलिए सिर्फ़ ऐप के नियमों से समझा। जो न मिला, उसे खोजकर चुनें।";
    case "rate_limited":
      return "आज की AI सीमा पूरी हो गई है। जितना ऐप समझ सका वह नीचे है; बाकी खोजकर चुनें।";
    case "unavailable":
      return "AI अभी जवाब नहीं दे पाया। जितना ऐप समझ सका वह नीचे है; बाकी खोजकर चुनें।";
    default:
      return null;
  }
}

/**
 * "बोलकर या लिखकर पूरा खाना दर्ज करें": one sentence, one confirm list.
 *
 * The sentence is read on the phone with the app's own rules and the food catalogue; that is the whole feature
 * when AI is off, unasked or unreachable. Only phrases nothing could place go to a model, and only when the family
 * allowed text AI. A tap never changes what is saved: the review list shows every row and the person confirms.
 */
export function MealTextBox({ patientId, mealType, logDate, consumedAt, onLogged, compact = false, className }: Props) {
  const { canWrite } = useAuth();
  const ai = useAiSettings(patientId);
  const toast = useToast();
  const [text, setText] = useState("");
  const [spoken, setSpoken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [session, setSession] = useState<{ input: string; outcome: MealParseOutcome; catalogue: MealCatalogue; id: number } | null>(null);
  const seq = useRef(0);

  if (!canWrite) return null;

  const trimmed = text.trim();

  async function understand() {
    if (busy || trimmed.length < 2) return;
    setBusy(true);
    setError("");
    try {
      const catalogue = await loadMealCatalogue();
      const outcome = await parseMeal({
        patientId,
        text: trimmed,
        mealType,
        source: spoken ? "voice" : "text",
        aiOn: ai.textOn,
        aiUnasked: ai.textUnasked && ai.canChange,
      });
      const { resolution } = outcome;
      const urgent = isEmergencyMealOutcome(outcome);
      setEmergency(urgent);
      if (resolution.rows.length === 0 && resolution.unparsed.length === 0) {
        // An emergency sentence gets its card even when no food could be read from it.
        if (!urgent) setError("कोई खाना समझ नहीं आया। जैसे लिखें: 2 रोटी, 1 कटोरी दाल, थोड़ी सब्ज़ी, चाय");
        return;
      }
      seq.current += 1;
      setSession({ input: trimmed, outcome, catalogue, id: seq.current });
    } catch {
      setError("खाना पढ़ा नहीं जा सका। इंटरनेट जाँचकर दोबारा कोशिश करें, या ऊपर खोजकर दर्ज करें।");
    } finally {
      setBusy(false);
    }
  }

  const unplaced = session ? session.outcome.resolution.rows.filter((r) => r.match.status === "unmatched").length + session.outcome.resolution.unparsed.length : 0;

  // The "explain with AI" button needs AI to exist here, the family not to have said no, and someone who may decide.
  const explainable = ai.available && (ai.textOn || (ai.textUnasked && ai.canChange));

  async function runExplain(resolution: MealResolution): Promise<MealResolution | null> {
    if (!session) return null;
    const result = await explainWithAi({ patientId, resolution, mealType });
    if (isEmergencyMealOutcome(result)) {
      // The words the app could not place name an emergency symptom: show the fixed card, no toast about "AI busy".
      setSession((s) => (s ? { ...s, outcome: result } : s));
      setEmergency(true);
      return null;
    }
    if (result.ai.reason !== "used") {
      setSession((s) => (s ? { ...s, outcome: { resolution: s.outcome.resolution, ai: result.ai } } : s));
      toast.info(
        result.ai.reason === "offline"
          ? "इंटरनेट नहीं है"
          : result.ai.reason === "rate_limited"
            ? "आज की AI सीमा पूरी हो गई है"
            : "AI अभी जवाब नहीं दे पाया",
        "जो न मिला, उसे खोजकर चुनें।",
      );
      return null;
    }
    setSession((s) => (s ? { ...s, outcome: result } : s));
    return result.resolution;
  }

  return (
    <div className={cn(compact ? "space-y-2" : "tile space-y-3 rounded-card p-3 sm:p-4", className)}>
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-control bg-food-soft text-food ring-1 ring-food-line">
          <MessageSquareText className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            <span lang="hi">बोलकर या लिखकर पूरा खाना दर्ज करें</span>
          </p>
          <p className="text-xs text-ink-muted">Say or type the whole meal, e.g. 2 roti, 1 katori dal, chai</p>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <TextArea
          aria-label="आज क्या खाया — बोलकर या लिखकर"
          rows={2}
          maxLength={MAX_CHARS}
          autoComplete="off"
          spellCheck={false}
          placeholder="जैसे: 2 रोटी, 1 कटोरी दाल, थोड़ी सब्ज़ी और चाय"
          value={text}
          onFocus={() => warmMealCatalogue()}
          onChange={(e) => {
            setText(e.target.value);
            setSpoken(false);
            if (error) setError("");
          }}
          disabled={busy}
          className="min-h-16 flex-1"
        />
        <VoiceInput
          value={text}
          onChange={(next) => {
            setText(next);
            setSpoken(true);
            if (error) setError("");
          }}
          maxLength={MAX_CHARS}
          disabled={busy}
          className="mt-0.5"
        />
      </div>

      {emergency ? <EmergencyBanner onDismiss={() => setEmergency(false)} /> : null}

      {error ? (
        <p role="alert" lang="hi" className="rounded-card border border-attention-line bg-attention-soft p-2.5 text-xs text-ink-muted">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={busy} disabled={trimmed.length < 2} onClick={() => void understand()}>
          <Sparkles aria-hidden className="h-4 w-4" />
          <span lang="hi">समझें</span>
        </Button>
        {ai.textOn ? (
          <span lang="hi" className="text-xs text-ink-subtle">
            {AI_MEAL_WORDS_NOTE.hi}
          </span>
        ) : null}
      </div>

      {session ? (
        <MealReview
          key={session.id}
          isOpen
          onClose={() => setSession(null)}
          patientId={patientId}
          input={session.input}
          resolution={session.outcome.resolution}
          catalogue={session.catalogue}
          mealType={mealType}
          logDate={logDate}
          consumedAt={consumedAt}
          onLogged={(result) => {
            setText("");
            setSpoken(false);
            onLogged(result);
          }}
          explain={explainable ? { needsConsent: ai.textUnasked, run: runExplain } : null}
          note={noteFor(session.outcome.ai, unplaced)}
          emergency={isEmergencyMealOutcome(session.outcome)}
        />
      ) : null}
    </div>
  );
}
