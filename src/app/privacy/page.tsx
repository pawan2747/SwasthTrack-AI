import { Lock, Mail, Shield, Sparkles, Trash2, Users } from "lucide-react";
import { ContactCard, LegalBody, LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { AI_NEVER_HEADING, AI_NEVER_SENDS, AI_OFF_NOTE, AI_PROVIDERS, AI_SENDS, AI_TERMS_NOTE, BROWSER_SPEECH_NOTE } from "@/lib/ai-disclosure";
import { AI_TRUST_NOTE } from "@/lib/ai-panel-view";

const LAST_UPDATED = "15 October 2026";

/** "Google Gemini", "Groq", "OpenRouter": the shared names without their Hindi qualifiers. */
const PROVIDER_NAMES = AI_PROVIDERS.map((p) => p.name.replace(/\s*\(.*\)\s*$/, ""));

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      eyebrow="Legal & privacy"
      title="Privacy Policy"
      hindiTitle="गोपनीयता नीति"
      description={`Your health records are personal. This page explains what SwasthTrack stores, who can see it, and what leaves the app. Last updated: ${LAST_UPDATED}.`}
    >
      <LegalBody>
        <LegalSection title="1. Overview" icon={<Shield aria-hidden className="h-4 w-4 text-brand" />}>
          <p>
            SwasthTrack (&ldquo;we&rdquo;, &ldquo;the app&rdquo;) is a family health tracker. Health records you enter belong to you and
            to the family members you choose to share them with.
          </p>
          <p className="rounded-card border border-positive-line bg-positive-soft p-3 font-semibold text-ink">
            We do not sell health data, and we do not show advertisements or share records with advertisers or data brokers.
          </p>
          <p>
            Some features can use AI services run by outside companies. They are optional: nothing is sent to them until an owner or
            editor of the patient says yes in <strong className="text-ink">Settings &gt; AI सहायता</strong>, and the app works the same
            way without them. Section 5 says exactly what is sent, to whom, and how to switch it off.
          </p>
        </LegalSection>

        <LegalSection title="2. Information we store">
          <LegalList>
            <li>
              <strong className="text-ink">Account</strong>: your email address, a display name, and your sign-in credentials. Your password is
              stored only as a salted one-way hash (never in readable form), and sign-in codes are sent to your e-mail address.
            </li>
            <li>
              <strong className="text-ink">Patient profile</strong>: name, age, gender, height, weight, target weight and daily calorie
              target, as far as you choose to fill them in.
            </li>
            <li>
              <strong className="text-ink">Health logs</strong>: blood pressure and pulse, weight, steps, sleep, medicines and whether each
              dose was taken, and the meals you log.
            </li>
            <li>
              <strong className="text-ink">Family access</strong>: which accounts are linked to a patient and their role (owner, editor or
              viewer), and invite codes while they are valid.
            </li>
            <li>
              <strong className="text-ink">Ask conversations</strong>: questions you type to the Ask assistant and its answers, saved to
              your account so you can continue them later.
            </li>
            <li>
              <strong className="text-ink">Saved AI notes</strong>: when AI summaries are on, the short notes an AI service wrote (the
              daily summary, trend and medicine notes, and the items found in a meal sentence) are kept for a limited time, from a day to
              about a month, so they are not written again on every visit. They are stored without the patient&apos;s name and are
              deleted at once when AI text is switched off for that patient.
            </li>
            <li>
              <strong className="text-ink">AI choices and counters</strong>: for each patient, whether the family allowed AI for text and
              for photos and voice (yes, no or not asked yet) and which account changed it last and when. For each AI request only a
              counter row: the feature, the time, which provider and model answered, how long it took and how many tokens. Never the
              question, the photo, the recording or any reading.
            </li>
            <li>
              <strong className="text-ink">Learned meal photos</strong>: when you log a meal from a photo, a small thumbnail (not the
              photo), a numeric fingerprint of it and the foods you confirmed are kept so the app can recognise the same dish next time.
              You can remove each one in Settings &gt; Data.
            </li>
          </LegalList>
        </LegalSection>

        <LegalSection title="3. Who can see a patient's records">
          <p>
            Records are visible only to signed-in members of that patient&apos;s family circle. There is no public access: a person who is
            not signed in cannot read any patient data.
          </p>
          <LegalList>
            <li>
              <strong className="text-ink">Owner</strong> can view and change everything, invite family and manage roles.
            </li>
            <li>
              <strong className="text-ink">Editor</strong> can view and add or change records.
            </li>
            <li>
              <strong className="text-ink">Viewer</strong> can only view.
            </li>
          </LegalList>
          <p>
            The owner can change a member&apos;s role or remove their access at any time in{" "}
            <strong className="text-ink">Settings</strong>. Access is checked by the server on every request, not only by what the
            screen shows.
          </p>
        </LegalSection>

        <LegalSection title="4. How information is used">
          <LegalList>
            <li>Showing daily summaries, trends and the tracking score.</li>
            <li>Letting authorised family members see the same records and what needs attention.</li>
            <li>Building reports and CSV files when you ask for them.</li>
            <li>Suggesting quick food shortcuts from how often you have logged a food.</li>
            <li>Answering your questions in Ask, from your own records.</li>
            <li>
              Only when AI is on: writing plain-language summaries and notes from logged numbers, and turning a sentence or speech into
              the items to log.
            </li>
            <li>
              Only when you scan: reading the numbers on a blood-pressure monitor or scale from a photo, and suggesting dishes from a meal
              photo. You check the result before anything is saved.
            </li>
          </LegalList>
        </LegalSection>

        <LegalSection title="5. AI features (optional, family-controlled)" icon={<Sparkles aria-hidden className="h-4 w-4 text-brand" />}>
          <p>
            Some features use AI language, vision and speech services run by outside companies: {PROVIDER_NAMES.join(", ")}, only
            those the app&apos;s operator has set up. They write plain-language summaries and notes, answer questions in Ask, read a
            number from a photo of a blood-pressure monitor or scale, suggest dishes from a meal photo and turn speech into text.
          </p>
          <p>
            <strong className="text-ink">What may be sent</strong>, only after the family has said yes:
          </p>
          <LegalList>
            {AI_SENDS.map((x) => (
              <li key={x.en}>{x.en}</li>
            ))}
            <li>
              A photo of a prescription or medicine is sent only to a service that says it does not train on submitted content
              (unless the app&apos;s operator has chosen otherwise); if no such service is set up, the photo is not sent and you can
              paste the prescription text instead. Cover names and phone numbers before you send it.
            </li>
          </LegalList>
          <p>
            <strong className="text-ink">{AI_NEVER_HEADING.en}:</strong>
          </p>
          <LegalList>
            {AI_NEVER_SENDS.map((x) => (
              <li key={x.en}>{x.en}</li>
            ))}
            <li>Location and camera data (EXIF) is removed from a photo before it is passed on.</li>
          </LegalList>
          <p>
            <strong className="text-ink">Who decides.</strong> An owner or editor of the patient switches AI on or off in{" "}
            <strong className="text-ink">Settings &gt; AI सहायता</strong>, with two separate switches: summaries and answers, and photos
            and voice. Until a switch is set to yes nothing is sent for it, and the first time you scan a photo or speak the app asks. A
            view-only member cannot change it.
          </p>
          <p>
            <strong className="text-ink">When AI is off.</strong> {AI_OFF_NOTE.en} Saved AI notes are deleted at once, photos are read
            on your phone only, and the app sends no photo or recording to an AI service. Voice typing through your browser&apos;s own
            speech service is separate: see section 6.
          </p>
          <p>
            <strong className="text-ink">Outside companies.</strong> These providers run their own servers, possibly outside India, under
            their own terms. {AI_TERMS_NOTE.en} We cannot see or delete what a provider keeps.
          </p>
          <p>
            <strong className="text-ink">Accuracy.</strong> {AI_TRUST_NOTE.en}
          </p>
          <p className="text-xs text-ink-subtle">
            The photo or recording is passed on and not stored by SwasthTrack. This section is true whether or not any AI service is set
            up on the app you are using.
          </p>
          <p lang="hi" className="rounded-card border border-line bg-surface-sunken p-3 text-ink-muted">
            AI सुविधाएँ वैकल्पिक हैं। चालू होने पर ऐप अपने रिकॉर्ड से नाम, ई-मेल या फ़ोन नंबर नहीं भेजता; ज़रूरी आँकड़े और आपका सवाल,
            और सिर्फ़ जब आप चुनें तब फोटो या आवाज़, बाहरी कंपनियों ({PROVIDER_NAMES.join(", ")}) को भेजे जाते हैं। आपके लिखे सवाल में से
            नाम और फ़ोन नंबर हटाने की कोशिश होती है, पर हर वर्तनी पहचानी नहीं जा सकती, इसलिए सवाल में नाम या फ़ोन नंबर न लिखें।
            मुफ़्त प्लान पर ये कंपनियाँ जानकारी सहेज सकती हैं या अपनी सेवा सुधारने में इस्तेमाल कर सकती हैं। मालिक या एडिटर
            Settings &gt; AI सहायता में इसे कभी भी बंद कर सकते हैं; बंद करने पर सहेजे गए AI नोट मिटा दिए जाते हैं। AI की बात डॉक्टर की
            सलाह नहीं है।
          </p>
        </LegalSection>

        <LegalSection title="6. Storage and security" icon={<Lock aria-hidden className="h-4 w-4 text-brand" />}>
          <p>Records are kept in a MySQL database run by the app operator. The app uses:</p>
          <LegalList>
            <li>
              <strong className="text-ink">Access checks on the server</strong>: the browser never talks to the database directly; every
              request is checked against the signed-in person&apos;s access to that patient, so a query only returns rows they are allowed to
              see.
            </li>
            <li>
              <strong className="text-ink">Encrypted connections</strong>: HTTPS/TLS between your device and our servers.
            </li>
            <li>
              <strong className="text-ink">Voice typing (the microphone buttons)</strong>: {BROWSER_SPEECH_NOTE.en} The app does not
              receive that audio. Only on a browser that has no speech service of its own, and only when the photos-and-voice switch is
              on (or not yet answered and you say yes), a short recording may instead be sent to an AI service to be turned into text, as
              described in section 5.
            </li>
            <li>
              <strong className="text-ink">Preferences on your device</strong>: small settings such as the last patient you opened, saved
              food shortcuts and recent searches are kept in your browser. Health readings are not cached in browser storage.
            </li>
          </LegalList>
          <p className="text-xs text-ink-subtle">
            No online service can promise absolute security, but we take reasonable steps to protect your records.
          </p>
        </LegalSection>

        <LegalSection title="7. Insights and estimates">
          <p>
            Trends, scores and calorie figures are calculated from what you log. They are statistical estimates, not clinical diagnoses.
            Estimates are labelled as such in the app.
          </p>
        </LegalSection>

        <LegalSection title="8. Service providers">
          <p>
            We use a database host to store the records, a web host to serve the app, an e-mail delivery service for sign-in codes, and, only if AI is switched on for a patient, the AI providers named in section 5. If
            e-mail alerts or reports are switched on by the app operator, the summaries are delivered through an e-mail delivery service.
            These providers process data only to run the app.
          </p>
        </LegalSection>

        <LegalSection title="9. Retention and deletion" icon={<Trash2 aria-hidden className="h-4 w-4 text-bp" />}>
          <p>
            Records are kept while the account is active so long-term trends stay available. You can ask for your account and its
            records to be deleted, and an owner can remove caregivers or individual records inside the app. To request deletion, write to
            the contact below.
          </p>
          <p>
            <strong className="text-ink">Withdrawing from AI.</strong> Switch the AI switches off in Settings &gt; AI सहायता at any time.
            Saved AI notes are then deleted at once and nothing further is sent. What an outside AI provider already received is under
            that provider&apos;s own terms.
          </p>
        </LegalSection>

        <LegalSection title="10. Family caregivers" icon={<Users aria-hidden className="h-4 w-4 text-brand" />}>
          <p>
            By joining a patient with an invite code you confirm you have the patient&apos;s (or their guardian&apos;s) permission to view
            their records for supportive care.
          </p>
        </LegalSection>

        <LegalSection title="11. Questions" icon={<Mail aria-hidden className="h-4 w-4 text-brand" />} divider>
          <p>For questions about this policy or your data, contact:</p>
          <ContactCard>
            <p>
              <strong>Contact</strong>: Pawan Kumar
            </p>
            <p>
              <strong>Email</strong>:{" "}
              <a href="mailto:me.guptapawan@gmail.com" className="font-semibold text-brand-ink underline underline-offset-2">
                me.guptapawan@gmail.com
              </a>
            </p>
            <p>
              <strong>App</strong>: SwasthTrack family health companion
            </p>
          </ContactCard>
        </LegalSection>
      </LegalBody>
    </LegalPage>
  );
}
