"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  Send,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DepthCard } from "@/components/ui/depth-card";
import { cn } from "@/lib/utils";
import { getAuthorizedPatients } from "@/services/auth-service";
import {
  getPatientProfile,
  type PatientProfile,
} from "@/services/patient-service";
import {
  answerHealthQuestion,
  type ChatMessageItem,
} from "@/services/ask-data-service";

const QUICK_PROMPTS = [
  "आज पापा कैसे रहे?",
  "पिछले 7 दिन का average BP kya tha?",
  "Last week se kya change hua?",
  "Is week Papa ne kitne steps chale?",
  "Papa ki medicine adherence kitni rahi?",
  "Kal dinner mein kya khaya tha?",
  "Weight target se kitna door hai?",
  "Is week kya kya missing raha?",
  "Sleep average kaisa raha?",
  "15 August ko weight kya tha?",
];

let _msgCounter = 0;
function getNextMessageId(prefix: string): string {
  _msgCounter += 1;
  return `${prefix}-${_msgCounter}`;
}

export default function AskSwasthTrackPage() {
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [authorizedPatients, setAuthorizedPatients] = useState<PatientProfile[]>([]);
  const [activePatientId, setActivePatientId] = useState<string | undefined>(undefined);
  const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false);

  const [inputQuery, setInputQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [expandedCalculationId, setExpandedCalculationId] = useState<string | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, "helpful" | "not_helpful">>({});

  const chatBottomRef = useRef<HTMLDivElement>(null);

  // 1. Initial Load of Patient & Authorized Family Profiles
  useEffect(() => {
    let active = true;

    Promise.all([
      getPatientProfile(activePatientId),
      getAuthorizedPatients().catch(() => [] as PatientProfile[]),
    ])
      .then(([prof, authPts]) => {
        if (!active) return;
        setPatient(prof);
        setAuthorizedPatients(authPts);

        // Populate initial welcome message
        const isPapa =
          prof.id === "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac" ||
          prof.name.toLowerCase().includes("raj kishore");
        const name = isPapa ? "पापा (Raj Kishore Gupta)" : prof.name;

        setMessages([
          {
            id: "msg-welcome",
            role: "assistant",
            content: `नमस्ते! मैं स्वास्थट्रैक हेल्थ डेटा सहायक हूँ। आप ${name} के वास्तविक स्वास्थ्य आंकड़ों (BP, वजन, दवाइयाँ, कदम, नींद, भोजन और बदलाव) के बारे में कोई भी प्रश्न पूछ सकते हैं। नीचे दिए गए सुझाए गए प्रश्नों में से किसी एक पर टैप करें या अपना प्रश्न टाइप करें।`,
            timestamp: new Date().toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }),
          },
        ]);
      })
      .catch((err) => console.error("Error loading patient in /ask:", err));

    return () => {
      active = false;
    };
  }, [activePatientId]);

  // Scroll to bottom on new message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSendQuestion(textToSend?: string) {
    const query = (textToSend || inputQuery).trim();
    if (!query || !patient || loading) return;

    setInputQuery("");
    const userMsgId = getNextMessageId("msg-user");
    const userMsg: ChatMessageItem = {
      id: userMsgId,
      role: "user",
      content: query,
      timestamp: new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const card = await answerHealthQuestion(patient.id, query);
      const assistantMsg: ChatMessageItem = {
        id: getNextMessageId("msg-ans"),
        role: "assistant",
        content: card.summaryHi,
        card,
        timestamp: card.timestamp,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error("AskSwasthTrack query error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: getNextMessageId("msg-err"),
          role: "assistant",
          content:
            "डेटा विश्लेषण के दौरान कुछ समस्या आई। कृपया पुनः प्रयास करें या प्रश्न को सरल रूप में पूछें।",
          timestamp: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleFeedback(cardId: string, rating: "helpful" | "not_helpful") {
    setFeedbackMap((prev) => ({ ...prev, [cardId]: rating }));
  }

  function handleClearChat() {
    if (!patient) return;
    const isPapa =
      patient.id === "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac" ||
      patient.name.toLowerCase().includes("raj kishore");
    const name = isPapa ? "पापा" : patient.name;
    setMessages([
      {
        id: getNextMessageId("msg-welcome"),
        role: "assistant",
        content: `बातचीत रीसेट कर दी गई है। ${name} के स्वास्थ्य डेटा के बारे में कोई भी प्रश्न पूछें।`,
        timestamp: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
      },
    ]);
  }

  const isPapa =
    patient?.id === "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac" ||
    (patient?.name && patient.name.toLowerCase().includes("raj kishore"));

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)] max-w-3xl mx-auto px-3 sm:px-4 py-3 space-y-3.5">
      {/* 1. TOP HEADER & PATIENT SELECTOR CONTEXT (§42) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-slate-200">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-10 w-10 rounded-2xl bg-linear-to-br from-purple-600 to-indigo-700 text-white flex items-center justify-center shadow-xs shrink-0">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-black text-slate-950 truncate leading-tight">
              Ask SwasthTrack · स्वास्थ्य डेटा सहायक
            </h1>
            <p className="text-xs font-bold text-purple-800 leading-tight truncate">
              वास्तविक डेटा पर आधारित उत्तर (No hallucinations)
            </p>
          </div>
        </div>

        {/* Patient Switcher */}
        <div className="relative self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setIsPatientDropdownOpen(!isPatientDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-black text-slate-800 transition-colors cursor-pointer"
          >
            <UserCheck className="h-3.5 w-3.5 text-purple-600 shrink-0" />
            <span className="truncate max-w-[150px]">
              Viewing: {isPapa ? "पापा" : patient?.name || "Patient"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          </button>

          {isPatientDropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 bg-white rounded-2xl shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-1.5 text-[11px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100">
                मरीज़ का चयन करें
              </div>
              {authorizedPatients.length > 0 ? (
                authorizedPatients.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setActivePatientId(p.id);
                      setIsPatientDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-xs font-bold flex items-center justify-between hover:bg-purple-50 transition-colors cursor-pointer",
                      patient?.id === p.id
                        ? "text-purple-700 bg-purple-50/60 font-black"
                        : "text-slate-700"
                    )}
                  >
                    <span className="truncate">
                      {p.id === "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac" ||
                      p.name.toLowerCase().includes("raj kishore")
                        ? "पापा (Raj Kishore Gupta)"
                        : p.name}
                    </span>
                    {patient?.id === p.id && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                    )}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-slate-500 font-bold">
                  {patient?.name || "Active Patient"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. QUICK QUESTION CHIPS (§39 - Contained horizontal scroll only) */}
      <div className="relative">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 no-scrollbar touch-pan-x">
          {QUICK_PROMPTS.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              disabled={loading}
              onClick={() => handleSendQuestion(prompt)}
              className="shrink-0 px-3 py-1.5 rounded-xl bg-purple-50/80 hover:bg-purple-100 border border-purple-200 text-xs font-black text-purple-900 shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            >
              💬 {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* 3. CHAT MESSAGES / ANSWER CARDS STREAM */}
      <div className="flex-1 space-y-4 overflow-y-auto pr-0.5 pb-24">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const card = msg.card;

          if (isUser) {
            return (
              <div key={msg.id} className="flex justify-end items-end gap-2">
                <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-sm bg-purple-700 text-white p-3.5 shadow-xs">
                  <p className="text-xs sm:text-sm font-bold leading-relaxed">{msg.content}</p>
                  <span className="text-[10px] text-purple-200 block text-right mt-1 font-medium">
                    {msg.timestamp}
                  </span>
                </div>
                <div className="h-7 w-7 rounded-full bg-purple-200 text-purple-800 flex items-center justify-center shrink-0 mb-0.5">
                  <User className="h-4 w-4" />
                </div>
              </div>
            );
          }

          // Assistant Response Card
          return (
            <div key={msg.id} className="flex items-start gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-linear-to-br from-purple-600 to-indigo-700 text-white flex items-center justify-center shadow-2xs shrink-0 mt-1">
                <Bot className="h-4 w-4" />
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                <DepthCard
                  depth={1}
                  className={cn(
                    "p-4 border",
                    card?.intent.startsWith("SAFETY")
                      ? "border-amber-300 bg-amber-50/50"
                      : "border-slate-200 bg-white"
                  )}
                >
                  {/* Card Header & Intent Badge */}
                  {card && (
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <Badge
                        variant={
                          card.intent.startsWith("SAFETY")
                            ? "amber"
                            : card.intent === "WHAT_CHANGED"
                            ? "blue"
                            : "green"
                        }
                        className="text-[11px] font-black"
                      >
                        {card.intent === "CURRENT_VALUE"
                          ? "नवीनतम स्थिति (Current)"
                          : card.intent === "WHAT_CHANGED"
                          ? "स्वास्थ्य में बदलाव (What Changed)"
                          : card.intent === "BP_SUMMARY"
                          ? "रक्तचाप (BP)"
                          : card.intent === "WEIGHT_SUMMARY"
                          ? "वजन (Weight)"
                          : card.intent === "ACTIVITY_SUMMARY"
                          ? "गतिविधि (Activity)"
                          : card.intent === "MEDICINE_ADHERENCE"
                          ? "दवाइयाँ (Medicines)"
                          : card.intent === "FOOD_SUMMARY"
                          ? "भोजन (Nutrition)"
                          : card.intent === "SLEEP_SUMMARY"
                          ? "नींद (Sleep)"
                          : card.intent === "WELLNESS_SCORE"
                          ? "रूटीन स्कोर (Wellness)"
                          : card.intent.startsWith("SAFETY")
                          ? "सुरक्षा नियम (Safety)"
                          : "हेल्थ डेटा"}
                      </Badge>
                      <span className="text-[10px] text-slate-400 font-bold">{msg.timestamp}</span>
                    </div>
                  )}

                  {/* Natural Language Summary Text */}
                  <p className="text-xs sm:text-sm font-bold text-slate-900 leading-relaxed">
                    {msg.content}
                  </p>

                  {/* Main Metric Highlight Card (if available) */}
                  {card?.mainMetric && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                          {card.mainMetric.labelHi}
                        </span>
                        <span className="text-base sm:text-lg font-black text-slate-950">
                          {card.mainMetric.value}
                        </span>
                        {card.mainMetric.subvalue && (
                          <span className="text-[11px] font-bold text-slate-500 block mt-0.5">
                            {card.mainMetric.subvalue}
                          </span>
                        )}
                      </div>

                      {card.mainMetric.changeTextHi && (
                        <div
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-xs font-black self-start sm:self-center border",
                            card.mainMetric.changeDirection === "up"
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : card.mainMetric.changeDirection === "down"
                              ? "bg-blue-50 text-blue-800 border-blue-200"
                              : "bg-slate-100 text-slate-700 border-slate-200"
                          )}
                        >
                          {card.mainMetric.changeTextHi}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Bullet Points */}
                  {card?.bullets && card.bullets.length > 0 && (
                    <div className="mt-2.5 space-y-1 bg-slate-50/60 p-2.5 rounded-xl border border-slate-100">
                      {card.bullets.map((b, idx) => (
                        <p key={idx} className="text-xs font-bold text-slate-700 flex items-start gap-1.5">
                          <span className="text-purple-600 font-black">•</span>
                          <span>{b}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Safety Disclaimer Banner */}
                  {card?.disclaimerHi && (
                    <div className="mt-3 p-2.5 rounded-xl bg-amber-100/70 border border-amber-200 text-amber-900 text-xs font-bold flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
                      <span>{card.disclaimerHi}</span>
                    </div>
                  )}

                  {/* Evidence & Confidence Bar (§30, §31) */}
                  {card && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>📊 {card.evidence.recordsEvaluated} मान्य रिकॉर्ड्स पर आधारित</span>
                        <span>·</span>
                        <span>दिनांक: {card.evidence.dataThroughDate}</span>
                        <span>·</span>
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-black uppercase",
                            card.evidence.confidence === "High"
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-amber-100 text-amber-900"
                          )}
                        >
                          विश्वास: {card.evidence.confidence}
                        </span>
                      </div>

                      {/* Expandable Explanation Button (§46) */}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCalculationId(
                            expandedCalculationId === card.id ? null : card.id
                          )
                        }
                        className="text-purple-700 hover:text-purple-950 font-black flex items-center gap-0.5 cursor-pointer underline"
                      >
                        <span>गणना कैसे हुई?</span>
                        {expandedCalculationId === card.id ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  )}

                  {/* Explanation on Demand Drawer (§46) */}
                  {card && expandedCalculationId === card.id && (
                    <div className="mt-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 animate-in fade-in duration-100">
                      <p className="font-black text-slate-900">
                        विधि: {card.evidence.calculationMethodHi} ({card.evidence.calculationMethod})
                      </p>
                      {card.evidence.formulaDetails && (
                        <p className="font-bold text-slate-600">
                          सूत्र / तर्क: {card.evidence.formulaDetails}
                        </p>
                      )}
                      <p className="font-bold text-slate-500">
                        मूल्यांकित रिकॉर्ड्स: {card.evidence.recordsEvaluated} प्रविष्टियाँ
                      </p>
                    </div>
                  )}

                  {/* Action Link & Feedback Buttons (§47, §48) */}
                  {card && (
                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                      {card.evidence.relatedActionUrl ? (
                        <Link
                          href={card.evidence.relatedActionUrl}
                          className="inline-flex items-center gap-1 text-xs font-black text-purple-700 hover:text-purple-900"
                        >
                          <span>{card.evidence.relatedActionLabelHi || "डेटा संशोधन करें"}</span>
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      ) : (
                        <div />
                      )}

                      <div className="flex items-center gap-1 text-xs font-bold text-slate-500">
                        <span className="text-[11px] mr-1">उपयोगी रहा?</span>
                        <button
                          type="button"
                          onClick={() => handleFeedback(card.id, "helpful")}
                          className={cn(
                            "p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer",
                            feedbackMap[card.id] === "helpful" && "text-emerald-600 font-black"
                          )}
                          title="हाँ, उपयोगी रहा"
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFeedback(card.id, "not_helpful")}
                          className={cn(
                            "p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer",
                            feedbackMap[card.id] === "not_helpful" && "text-red-600 font-black"
                          )}
                          title="नहीं"
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </DepthCard>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-white border border-slate-200 shadow-2xs w-fit">
            <div className="h-6 w-6 rounded-lg bg-purple-600 text-white flex items-center justify-center animate-spin">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-black text-slate-700">
              वास्तविक स्वास्थ्य रिकॉर्ड्स विश्लेषित किए जा रहे हैं...
            </span>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* 4. STICKY INPUT BAR AT BOTTOM (§53 - Mobile-first, above keyboard) */}
      <div className="sticky bottom-2 z-20 bg-white/95 backdrop-blur-md p-2 rounded-2xl border border-slate-300 shadow-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendQuestion();
          }}
          className="flex items-center gap-1.5"
        >
          <button
            type="button"
            onClick={handleClearChat}
            className="h-10 w-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            title="बातचीत साफ करें"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder={
              isPapa
                ? "पापा के स्वास्थ्य डेटा के बारे में पूछें (e.g. कल का BP, 7 दिन के steps)..."
                : "स्वास्थ्य डेटा के बारे में पूछें..."
            }
            disabled={loading}
            className="flex-1 h-10 px-3.5 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-bold text-slate-900 focus:outline-purple-600 focus:border-purple-600 placeholder:text-slate-400"
          />

          <button
            type="submit"
            disabled={!inputQuery.trim() || loading}
            className="h-10 px-3.5 rounded-xl bg-purple-700 hover:bg-purple-800 disabled:opacity-40 text-white font-black text-xs sm:text-sm flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
          >
            <span>पूछें</span>
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
