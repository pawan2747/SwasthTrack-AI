"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { AI_NEVER_HEADING, AI_NEVER_SENDS, AI_OFF_NOTE, AI_PROVIDERS, AI_SENDS, AI_TERMS_NOTE, BROWSER_SPEECH_NOTE } from "@/lib/ai-disclosure";
import { consentNeeds, consentNoPatch, consentSeed, consentToast, consentYesPatch, consentYesTurnsOn, type ConsentNeed } from "@/lib/ai-panel-view";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { useToast } from "@/components/ui/toast";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  /** What the feature that opened this needs. Both switches are shown; the needed one is highlighted. */
  need?: ConsentNeed;
  /** Called after the family decided (true = the needed switch is now on). */
  onDecided?: (granted: boolean) => void;
};

/**
 * The first-use question: may AI read photos / write summaries for this family?
 * One decision per switch, stored on the server per patient, changeable any time in Settings.
 * Owner and editors decide; a viewer is told who can.
 *
 * Each box starts from what is STORED (an explicit "no" stays unticked) and "Yes" writes the switch this feature
 * needs plus any other switch the person changed: a click meant for photos cannot turn summaries back on, or the
 * other way round. The rules are pure functions in src/lib/ai-panel-view.ts, exercised by `npm run ai:eval`.
 */
export function AiConsentDialog(props: Props) {
  return props.isOpen ? <Body {...props} /> : null;
}

function Body({ onClose, patientId, need = "both", onDecided }: Props) {
  const ai = useAiSettings(patientId);
  const toast = useToast();
  // What the person changed in this dialog; null = untouched, so the box shows what is stored.
  const [picks, setPicks] = useState<{ photos: boolean | null; text: boolean | null }>({ photos: null, text: null });
  const [busy, setBusy] = useState(false);
  const needs = consentNeeds(need);

  const stored = ai.settings ? { photos: ai.settings.photos, text: ai.settings.text } : null;
  const seed = consentSeed(stored, need);
  const boxes = { photos: picks.photos ?? seed.photos, text: picks.text ?? seed.text };
  const yesPatch = consentYesPatch(need, boxes, seed);

  async function decide(grant: boolean) {
    setBusy(true);
    try {
      const patch = grant ? yesPatch : consentNoPatch(need);
      const next = await ai.save(patch);
      const granted = need === "photos" ? next.photos === true : need === "text" ? next.text === true : next.photos === true || next.text === true;
      const said = consentToast(patch, next);
      toast({ title: said.title, description: said.description, tone: said.tone });
      onDecided?.(granted);
      onClose();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "सेटिंग सेव नहीं हो सकी", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const viewer = ai.settings !== null && !ai.canChange;
  // A box this feature does not need, that the family already answered: say so, so an unticked box reads as "stays off".
  const alreadyOff = (kind: "photos" | "text") => !needs[kind] && stored !== null && stored[kind] === false;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Turn on AI help?"
      hindiTitle="AI सहायता चालू करें?"
      size="md"
      footer={
        viewer ? (
          <Button variant="primary" onClick={onClose}>
            <span lang="hi">ठीक है</span>
          </Button>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={busy} onClick={() => void decide(false)}>
              <span lang="hi">नहीं, AI के बिना</span>
            </Button>
            <Button variant="primary" loading={busy} disabled={!consentYesTurnsOn(yesPatch)} onClick={() => void decide(true)}>
              <span lang="hi">हाँ, चालू करें</span>
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4 text-sm text-ink">
        {viewer ? (
          <p lang="hi">यह सेटिंग सिर्फ़ मालिक या एडिटर बदल सकते हैं। उनसे कहें कि Settings &gt; AI सहायता में इसे चालू करें।</p>
        ) : (
          <>
            <p lang="hi">
              AI फोटो पढ़ने, रोज़ का सारांश लिखने और सवालों के जवाब देने में मदद करता है। यह चालू करने पर नीचे लिखी चीज़ें इंटरनेट पर AI सेवा को भेजी जाती हैं।
            </p>

            <div className="space-y-2">
              <label className="tile flex cursor-pointer items-start gap-3 rounded-card p-3">
                <input type="checkbox" checked={boxes.photos} onChange={(e) => setPicks((p) => ({ ...p, photos: e.target.checked }))} className="mt-1 h-5 w-5" />
                <span>
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    <span lang="hi">फोटो और आवाज़ AI से पढ़वाएँ</span>
                    {needs.photos ? <Badge variant="info">अभी ज़रूरी</Badge> : null}
                    {alreadyOff("photos") ? <Badge variant="neutral">अभी बंद</Badge> : null}
                  </span>
                  <span className="block text-xs text-ink-muted">Let AI read BP, weight, food and medicine photos, and short voice recordings</span>
                  <span lang="hi" className="mt-1 block text-xs text-ink-muted">
                    {BROWSER_SPEECH_NOTE.hi}
                  </span>
                </span>
              </label>
              <label className="tile flex cursor-pointer items-start gap-3 rounded-card p-3">
                <input type="checkbox" checked={boxes.text} onChange={(e) => setPicks((p) => ({ ...p, text: e.target.checked }))} className="mt-1 h-5 w-5" />
                <span>
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    <span lang="hi">सारांश, रुझान और जवाब AI से लिखवाएँ</span>
                    {needs.text ? <Badge variant="info">अभी ज़रूरी</Badge> : null}
                    {alreadyOff("text") ? <Badge variant="neutral">अभी बंद</Badge> : null}
                  </span>
                  <span className="block text-xs text-ink-muted">Let AI write summaries, trend notes and answers</span>
                </span>
              </label>
              {!consentYesTurnsOn(yesPatch) ? (
                <p lang="hi" className="text-xs text-ink-muted">
                  चालू करने के लिए ऊपर का बॉक्स चुनें; AI नहीं चाहिए तो &ldquo;नहीं, AI के बिना&rdquo; दबाएँ।
                </p>
              ) : null}
            </div>

            <div>
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <ShieldCheck aria-hidden className="h-4 w-4" />
                <span lang="hi">क्या भेजा जा सकता है</span>
              </h3>
              <ul className="list-disc space-y-1 pl-5">
                {AI_SENDS.map((x) => (
                  <li key={x.en} lang="hi">
                    {x.hi}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <span lang="hi">{AI_NEVER_HEADING.hi}</span>
              </h3>
              <ul className="list-disc space-y-1 pl-5">
                {AI_NEVER_SENDS.map((x) => (
                  <li key={x.en} lang="hi">
                    {x.hi}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-ink-muted">
              <span lang="hi">भेजने वाली सेवाएँ: </span>
              {AI_PROVIDERS.map((p) => p.name).join(" · ")}
            </p>
            <p lang="hi" className="text-xs text-ink-muted">
              {AI_TERMS_NOTE.hi}
            </p>
            <p lang="hi" className="text-xs text-ink-muted">
              {AI_OFF_NOTE.hi}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
