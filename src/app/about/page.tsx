import Link from "next/link";
import {
  Camera,
  Footprints,
  Heart,
  HeartPulse,
  MessageCircle,
  Moon,
  Pill,
  Scale,
  ShieldAlert,
  Sparkles,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { LegalPage } from "@/components/legal/legal-page";
import { Card, metricChipClasses, type MetricTone } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Feature = { title: string; hindi: string; desc: string; icon: LucideIcon; tone: MetricTone };

const FEATURES: Feature[] = [
  {
    title: "Blood pressure",
    hindi: "रक्तचाप",
    desc: "Log morning and evening readings, see each one against the patient's own target and alert lines, and follow the trend.",
    icon: HeartPulse,
    tone: "bp",
  },
  {
    title: "Medicines",
    hindi: "दवाइयाँ",
    desc: "Mark each dose taken, late or missed with one tap and see adherence over days and weeks.",
    icon: Pill,
    tone: "meds",
  },
  {
    title: "Indian food & calories",
    hindi: "भारतीय भोजन और कैलोरी",
    desc: "Search a large database of everyday Indian foods, choose a portion and oil, and see an honest calorie estimate.",
    icon: Utensils,
    tone: "food",
  },
  {
    title: "Weight & goals",
    hindi: "वजन और लक्ष्य",
    desc: "Track weight against the target set for the patient, with BMI and a weekly trend.",
    icon: Scale,
    tone: "weight",
  },
  {
    title: "Steps",
    hindi: "कदम",
    desc: "Record daily steps against a goal you set, with gentle, non-judgmental summaries.",
    icon: Footprints,
    tone: "activity",
  },
  {
    title: "Sleep",
    hindi: "नींद",
    desc: "Note how long the night was and how it compares with the patient's own sleep target.",
    icon: Moon,
    tone: "sleep",
  },
  {
    title: "Family circle",
    hindi: "परिवार के साथ",
    desc: "Invite family as editors or viewers with a code. Everyone sees the same records and what needs attention.",
    icon: Users,
    tone: "brand",
  },
  {
    title: "Ask",
    hindi: "सवाल पूछें",
    desc: "Ask questions about the records in plain Hindi or English. Answers come from the data and every number is checked against the records; AI is optional and can be switched off.",
    icon: MessageCircle,
    tone: "neutral",
  },
  {
    title: "Camera",
    hindi: "कैमरे से दर्ज करें",
    desc: "Read the numbers on a blood-pressure monitor or scale from a photo, or get dish suggestions from a meal photo. You always check before anything is saved, and the AI part is optional.",
    icon: Camera,
    tone: "bp",
  },
  {
    title: "Reports for the doctor",
    hindi: "डॉक्टर के लिए रिपोर्ट",
    desc: "Weekly, monthly and yearly reports, a printable doctor-visit summary and a CSV download.",
    icon: Sparkles,
    tone: "neutral",
  },
];

export default function AboutPage() {
  return (
    <LegalPage
      eyebrow="Our story"
      title="About SwasthTrack"
      hindiTitle="हमारा उद्देश्य"
      description="A health and family-care companion that helps families look after everyday wellness together."
    >
      <Card tone="premium" className="space-y-4 p-6 sm:p-8">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-gold-line bg-gold-soft px-3 py-1 text-xs font-semibold text-gold-ink">
          <Heart aria-hidden className="h-3.5 w-3.5 fill-gold-ink text-gold-ink" />
          <span>The heart of SwasthTrack</span>
        </div>

        <h2 className="text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl">
          &ldquo;Once, our parents took care of every little thing for us. Now, it&apos;s our turn to take care of them.&rdquo;
        </h2>

        <p className="text-sm font-medium leading-relaxed text-ink-muted sm:text-base">
          SwasthTrack began with a simple, personal reality: our parents spent their lives putting our well-being first. As they grow
          older we want to help them keep healthy daily routines, such as blood pressure, medicines on time, balanced meals, gentle walks
          and good rest, even when we cannot always be in the same room.
        </p>
      </Card>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink sm:text-lg">
          Why SwasthTrack?
          <span lang="hi" className="ml-2 text-sm font-normal text-ink-muted">
            स्वस्थट्रैक क्यों?
          </span>
        </h2>
        <Card tone="raised" className="space-y-3 p-5 text-sm leading-relaxed text-ink-muted sm:p-6">
          <p>
            Most fitness apps are built for athletes and calorie counters, which makes them busy and hard for elderly parents. SwasthTrack
            is built with a different mindset:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 marker:text-gold-ink">
            <li>
              <strong className="text-ink">Readable for elders</strong>: large clear text, Hindi labels and big touch targets.
            </li>
            <li>
              <strong className="text-ink">Indian food, not generic food</strong>: roti, dal, khichdi, sabzi, chai, with realistic
              portions.
            </li>
            <li>
              <strong className="text-ink">Quick medicine marking</strong>: one tap for each dose.
            </li>
            <li>
              <strong className="text-ink">Honest numbers</strong>: where there is no data the app says so, and estimates are labelled as
              estimates.
            </li>
            <li>
              <strong className="text-ink">Family transparency</strong>: caregivers can see what has and has not been recorded.
            </li>
          </ul>
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-ink sm:text-lg">What it does</h2>
        <ul className="grid gap-3.5 sm:grid-cols-2">
          {FEATURES.map((feat) => {
            const Icon = feat.icon;
            return (
              <li key={feat.title}>
                <Card className="h-full space-y-2">
                <div className="flex items-center gap-3">
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-control", metricChipClasses[feat.tone])}>
                    <Icon aria-hidden className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-ink">{feat.title}</h3>
                    <p lang="hi" className="text-xs text-ink-muted">
                      {feat.hindi}
                    </p>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-ink-muted">{feat.desc}</p>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex items-start gap-3 rounded-card border border-attention-line bg-attention-soft p-5 text-sm text-ink-muted">
        <ShieldAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-attention" />
        <div className="space-y-1">
          <p className="font-semibold text-ink">Important notice</p>
          <p className="leading-relaxed">
            SwasthTrack is a supportive tracking tool. It is not a hospital, emergency service or diagnosis platform. Health decisions and
            changes to prescriptions should always be made with a qualified doctor. In an emergency call 112 / 108.
          </p>
          <Link href="/medical-disclaimer" className="inline-block pt-1 font-semibold text-brand-ink underline underline-offset-2">
            Read the full Medical Disclaimer →
          </Link>
        </div>
      </div>

      <Card tone="sunken" className="space-y-2 p-6 text-center">
        <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-ink">
          <span>Made with</span>
          <Heart aria-hidden className="inline h-4 w-4 fill-bp text-bp" />
          <span>by Pawan Kumar</span>
        </div>
        <p className="text-xs text-ink-muted">Built with care for families who care for each other.</p>
      </Card>
    </LegalPage>
  );
}
