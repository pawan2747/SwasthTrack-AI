"use client";

import { Sparkles } from "lucide-react";

type FollowUpChipsProps = {
  suggestions: string[];
  onSelectSuggestion: (text: string) => void;
  disabled?: boolean;
};

export function AskFollowUpChips({
  suggestions,
  onSelectSuggestion,
  disabled,
}: FollowUpChipsProps) {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
        <Sparkles className="h-3 w-3 text-purple-600 shrink-0" />
        <span>संबंधित प्रश्न (Suggested Follow-ups):</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {suggestions.slice(0, 3).map((text, idx) => (
          <button
            key={idx}
            type="button"
            disabled={disabled}
            onClick={() => onSelectSuggestion(text)}
            className="px-2.5 py-1 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-xs font-bold text-purple-900 shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            💬 {text}
          </button>
        ))}
      </div>
    </div>
  );
}
