import { FileText, Mail, ShieldAlert } from "lucide-react";
import { ContactCard, LegalBody, LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page";

const LAST_UPDATED = "15 October 2026";

export default function TermsOfUsePage() {
  return (
    <LegalPage
      eyebrow="Terms & conditions"
      title="Terms of Use"
      hindiTitle="उपयोग की शर्तें"
      description={`Please read these terms before using SwasthTrack. Last updated: ${LAST_UPDATED}.`}
    >
      <LegalBody>
        <LegalSection title="1. Acceptance" icon={<FileText aria-hidden className="h-4 w-4 text-brand" />}>
          <p>
            By using SwasthTrack you agree to these Terms of Use and to the Privacy Policy. If you do not agree, please do not use the
            app.
          </p>
        </LegalSection>

        <LegalSection title="2. What the service is">
          <p>
            SwasthTrack is a family health tracker. It helps people and their caregivers record and review blood pressure, medicines,
            meals, steps, weight and sleep, and see summaries of those records.
          </p>
          <p className="flex items-start gap-2 rounded-card border border-attention-line bg-attention-soft p-3.5 text-ink-muted">
            <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-attention" />
            <span>
              <strong className="text-ink">Important:</strong> SwasthTrack is not a hospital, laboratory, pharmacy or licensed medical
              provider. It does not diagnose, give emergency care or dispense medicine.
            </span>
          </p>
        </LegalSection>

        <LegalSection title="3. Your account and your entries">
          <p>
            You are responsible for the accuracy of the readings, medicines and doses you enter. Please check entries against your
            prescription and your measuring devices.
          </p>
          <LegalList>
            <li>Keep your sign-in details private and do not share your account.</li>
            <li>Do not use the app for anything unlawful, fraudulent or abusive.</li>
          </LegalList>
        </LegalSection>

        <LegalSection title="4. Family access and roles">
          <p>
            A patient&apos;s owner can invite family members as editors (who can add and change records) or viewers (who can only look).
            When you join a patient with an invite code you confirm that the patient, or their legal guardian, has agreed that you may
            see their records for supportive care. The owner can change or remove access at any time.
          </p>
          <p>
            Before an owner or editor switches AI on, scans a photo or records a voice clip, they confirm that the patient (or their
            guardian) agrees that this content may be sent to the outside AI services described in the Privacy Policy. Do not scan photos
            that show a person&apos;s face, or a name, address or phone number.
          </p>
        </LegalSection>

        <LegalSection title="5. No medical advice">
          <p>
            Scores, trends, estimates, alerts and Ask answers (including any AI-written answers) are for information only. They can be
            incomplete or wrong, and they never replace a doctor. Speak to your physician before changing any medicine or routine. In an
            emergency call 112 / 108.
          </p>
          <p>
            AI features depend on outside services that can be slow, wrong or unavailable, and that may change or stop without notice.
            When one is unavailable the app uses its own rules and keeps working. A number read from a photo is only a suggestion until
            you have checked it against the device and saved it.
          </p>
        </LegalSection>

        <LegalSection title="6. Intellectual property">
          <p>
            The software, design, branding and documentation of SwasthTrack belong to Pawan Kumar and are protected by applicable law.
            The health records you enter remain yours.
          </p>
        </LegalSection>

        <LegalSection title="7. Limitation of liability">
          <p>
            To the extent the law allows, SwasthTrack and its creator are not liable for indirect or consequential loss arising from use
            of, or inability to use, the app, including wrong data entry or relying on the app&apos;s summaries for a medical decision.
          </p>
        </LegalSection>

        <LegalSection title="8. Changes and ending use">
          <p>
            We may improve or change features. You may stop using the app at any time and ask for your account to be deleted, as
            described in the Privacy Policy.
          </p>
        </LegalSection>

        <LegalSection title="9. Contact" icon={<Mail aria-hidden className="h-4 w-4 text-brand" />} divider>
          <p>For questions about these terms or for support:</p>
          <ContactCard>
            <p>
              <strong>Creator</strong>: Pawan Kumar
            </p>
            <p>
              <strong>Email</strong>:{" "}
              <a href="mailto:me.guptapawan@gmail.com" className="font-semibold text-brand-ink underline underline-offset-2">
                me.guptapawan@gmail.com
              </a>
            </p>
          </ContactCard>
        </LegalSection>
      </LegalBody>
    </LegalPage>
  );
}
