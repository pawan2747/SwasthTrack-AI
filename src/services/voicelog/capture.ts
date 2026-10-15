/**
 * Microphone capture decisions, without the microphone. PURE: the hook (src/components/ask/
 * use-speech-to-text.ts) feeds it levels and asks it what to do, so the rules that keep Whisper from
 * being sent silence are testable under plain Node.
 *
 * Whisper invents text on silence, so a clip is uploaded only when speech was really heard:
 * enough voiced time, a peak above the room's noise, and at least a short clip. Recording stops by
 * itself a moment after the person stops talking.
 */

export const CAPTURE = {
  /** A clip longer than this is cut (about 180 KB at 32 kbps; always under the 1.5 MB route cap). */
  maxMs: 45_000,
  /** Shorter than this is a tap, not speech. */
  minMs: 800,
  /** Voiced time needed before a clip is worth uploading. */
  minSpeechMs: 350,
  /** Loudest frame (RMS, 0-1) needed; a quiet room sits around 0.002-0.01. */
  minPeak: 0.03,
  /** Stop this long after the last voiced frame, once speech was heard. */
  endSilenceMs: 1_800,
  /** Give up this long after the start if nothing was ever heard. */
  noSpeechGiveUpMs: 8_000,
  /** Frame is voiced above max(this, 2.5 x the room's noise floor). */
  minVoiceRms: 0.015,
} as const;

export interface GateState {
  elapsedMs: number;
  speechMs: number;
  peak: number;
  heard: boolean;
  silentMs: number;
  floor: number;
}

export class SpeechGate {
  private elapsed = 0;
  private speech = 0;
  private peak = 0;
  private lastVoicedAt = -1;
  private floor = Infinity;

  /** Feed one level frame (`rms` 0-1, `dtMs` since the previous frame). */
  push(rms: number, dtMs: number): void {
    this.elapsed += dtMs;
    this.peak = Math.max(this.peak, rms);
    // The room's noise is learnt from the first second; a voice arriving later does not move it.
    if (this.elapsed <= 1_000) this.floor = Math.min(this.floor, Math.max(rms, 0.001));
    const floor = Number.isFinite(this.floor) ? this.floor : 0.005;
    const voiced = rms > Math.max(CAPTURE.minVoiceRms, floor * 2.5);
    if (voiced) {
      this.speech += dtMs;
      this.lastVoicedAt = this.elapsed;
    }
  }

  get state(): GateState {
    const heard = this.speech >= 150;
    return {
      elapsedMs: this.elapsed,
      speechMs: this.speech,
      peak: this.peak,
      heard,
      silentMs: this.lastVoicedAt < 0 ? this.elapsed : this.elapsed - this.lastVoicedAt,
      floor: Number.isFinite(this.floor) ? this.floor : 0,
    };
  }

  /** Time to stop recording on our own? */
  shouldStop(): "max" | "end_of_speech" | "no_speech" | null {
    const s = this.state;
    if (s.elapsedMs >= CAPTURE.maxMs) return "max";
    if (s.heard && s.speechMs >= CAPTURE.minSpeechMs && s.silentMs >= CAPTURE.endSilenceMs) return "end_of_speech";
    if (!s.heard && s.elapsedMs >= CAPTURE.noSpeechGiveUpMs) return "no_speech";
    return null;
  }

  /** May this clip be uploaded? */
  verdict(): { upload: true } | { upload: false; reason: "too_short" | "no_speech" } {
    const s = this.state;
    if (s.elapsedMs < CAPTURE.minMs) return { upload: false, reason: "too_short" };
    if (s.speechMs < CAPTURE.minSpeechMs || s.peak < CAPTURE.minPeak) return { upload: false, reason: "no_speech" };
    return { upload: true };
  }
}

/** RMS (0-1) of an AnalyserNode byte time-domain frame (128 is silence). */
export function rmsOfBytes(frame: ArrayLike<number>): number {
  const n = frame.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = (frame[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/**
 * The container to ask MediaRecorder for. Ogg/Opus first (documented by Gemini, the fallback transcriber),
 * then WebM/Opus (Chrome, Edge, Firefox), then MP4/AAC (Safari). `supports` is MediaRecorder.isTypeSupported.
 * Null: let the browser choose.
 */
export function pickRecorderMime(supports: (type: string) => boolean): string | null {
  const candidates = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm", "audio/ogg"];
  for (const t of candidates) {
    try {
      if (supports(t)) return t;
    } catch {
      // a browser that throws for a type does not support it
    }
  }
  return null;
}

export type SttEngine = "browser" | "server" | "none";
export type MediaConsent = "on" | "unasked" | "off" | "unavailable" | "loading";

/**
 * Which engine a microphone tap uses.
 *
 *   browser  the Web Speech API: nothing reaches OUR server, instant words; the browser's own recogniser receives the audio (Google's in Chrome) (Chrome / Edge / Safari in a tab)
 *   server   record, upload one clip, Whisper: works wherever recording works, needs the family's media switch
 *   none     hide the microphone (the keyboard's own dictation key is always there)
 *
 * The browser engine stays first where it works. `preferServer` is remembered after the browser engine
 * failed in a way that will repeat (service not allowed, no network service, language unsupported, or it
 * ended at once without a word).
 */
export function chooseEngine(input: { webSpeech: boolean; canRecord: boolean; media: MediaConsent; preferServer: boolean }): SttEngine {
  const serverPossible = input.canRecord && (input.media === "on" || input.media === "unasked");
  if (input.webSpeech && !(input.preferServer && serverPossible)) return "browser";
  if (serverPossible) return "server";
  if (input.webSpeech) return "browser";
  return "none";
}
