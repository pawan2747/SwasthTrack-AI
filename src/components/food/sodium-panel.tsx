"use client";

import { useEffect, useMemo, useState } from "react";
import { Droplets } from "lucide-react";
import { describeSodium, formatMg } from "@/lib/analytics/food-calc";
import {
  SWAP_DISCLAIMER_HI,
  buildSwapIndex,
  lighterOptions,
  sodiumContributors,
  type LighterOption,
  type SwapIndex,
  type SwapRow,
} from "@/lib/food/swaps";
import type { FoodLogEntry } from "@/services/patient-service";

/**
 * The day's sodium, said plainly: an estimate with what it counts and what it leaves out, a neutral bar with the two
 * usual reference marks, and (folded away) which foods carried most of it and lighter choices from the catalogue.
 *
 * Framing is deliberate. The catalogue's recipes assume salt, so an ordinary day lands above 2,300 mg; the tile never
 * grades the day or turns red, it shows coverage and the controllable add-ons instead. It is not shown at all until at
 * least one logged item carries sodium data.
 */

type Props = {
  /** That day's meals. */
  logs: FoodLogEntry[];
  /** `sumFoodLogs(logs)`. */
  totals: { sodium?: number; sodiumItems?: number; entries: number };
};

let indexPromise: Promise<SwapIndex> | null = null;

/** The bundled catalogue as a swap index. Loaded the first time the folded part is opened (the JSON chunk is shared with food search). */
function loadSwapIndex(): Promise<SwapIndex> {
  if (!indexPromise) {
    indexPromise = import("@/data/food-catalogue.json")
      .then((mod) => buildSwapIndex(((mod as { default?: unknown }).default ?? mod) as unknown as SwapRow[]))
      .catch((err) => {
        indexPromise = null; // let the next opening try again
        throw err;
      });
  }
  return indexPromise;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

export function SodiumPanel({ logs, totals }: Props) {
  const view = describeSodium(totals);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<SwapIndex | null>(null);

  useEffect(() => {
    if (!open || index) return;
    let live = true;
    loadSwapIndex()
      .then((i) => {
        if (live) setIndex(i);
      })
      .catch(() => {
        // No catalogue, no suggestions: the contributors below still show.
      });
    return () => {
      live = false;
    };
  }, [open, index]);

  const contributors = useMemo(() => (open ? sodiumContributors(logs, 3, index) : []), [open, logs, index]);

  // One best option per contributor first, then second options, three lines at most.
  const options = useMemo(() => {
    if (!index) return [] as LighterOption[];
    const perFood = contributors.map((c) => (c.row ? lighterOptions(c.row, index, { sodiumMg: c.sodiumMg, grams: c.grams }) : []));
    const picked: LighterOption[] = [];
    for (let round = 0; round < 3 && picked.length < 3; round += 1) {
      for (const list of perFood) {
        if (list[round] && picked.length < 3) picked.push(list[round]);
      }
    }
    return picked;
  }, [contributors, index]);

  if (!view) return null;

  return (
    <section aria-label="सोडियम का अनुमान" className="tile space-y-3 rounded-card p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-info-soft text-info ring-1 ring-info-line">
            <Droplets className="h-4 w-4" />
          </span>
          <h3 className="min-w-0 text-sm font-semibold text-ink">
            <span lang="hi">सोडियम (नमक का हिस्सा)</span> <span className="text-xs font-normal text-ink-muted">Sodium</span>
          </h3>
        </div>
        <p className="tabular shrink-0 text-xl font-semibold text-ink">{view.valueText}</p>
      </div>

      <div>
        <div role="img" aria-label={view.ariaLabel} className="relative h-3 rounded-full bg-surface-sunken">
          <span className="absolute inset-y-0 left-0 rounded-full bg-info/80" style={{ width: `${view.fillPct}%` }} />
          {view.marks.map((m) => (
            <span
              key={m.mg}
              aria-hidden
              className="absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded-full bg-ink-muted"
              style={{ left: `${m.pct}%` }}
            />
          ))}
        </div>
        <div aria-hidden className="relative mt-1.5 h-4">
          {view.marks.map((m) => (
            <span key={m.mg} className="tabular absolute -translate-x-1/2 text-2xs text-ink-muted" style={{ left: `${m.pct}%` }}>
              {formatMg(m.mg)}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p lang="hi" className="text-xs text-ink-muted">
          {view.coverageText}
        </p>
        <p lang="hi" className="text-xs text-ink-muted">
          {view.untrackedText}
        </p>
        <p lang="hi" className="text-xs text-ink-muted">
          {view.referenceText}
        </p>
      </div>

      <details
        className="rounded-control border border-line bg-surface/60"
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="flex min-h-control cursor-pointer items-center justify-between gap-2 px-3 text-sm font-semibold text-ink">
          <span lang="hi">किससे आया और हल्के विकल्प</span>
          <span className="text-xs font-normal text-ink-muted">Sources &amp; lighter options</span>
        </summary>
        <div className="space-y-3 px-3 pb-3">
          {contributors.length === 0 ? (
            <p lang="hi" className="text-xs text-ink-muted">
              किसी एक चीज़ से 50 mg से ज़्यादा सोडियम का डेटा नहीं है।
            </p>
          ) : (
            <ol aria-label="सबसे ज़्यादा सोडियम वाली चीज़ें" className="space-y-2">
              {contributors.map((c) => (
                <li key={c.key} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span lang="hi" className="break-words font-medium text-ink">
                      {c.name}
                    </span>
                    {c.nameEn && c.nameEn !== c.name ? <span className="block break-words text-xs text-ink-muted">{c.nameEn}</span> : null}
                  </span>
                  <span className="tabular shrink-0 text-ink">
                    ~{formatMg(round10(c.sodiumMg))} mg <span className="text-xs text-ink-muted">· {c.sharePct}%</span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {contributors.length > 0 && index ? (
            options.length > 0 ? (
              <div className="space-y-2 border-t border-line pt-3">
                <h4 className="text-xs font-semibold text-ink">
                  <span lang="hi">हल्के विकल्प</span> <span className="font-normal text-ink-muted">Lighter options</span>
                </h4>
                <ul className="space-y-2">
                  {options.map((o) => (
                    <li key={`${o.kind}-${o.to.id}-${o.savesMg}`} className="text-sm">
                      <p lang="hi" className="break-words text-ink">
                        {o.line}
                      </p>
                      <p className="break-words text-xs text-ink-muted">{o.lineEn}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p lang="hi" className="border-t border-line pt-3 text-xs text-ink-muted">
                इन चीज़ों के लिए सूची में कोई मिलता-जुलता हल्का विकल्प नहीं मिला।
              </p>
            )
          ) : null}

          <p lang="hi" className="text-xs text-ink-muted">
            {SWAP_DISCLAIMER_HI}
          </p>
        </div>
      </details>
    </section>
  );
}
