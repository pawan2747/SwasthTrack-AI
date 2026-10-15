/**
 * What a speech-to-text transcript may be believed to be. PURE.
 *
 * Whisper hallucinates text on silence (measured live: its no_speech_prob is always 0 here, so the model's
 * own confidence cannot be used): "Thank you.", "Thanks for watching", "Subtitles by the Amara.org
 * community", a Hindi "धन्यवाद", the prompt it was given, a loop of one word, text in a script nobody
 * speaks. The browser already refuses to upload a clip with no speech energy; this is the server's second
 * line, applied to every transcript before it is returned. A dropped transcript is "no speech heard",
 * never an error, and the person is simply asked to speak again.
 */

export type DropReason = "empty" | "meta" | "filler" | "echo" | "script" | "loop" | "too_long_for_clip";

export type FilteredTranscript = { text: string; dropped: false } | { text: ""; dropped: true; reason: DropReason };

const MAX_CHARS = 1_000;

function fold(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‌‍]/g, "")
    .replace(/[“”"'‘’`.,!?;:()\[\]{}…।|\-–—_/\\*#~^<>+=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Phrases that are never what a person says to this app, whatever the length of the clip. */
const STRONG = [
  "thanks for watching",
  "thank you for watching",
  "thank you so much for watching",
  "please subscribe",
  "subscribe to the channel",
  "like and subscribe",
  "don t forget to subscribe",
  "subtitles by",
  "subtitled by",
  "captions by",
  "transcribed by",
  "amara org",
  "sous titres",
  "देखने के लिए धन्यवाद",
  "देखने के लिए शुक्रिया",
  "सब्सक्राइब",
  "अगले वीडियो में मिलते हैं",
  "अगली वीडियो में मिलते हैं",
  "चैनल को",
  "字幕",
  "ご視聴ありがとうございました",
  "продолжение следует",
];

/** Phrases a person might say, but which on a very short clip are overwhelmingly a hallucination. */
const WEAK = new Set(
  [
    "thank you",
    "thanks",
    "thank you very much",
    "bye",
    "bye bye",
    "okay",
    "ok",
    "you",
    "so",
    "uh",
    "um",
    "hmm",
    "mm",
    "oh",
    "the end",
    "धन्यवाद",
    "शुक्रिया",
    "बहुत बहुत धन्यवाद",
    "धन्यवाद दोस्तों",
    "नमस्कार",
    "हम्म",
    "अच्छा",
    "ठीक है",
    "हाँ",
    "हां",
  ].map(fold),
);

/** What Gemini (the fallback transcriber) says instead of a transcript when there is nothing to transcribe. */
const META_START = [
  "no speech",
  "no audible",
  "silence",
  "inaudible",
  "unintelligible",
  "there is no speech",
  "there is no audio",
  "the audio is",
  "this audio",
  "i cannot",
  "i can t",
  "i m sorry",
  "sorry i",
  "as an ai",
  "कोई आवाज़ नहीं",
  "कोई आवाज नहीं",
];

function scriptShares(s: string): { latin: number; devanagari: number; other: number } {
  let latin = 0;
  let devanagari = 0;
  let other = 0;
  for (const ch of s) {
    if (/[A-Za-z]/.test(ch)) latin++;
    else if (/[ऀ-ॿ]/.test(ch)) devanagari++;
    else if (/\p{L}/u.test(ch)) other++;
  }
  return { latin, devanagari, other };
}

export interface FilterOptions {
  /** Length of the clip, when known (the browser measured it). */
  durationMs?: number | null;
  /** The vocabulary prompt the transcriber was given. */
  prompt?: string;
}

export function filterTranscript(raw: string, opts: FilterOptions = {}): FilteredTranscript {
  let text = String(raw ?? "")
    .normalize("NFC")
    .replace(/\[[^\]]{0,40}\]|\([^)]{0,40}\)/g, (m) => (/music|silence|blank|noise|applause|laugh|inaudible|संगीत|शोर|मौन/i.test(m) ? " " : m))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“'‘]+|["”'’]+$/g, "")
    .trim();
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS).trim();
  if (text.length === 0 || !/[\p{L}\p{N}]/u.test(text)) return { text: "", dropped: true, reason: "empty" };

  const f = fold(text);
  if (f.length === 0) return { text: "", dropped: true, reason: "empty" };
  if (META_START.some((m) => f.startsWith(fold(m)))) return { text: "", dropped: true, reason: "meta" };
  if (STRONG.some((p) => f.includes(fold(p)))) return { text: "", dropped: true, reason: "filler" };

  const words = f.split(" ");
  const durationMs = opts.durationMs ?? null;
  const short = durationMs !== null && durationMs < 3_000;
  if (WEAK.has(f) && (short || durationMs === null || words.length <= 3)) return { text: "", dropped: true, reason: "filler" };

  // A speaker cannot say 6 words a second: text far longer than the clip is invented.
  if (durationMs !== null && words.length > Math.ceil(durationMs / 1000) * 6 + 6) return { text: "", dropped: true, reason: "too_long_for_clip" };

  // The prompt coming back.
  if (opts.prompt) {
    const p = fold(opts.prompt);
    const pw = new Set(p.split(" ").filter(Boolean));
    if (f.length >= 6 && (f.includes(p) || p.includes(f))) return { text: "", dropped: true, reason: "echo" };
    const inPrompt = words.filter((w) => pw.has(w)).length;
    const hasDigit = /\p{N}/u.test(text);
    if (!hasDigit && words.length >= 3 && inPrompt / words.length >= 0.8) return { text: "", dropped: true, reason: "echo" };
  }

  // A script nobody speaks to this app (Cyrillic, CJK, Thai ... from a model that guessed the language).
  const sh = scriptShares(text);
  const letters = sh.latin + sh.devanagari + sh.other;
  if (letters >= 4 && sh.other / letters > 0.4) return { text: "", dropped: true, reason: "script" };

  // One word over and over.
  if (words.length >= 5) {
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    const top = Math.max(...counts.values());
    if (top >= 5 && top / words.length > 0.6) return { text: "", dropped: true, reason: "loop" };
  }

  return { text, dropped: false };
}
