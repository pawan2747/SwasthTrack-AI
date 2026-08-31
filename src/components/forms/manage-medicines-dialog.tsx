"use client";

import { useEffect, useState } from "react";
import { Edit3, Plus, Trash2, Pill, Clock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  getMedicines,
  deleteMedicine,
  type MedicineItem,
} from "@/services/patient-service";
import { AddMedicineDialog } from "@/components/forms/add-medicine-dialog";

type ManageMedicinesDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  onSuccess?: () => void;
};

export function ManageMedicinesDialog({
  isOpen,
  onClose,
  patientId,
  onSuccess,
}: ManageMedicinesDialogProps) {
  const [medicines, setMedicines] = useState<MedicineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [medicineToEdit, setMedicineToEdit] = useState<MedicineItem | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const list = await getMedicines(patientId);
      setMedicines(list);
    } catch {
      console.error("Failed to load medicines");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    if (isOpen) {
      getMedicines(patientId)
        .then((list) => {
          if (active) {
            setMedicines(list);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) {
            console.error("Failed to load medicines");
            setLoading(false);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [isOpen, patientId]);

  async function handleDelete(id: string) {
    setErrorMsg("");
    setDeletingId(id);
    try {
      await deleteMedicine(id);
      await loadData();
      onSuccess?.();
    } catch {
      setErrorMsg("दवाई हटाने में विफल। कृपया पुनः प्रयास करें।");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="दवाइियाँ सम्पादित करें (Manage Medicines)"
        hindiTitle="Medicine Management"
        description="अपनी सभी दवाओं का नाम, खुराक, समय बदलें या नई दवा जोड़ें।"
        maxWidth="lg"
      >
        <div className="space-y-4 max-w-full">
          {errorMsg ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
              {errorMsg}
            </div>
          ) : null}
          {/* TOP ACTION BAR */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl border-2 border-emerald-200 bg-emerald-50/70">
            <div className="flex items-center gap-2.5">
              <Pill className="h-5 w-5 text-emerald-700 shrink-0" />
              <div>
                <p className="text-xs sm:text-sm font-black text-emerald-950">
                  कुल पंजीकृत दवाइियाँ: {medicines.length}
                </p>
                <p className="text-[11px] font-bold text-emerald-800">
                  सक्रिय: {medicines.filter((m) => m.active).length}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-97 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>+ नई दवा जोड़ें</span>
            </button>
          </div>

          {/* MEDICINES LIST FOR EDITING */}
          <div className="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
            {loading ? (
              <div className="p-8 text-center text-sm font-bold text-slate-500">
                दवाइयाँ लोड हो रही हैं...
              </div>
            ) : medicines.length === 0 ? (
              <div className="p-6 text-center text-sm font-bold text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                कोई दवाई दर्ज नहीं है। ऊपर क्लिक करके पहली दवा जोड़ें।
              </div>
            ) : (
              medicines.map((medicine) => (
                <div
                  key={medicine.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl border-2 border-slate-200 bg-white hover:border-slate-300 shadow-2xs transition-all"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-slate-950 text-sm sm:text-base">
                        {medicine.medicine_name}
                      </p>
                      <span className="text-[11px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                        {medicine.dose}
                      </span>
                      {!medicine.active && (
                        <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                          निष्क्रिय (Inactive)
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>⏰ {medicine.scheduled_time.slice(0, 5)}</span>
                      <span>·</span>
                      <span>{medicine.meal_relation ? medicine.meal_relation.replace("_", " ") : "भोजन के बाद"}</span>
                      <span>·</span>
                      <span className="text-slate-500">{medicine.frequency}</span>
                    </p>
                  </div>

                  {/* EDIT & DELETE BUTTONS */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => setMedicineToEdit(medicine)}
                      className="min-h-9 px-3 text-xs font-black text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer active:scale-97"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-slate-700" />
                      <span>बदलें (Edit)</span>
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === medicine.id}
                      onClick={() => handleDelete(medicine.id)}
                      className="min-h-9 px-3 text-xs font-black text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer active:scale-97 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                      <span>हटाएं</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* EDIT MODAL */}
      {medicineToEdit && (
        <AddMedicineDialog
          isOpen={!!medicineToEdit}
          onClose={() => setMedicineToEdit(null)}
          patientId={patientId}
          medicineToEdit={medicineToEdit}
          onSuccess={async () => {
            setMedicineToEdit(null);
            await loadData();
            onSuccess?.();
          }}
        />
      )}

      {/* ADD NEW MODAL */}
      {isAddOpen && (
        <AddMedicineDialog
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          patientId={patientId}
          onSuccess={async () => {
            setIsAddOpen(false);
            await loadData();
            onSuccess?.();
          }}
        />
      )}
    </>
  );
}
