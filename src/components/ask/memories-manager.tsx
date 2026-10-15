"use client";

import { useCallback, useEffect, useState } from "react";
import { BookMarked, Lock, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, TextArea } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { db } from "@/lib/db/client";
import { MAX_MEMORIES_PER_PATIENT, MAX_MEMORY_CHARS, MEMORY_KINDS, type MemoryKind } from "@/services/soie/types";

const KIND_HI: Record<MemoryKind, string> = { allergy: "एलर्जी", preference: "पसंद", routine: "दिनचर्या", goal: "लक्ष्य", note: "नोट" };

interface Row {
  id: string;
  kind: MemoryKind;
  content: string;
  created_at: string;
}

/** Notes the family asked SOIE to remember about this patient. Owners and editors can add or remove; viewers can read. */
export function MemoriesManager({ isOpen, onClose, patientId, canWrite }: { isOpen: boolean; onClose: () => void; patientId: string | null; canWrite: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kind, setKind] = useState<MemoryKind>("note");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  const fetchRows = useCallback(async (): Promise<Row[] | null> => {
    if (!patientId) return [];
    const { data, error } = await db.from("soie_memories").select("id,kind,content,created_at").eq("patient_id", patientId).order("created_at", { ascending: false });
    return error ? null : ((data ?? []) as Row[]);
  }, [patientId]);

  const apply = useCallback((result: Row[] | null) => {
    setFailed(result === null);
    setRows(result ?? []);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    void fetchRows().then((result) => {
      if (live) apply(result);
    });
    return () => {
      live = false;
    };
  }, [isOpen, fetchRows, apply]);

  async function add() {
    const text = content.trim();
    if (!text || !patientId || busy) return;
    if ((rows?.length ?? 0) >= MAX_MEMORIES_PER_PATIENT) {
      toast({ title: `अधिकतम ${MAX_MEMORIES_PER_PATIENT} बातें सेव हो सकती हैं`, tone: "error" });
      return;
    }
    setBusy(true);
    const { error } = await db.from("soie_memories").insert({ patient_id: patientId, kind, content: text.slice(0, MAX_MEMORY_CHARS) });
    setBusy(false);
    if (error) {
      toast({ title: "सेव नहीं हो सका", tone: "error" });
      return;
    }
    setContent("");
    apply(await fetchRows());
    toast({ title: "सेव हो गया", tone: "success" });
  }

  async function remove(id: string) {
    const ok = await confirm({ title: "यह बात हटाएँ?", message: "SOIE आगे इसे इस्तेमाल नहीं करेगा।", confirmLabel: "हटाएँ", tone: "danger" });
    if (!ok) return;
    const { error } = await db.from("soie_memories").delete().eq("id", id);
    if (error) {
      toast({ title: "हटाया नहीं जा सका", tone: "error" });
      return;
    }
    setRows((r) => (r ?? []).filter((x) => x.id !== id));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="सेव की गई बातें" hindiTitle="Saved notes" description="सेव की गई बातें तब काम आती हैं जब आप उनके बारे में पूछें (जैसे “दूध से एलर्जी है क्या?”): नियम-आधारित जवाब भी इन्हें पढ़ते हैं। AI चालू हो तो ये बातें (मरीज़ या परिवार का नाम हटाकर) AI सेवा को भी भेजी जा सकती हैं।" size="md">
      <div className="space-y-4">
        {canWrite ? (
          <div className="space-y-3 rounded-card border border-gold-line bg-gold-soft p-3.5">
            <div>
              <p id="memory-kind-label" className="mb-1 text-sm font-medium text-ink">
                किस तरह की बात?
              </p>
              <Segmented
                ariaLabel="किस तरह की बात?"
                size="sm"
                value={kind}
                onChange={setKind}
                options={MEMORY_KINDS.map((k) => ({ value: k, label: KIND_HI[k] }))}
              />
            </div>
            <Field label="बात लिखें" hint={`${content.length}/${MAX_MEMORY_CHARS} · जैसे: दूध से एलर्जी है / रात के खाने के बाद टहलते हैं · नाम या फ़ोन नंबर न लिखें`}>
              <TextArea value={content} maxLength={MAX_MEMORY_CHARS} onChange={(e) => setContent(e.target.value)} />
            </Field>
            <Button variant="primary" onClick={add} loading={busy} disabled={content.trim().length === 0}>
              <Plus aria-hidden className="h-4 w-4" />
              सेव करें
            </Button>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-card border border-info-line bg-info-soft p-3 text-sm text-ink-muted">
            <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <span lang="hi">आपके पास केवल देखने की अनुमति है, इसलिए बातें जोड़ या हटा नहीं सकते।</span>
          </p>
        )}

        {rows === null ? (
          <div aria-busy="true" role="status" aria-label="लोड हो रहा है" className="space-y-2">
            <div className="skeleton h-16 rounded-card" />
            <div className="skeleton h-16 rounded-card" />
          </div>
        ) : failed ? (
          <EmptyState
            icon={BookMarked}
            title="Saved notes could not load"
            hindiTitle="सेव की गई बातें लोड नहीं हो सकीं"
            description="इंटरनेट जाँचकर फिर कोशिश करें।"
            action={
              <Button variant="secondary" onClick={() => void fetchRows().then(apply)}>
                फिर कोशिश करें
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={BookMarked} title="Nothing saved yet" hindiTitle="अभी कोई बात सेव नहीं है" description="चैट में लिखें “याद रखो कि …” या ऊपर से जोड़ें।" />
        ) : (
          <div>
            <p className="mb-2 text-xs font-semibold text-ink-muted">
              <span lang="hi">सेव की गई बातें</span> · {rows.length}/{MAX_MEMORIES_PER_PATIENT}
            </p>
            <ul className="space-y-2">
              {rows.map((m) => (
                <li key={m.id} className="flex items-start gap-2 rounded-card border border-line bg-surface p-3 shadow-e1">
                  <div className="min-w-0 flex-1">
                    <Badge variant="gold">
                      <span lang="hi">{KIND_HI[m.kind]}</span>
                    </Badge>
                    <p lang="hi" className="mt-1.5 whitespace-pre-line break-words text-sm text-ink">
                      {m.content}
                    </p>
                  </div>
                  {canWrite ? (
                    <IconButton variant="ghost" aria-label={`हटाएँ: ${m.content.slice(0, 30)}`} onClick={() => remove(m.id)}>
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
