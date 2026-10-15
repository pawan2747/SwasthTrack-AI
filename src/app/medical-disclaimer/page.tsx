import { CheckCircle2, PhoneCall, ShieldAlert } from "lucide-react";
import { LegalBody, LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page";

export default function MedicalDisclaimerPage() {
  return (
    <LegalPage
      eyebrow="Medical safety notice"
      title="Medical Disclaimer"
      hindiTitle="चिकित्सीय अस्वीकरण"
      description="What SwasthTrack is for, and what it is not."
    >
      <div className="space-y-3 rounded-card border-2 border-attention-line bg-attention-soft p-5 sm:p-7">
        <div className="flex items-center gap-2.5">
          <ShieldAlert aria-hidden className="h-6 w-6 shrink-0 text-attention" />
          <h2 className="text-base font-semibold text-ink sm:text-lg">For information and personal tracking only</h2>
        </div>
        <p className="text-sm font-medium leading-relaxed text-ink">
          SwasthTrack helps patients and families keep organised records of daily health routines.
        </p>
        <p className="text-sm font-semibold leading-relaxed text-ink">
          SwasthTrack is NOT a medical device, hospital, diagnostic laboratory, doctor or emergency service.
        </p>
        <p lang="hi" className="text-sm leading-relaxed text-ink-muted">
          यह ऐप डॉक्टर की सलाह, जाँच या इलाज का विकल्प नहीं है। किसी भी चिंता में डॉक्टर से मिलें।
        </p>
      </div>

      <LegalBody>
        <LegalSection title="1. Not a substitute for professional care">
          <p>
            Charts, alerts, scores and summaries in SwasthTrack are for education and convenience. They are not medical advice, diagnosis
            or treatment. Always ask your physician or another qualified health professional about a condition, symptom or treatment plan.
          </p>
        </LegalSection>

        <LegalSection title="2. Medicines">
          <p>Never ignore professional advice, or delay getting it, because of something you recorded or read in the app.</p>
          <LegalList>
            <li>
              Do <strong className="text-ink">not</strong> start, stop or change the dose or timing of a medicine because of an app
              number, score or reminder.
            </li>
            <li>Every change to a prescription must come from your treating doctor.</li>
          </LegalList>
        </LegalSection>

        <LegalSection title="3. Estimates, trends, photo readings and AI notes">
          <p>
            Trends, flags, calorie figures, summaries and Ask answers (including AI-written notes, when AI is switched on) are estimates
            built from what was logged. They can be incomplete or wrong and are not clinical assessments. Where a number is an estimate,
            the app says so.
          </p>
          <LegalList>
            <li>
              A number read from a photo of a monitor or scale, or a dish suggested from a meal photo, is a suggestion. Check it against
              the device&apos;s own display before you save it.
            </li>
            <li>
              The AI has not examined the patient and is not given the full history. It never starts, stops or changes a medicine, a dose,
              a schedule or a target: a person does that, on the doctor&apos;s advice.
            </li>
            <li>An AI note never means that a doctor is not needed.</li>
          </LegalList>
          <p lang="hi" className="rounded-card border border-line bg-surface-sunken p-3 text-ink-muted">
            AI कभी दवा, खुराक या इलाज तय नहीं करता। फोटो से पढ़ा अंक सेव करने से पहले मशीन की स्क्रीन से मिलाएँ। AI का लिखा नोट डॉक्टर की
            सलाह की जगह नहीं लेता।
          </p>
        </LegalSection>

        <section className="space-y-3 rounded-card border border-critical-line bg-critical-soft p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-critical">
            <PhoneCall aria-hidden className="h-4 w-4 shrink-0" />
            Medical emergencies
          </h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            If you or a family member may be having an emergency, for example severe chest pain, trouble breathing, sudden numbness or
            weakness in the face or arms, difficulty speaking, fainting, or a very high blood pressure with symptoms:
          </p>
          <p className="rounded-control border border-critical-line bg-surface p-3 text-center text-sm font-semibold text-ink">
            Call <a href="tel:112" className="text-critical underline underline-offset-2">112</a> or{" "}
            <a href="tel:108" className="text-critical underline underline-offset-2">108</a> (India) immediately, or go to the nearest
            hospital emergency room.
          </p>
          <p lang="hi" className="text-sm text-ink-muted">
            आपात स्थिति में तुरंत 112 या 108 पर कॉल करें, या नज़दीकी अस्पताल के इमरजेंसी में जाएँ। ऐप खोलकर इंतज़ार न करें।
          </p>
        </section>

        <LegalSection title="4. Using the app at a doctor visit" icon={<CheckCircle2 aria-hidden className="h-4 w-4 text-positive" />}>
          <p>
            You can print or save the Doctor visit summary from Reports and share your blood pressure history, medicine adherence and weight
            trend with your doctor. It shows only what was recorded, with how many days have records, and makes no diagnosis.
          </p>
        </LegalSection>
      </LegalBody>
    </LegalPage>
  );
}
