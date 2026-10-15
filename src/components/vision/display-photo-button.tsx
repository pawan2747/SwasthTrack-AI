"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisplayPhotoDialog, type BPPhotoValues, type WeightPhotoValues } from "@/components/vision/display-photo-dialog";
import { useAuth } from "@/context/auth-context";

type Props =
  | { kind: "bp"; patientId: string; onResult: (values: BPPhotoValues) => void }
  | { kind: "weight"; patientId: string; onResult: (values: WeightPhotoValues) => void };

const COPY = {
  bp: { button: "BP मशीन की फोटो से अंक भरें", filled: "अंक फोटो से भरे गए हैं; सेव करने से पहले मशीन से मिला लें।" },
  weight: { button: "वजन मशीन की फोटो से भरें", filled: "वजन फोटो से भरा गया है; सेव करने से पहले मशीन से मिला लें।" },
} as const;

/**
 * The camera button of a BP / weight form and the photo dialog behind it: for forms that have no
 * photo wiring of their own (the caregiver quick log). Only people who may record see it. A photo only
 * fills the form; the form's own checks and confirm dialogs still run when it is saved.
 */
export function DisplayPhotoButton(props: Props) {
  const { canWrite } = useAuth();
  const [open, setOpen] = useState(false);
  const [filled, setFilled] = useState(false);
  const copy = COPY[props.kind];
  if (!canWrite) return null;

  return (
    <div className="space-y-1">
      <Button variant="secondary" block onClick={() => setOpen(true)}>
        <Camera aria-hidden className="h-4 w-4" />
        <span lang="hi">{copy.button}</span>
      </Button>
      {filled ? (
        <p lang="hi" role="status" className="text-xs text-ink-muted">
          {copy.filled}
        </p>
      ) : null}
      {props.kind === "bp" ? (
        <DisplayPhotoDialog
          kind="bp"
          patientId={props.patientId}
          isOpen={open}
          onClose={() => setOpen(false)}
          onResult={(v) => {
            props.onResult(v);
            setFilled(true);
          }}
        />
      ) : (
        <DisplayPhotoDialog
          kind="weight"
          patientId={props.patientId}
          isOpen={open}
          onClose={() => setOpen(false)}
          onResult={(v) => {
            props.onResult(v);
            setFilled(true);
          }}
        />
      )}
    </div>
  );
}
