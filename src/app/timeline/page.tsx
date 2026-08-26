"use client";

import { useEffect, useState } from "react";
import { PageTitle } from "@/components/ui/page-title";
import { TimelineView } from "@/components/timeline/timeline-view";
import { getPatientProfile, type PatientProfile } from "@/services/patient-service";

export default function TimelinePage() {
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getPatientProfile()
      .then((p) => {
        if (active) setPatient(p);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading || !patient) {
    return (
      <div className="space-y-6">
        <PageTitle
          eyebrow="My Health Journey · स्वास्थ्य यात्रा"
          title="Health Timeline"
          description="A chronological journey of all your daily health events, vitals, nutrition, and activities."
        />
        <div className="h-64 rounded-2xl border-2 border-slate-200 bg-white animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      <PageTitle
        eyebrow="Timeline · एकीकृत स्वास्थ्य यात्रा"
        title="मेरी स्वास्थ्य यात्रा"
        description="आपके स्वास्थ्य से जुड़े महत्वपूर्ण रिकॉर्ड एक जगह — भोजन, रक्तचाप, दवाइयाँ, कदम, नींद और वाइटल्स का एकीकृत क्रोनोलॉजिकल प्रवाह।"
      />
      <TimelineView patientId={patient.id} />
    </div>
  );
}
