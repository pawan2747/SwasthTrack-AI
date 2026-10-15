"use client";

import { ClipboardPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "इसे रिकॉर्ड में दर्ज करें": shown under a message that STATES a reading or a dose (see logChipDecision in
 * ask-ui.ts). It only opens the say-or-type sheet with the words filled in; nothing is saved until the person
 * ticks what was understood and presses save there.
 */
export function LogChip({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex justify-end">
      <Button size="sm" variant="quiet" onClick={onOpen} title="पहले दिखेगा कि क्या समझा गया; आपके 'सेव करें' दबाने पर ही कुछ दर्ज होता है">
        <ClipboardPlus aria-hidden className="h-4 w-4" />
        <span lang="hi">इसे रिकॉर्ड में दर्ज करें</span>
      </Button>
    </div>
  );
}
