"use client";

import { useState } from "react";
import { Pill, Plus, UserRound } from "lucide-react";
import { AddMedicineDialog } from "@/components/forms/add-medicine-dialog";
import { MedicationSafetyNote, MedicineAdherenceSummary } from "@/components/medicines/medicine-adherence-summary";
import { MedicineHistory } from "@/components/medicines/medicine-history";
import { MedicinePatternCard } from "@/components/medicines/medicine-pattern-card";
import { MedicineSchedule } from "@/components/medicines/medicine-schedule";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/context/auth-context";
import { useMedicineMarking } from "@/hooks/use-medicine-marking";
import { todayIST } from "@/lib/health-rules";

function Header() {
  return (
    <PageHeader
      eyebrow="Medicine Tracking (दवाइयाँ)"
      title="Medicine Schedule & Adherence"
      hindiTitle="दवाइयाँ और नियमितता"
      description="रोज़ की खुराक दर्ज करें और देखें कि दवाइयाँ कितनी नियमित ली जा रही हैं।"
    />
  );
}

export default function MedicinesPage() {
  const { activePatientId, canWrite } = useAuth();
  const [isAddOpen, setIsAddOpen] = useState(false);
  // The day the schedule shows; the history chart and its table change it.
  const [selectedDate, setSelectedDate] = useState(todayIST);
  const toast = useToast();

  // Today's doses drive the hero and the "no medicines yet" state. The schedule
  // below has its own hook for whichever day is selected; both stay in sync
  // because every write re-notifies the other mounted hooks.
  const today = useMedicineMarking(activePatientId, todayIST());

  if (!activePatientId) {
    return (
      <PageBody>
        <Header />
        <EmptyState
          icon={UserRound}
          title="No patient selected"
          hindiTitle="अभी कोई मरीज़ चुना नहीं गया है।"
          description="मरीज़ जोड़ने या चुनने के बाद यहाँ दवाइयाँ दिखेंगी।"
        />
      </PageBody>
    );
  }

  if (today.loading) {
    return (
      <PageBody>
        <Header />
        <div className="space-y-4" aria-busy="true" aria-label="दवाइयाँ लोड हो रही हैं">
          <div className="skeleton h-48 w-full rounded-card" />
          <div className="skeleton h-64 w-full rounded-card" />
        </div>
      </PageBody>
    );
  }

  if (today.error) {
    return (
      <PageBody>
        <Header />
        <ErrorState
          title="दवाइयाँ लोड नहीं हो पाईं"
          englishTitle="The medicine list could not be loaded"
          description="इंटरनेट कनेक्शन जाँचें और दोबारा कोशिश करें।"
          onRetry={today.reload}
        />
      </PageBody>
    );
  }

  // `medicines` includes stopped ones; a patient with only stopped medicines still
  // gets the schedule (which explains it) rather than the first-run prompt.
  if (today.medicines.length === 0) {
    return (
      <PageBody>
        <Header />
        <EmptyState
          icon={Pill}
          title="No medicines added yet"
          hindiTitle="अभी कोई दवाई दर्ज नहीं है।"
          description={
            canWrite
              ? "डॉक्टर की पर्ची की दवाइयाँ जोड़ें। फिर यहाँ रोज़ की खुराक दर्ज होगी और नियमितता दिखेगी।"
              : "जब कोई दवाई जोड़ी जाएगी, वह यहाँ दिखेगी।"
          }
          action={
            canWrite ? (
              <Button variant="primary" onClick={() => setIsAddOpen(true)}>
                <Plus aria-hidden className="h-4 w-4" />
                <span lang="hi">पहली दवाई जोड़ें</span>
              </Button>
            ) : undefined
          }
        />
        <AddMedicineDialog
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          patientId={activePatientId}
          onSuccess={() => toast.success("दवाई जुड़ गई")}
        />
      </PageBody>
    );
  }

  function openDay(date: string) {
    setSelectedDate(date);
    const el = document.getElementById("med-schedule");
    if (el) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }

  return (
    <PageBody>
      <Header />
      <MedicineAdherenceSummary summary={today.summary} doses={today.doses} />
      <MedicationSafetyNote />
      <MedicineSchedule
        patientId={activePatientId}
        date={selectedDate}
        onDateChange={setSelectedDate}
        onAddMedicine={() => setIsAddOpen(true)}
      />
      <MedicinePatternCard patientId={activePatientId} onOpenDay={openDay} />
      <MedicineHistory patientId={activePatientId} selectedDate={selectedDate} onSelectDate={openDay} />
      <AddMedicineDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        patientId={activePatientId}
        onSuccess={() => toast.success("दवाई जुड़ गई")}
      />
    </PageBody>
  );
}
