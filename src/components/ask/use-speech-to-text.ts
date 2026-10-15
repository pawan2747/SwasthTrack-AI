"use client";

/**
 * One microphone, two engines.
 *
 *   browser  the Web Speech API (Chrome / Edge / Safari in a tab): nothing reaches our server (the browser's own recogniser receives the audio; Google's in Chrome), the words
 *            appear as they are spoken. Used first wherever it exists.
 *   server   MediaRecorder -> one clip -> POST /api/ai/transcribe (Whisper on Groq, Gemini audio as the
 *            fallback). Works on every phone that can record: Firefox, Brave, in-app browsers and the
 *            installed iPhone app, where the Web Speech API is missing or silently dead. A recording
 *            leaves the device, so it needs the family's MEDIA switch (asked on the first tap, never on
 *            page load). Whisper invents text on silence: the clip is uploaded only if the level meter
 *            heard speech (src/services/voicelog/capture.ts), and the route drops known hallucinations.
 *
 * The caller decides what the words do (the Ask box, the log sheet's text area); this hook never sends
 * anything on its own. When Web Speech fails in a way that will repeat (service not allowed, no network
 * service, language unsupported, or it ended at once without a word) and the server engine is possible,
 * the choice is remembered (localStorage `soie.sttEngine`) and the next tap records instead.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authFetch } from "@/lib/db/auth-fetch";
import { CAPTURE, SpeechGate, chooseEngine, pickRecorderMime, rmsOfBytes, type MediaConsent, type SttEngine } from "@/services/voicelog/capture";
import type { TranscribeResponse } from "@/services/voicelog/types";

export type SttState = "idle" | "starting" | "listening" | "transcribing";
export type SttLang = "hi-IN" | "en-IN";

// The Web Speech API is not in every TypeScript DOM lib; declare only what is used.
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function canRecordNow(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (window.isSecureContext === false) return false;
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
}

const subscribeNever = () => () => {};
const ENGINE_KEY = "soie.sttEngine";

function readPreferServer(): boolean {
  try {
    return window.localStorage.getItem(ENGINE_KEY) === "server";
  } catch {
    return false;
  }
}
function rememberServer(): void {
  try {
    window.localStorage.setItem(ENGINE_KEY, "server");
  } catch {
    // not remembered; this visit still uses it
  }
}

const BROWSER_ERROR: Record<string, string> = {
  "not-allowed": "माइक की अनुमति नहीं मिली। ब्राउज़र की सेटिंग में माइक चालू करें।",
  "service-not-allowed": "माइक की अनुमति नहीं मिली। ब्राउज़र की सेटिंग में माइक चालू करें।",
  "no-speech": "कुछ सुनाई नहीं दिया। माइक दबाकर साफ़ बोलिए।",
  "audio-capture": "माइक नहीं मिला। माइक जुड़ा है या नहीं देखें।",
  network: "आवाज़ पहचानने के लिए इंटरनेट चाहिए।",
  "language-not-supported": "यह भाषा इस ब्राउज़र में सपोर्ट नहीं है। दूसरी भाषा चुनें।",
};
/** Failures of the browser engine that repeat: next time record and upload instead. */
const SWITCH_ON = new Set(["service-not-allowed", "network", "language-not-supported"]);

const MIC_ERROR: Record<string, string> = {
  NotAllowedError: "माइक की अनुमति नहीं मिली। ब्राउज़र की सेटिंग में माइक चालू करें।",
  SecurityError: "माइक सिर्फ़ सुरक्षित (https) पेज पर चलता है।",
  NotFoundError: "माइक नहीं मिला। माइक जुड़ा है या नहीं देखें।",
  NotReadableError: "माइक किसी दूसरे ऐप में चल रहा है। उसे बंद करके फिर कोशिश करें।",
  OverconstrainedError: "माइक नहीं मिला। माइक जुड़ा है या नहीं देखें।",
};

const NO_SPEECH_NOTICE = "आवाज़ नहीं सुनाई दी। माइक दबाकर साफ़ और पास से बोलिए।";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

export interface UseSpeechToTextOptions {
  lang: SttLang;
  patientId: string | null;
  /** The family's media switch for this patient (see useAiSettings): the server engine needs "on". */
  media: MediaConsent;
  /** The words of one finished utterance (either engine). */
  onFinal: (text: string) => void;
  /** Running words while the browser engine listens. */
  onInterim?: (text: string) => void;
  /** The server engine was asked for while the family was never asked: show the consent dialog. */
  onNeedConsent?: () => void;
  onNotice?: (message: string, tone?: "error" | "info") => void;
}

export interface UseSpeechToText {
  /** What a tap uses right now; "none" = no way to listen on this device (hide the microphone). */
  engine: SttEngine;
  state: SttState;
  /** 0-1 microphone level (server engine). */
  level: number;
  /** Seconds left of the recording (server engine). */
  secondsLeft: number;
  start: () => void;
  /** Stop listening and use what was heard. */
  stop: () => void;
  /** Stop and throw away. */
  cancel: () => void;
}

export function useSpeechToText(options: UseSpeechToTextOptions): UseSpeechToText {
  const webSpeech = useSyncExternalStore(subscribeNever, () => recognitionCtor() !== null, () => false);
  const canRecord = useSyncExternalStore(subscribeNever, canRecordNow, () => false);
  const [preferServer, setPreferServer] = useState<boolean>(readPreferServer);
  const [state, setState] = useState<SttState>("idle");
  const [level, setLevel] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(Math.round(CAPTURE.maxMs / 1000));

  const engine = chooseEngine({ webSpeech, canRecord, media: options.media, preferServer });

  const optsRef = useRef(options);
  const engineRef = useRef(engine);
  useEffect(() => {
    optsRef.current = options;
    engineRef.current = engine;
  });

  const alive = useRef(true);
  const cancelled = useRef(false);
  const recognition = useRef<Recognition | null>(null);
  const capture = useRef<{
    recorder: MediaRecorder | null;
    stream: MediaStream | null;
    audio: AudioContext | null;
    timer: ReturnType<typeof setInterval> | null;
    gate: SpeechGate;
    startedAt: number;
    lastTick: number;
    chunks: Blob[];
    mime: string;
  } | null>(null);

  const notice = useCallback((message: string, tone: "error" | "info" = "error") => optsRef.current.onNotice?.(message, tone), []);

  const releaseCapture = useCallback(() => {
    const c = capture.current;
    if (!c) return;
    if (c.timer) clearInterval(c.timer);
    c.stream?.getTracks().forEach((t) => t.stop());
    void c.audio?.close().catch(() => undefined);
    capture.current = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelled.current = true;
      recognition.current?.abort();
      const rec = capture.current?.recorder;
      try {
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {
        // already stopped
      }
      releaseCapture();
    };
  }, [releaseCapture]);

  // ------------------------------------------------------------------------------------- browser engine
  const startBrowser = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    const rec = new Ctor();
    rec.lang = optsRef.current.lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    cancelled.current = false;
    let said = "";
    let gotError: string | null = null;
    const t0 = Date.now();
    const serverPossible = canRecordNow() && (optsRef.current.media === "on" || optsRef.current.media === "unasked");
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript ?? "";
      said = text;
      optsRef.current.onInterim?.(text);
    };
    rec.onerror = (e) => {
      gotError = e.error;
      if (e.error === "aborted") return;
      if (SWITCH_ON.has(e.error) && serverPossible) {
        rememberServer();
        setPreferServer(true);
        notice("इस ब्राउज़र में सीधी आवाज़ पहचान नहीं चल रही। माइक फिर दबाइए; अब आवाज़ रिकॉर्ड करके पहचानी जाएगी।", "info");
        return;
      }
      notice(BROWSER_ERROR[e.error] ?? "आवाज़ पहचान में दिक्कत आई। फिर कोशिश करें।");
    };
    rec.onend = () => {
      recognition.current = null;
      if (!alive.current) return;
      setState("idle");
      if (cancelled.current) return;
      if (said.trim()) {
        optsRef.current.onFinal(said);
      } else if (gotError === null && Date.now() - t0 < 1_500) {
        // It ended at once with nothing: a silent failure (reported for installed iPhone apps). Record instead, if we can.
        if (serverPossible) {
          rememberServer();
          setPreferServer(true);
          notice("आवाज़ पहचान शुरू नहीं हो पाई। माइक फिर दबाइए; अब आवाज़ रिकॉर्ड करके पहचानी जाएगी।", "info");
        } else {
          notice(NO_SPEECH_NOTICE);
        }
      }
    };
    recognition.current = rec;
    try {
      rec.start();
      setState("listening");
    } catch {
      recognition.current = null;
      setState("idle");
    }
  }, [notice]);

  // ------------------------------------------------------------------------------------- server engine
  const finishCapture = useCallback(async () => {
    const c = capture.current;
    if (!c) return;
    const gate = c.gate;
    const durationMs = Math.round(Date.now() - c.startedAt);
    const chunks = c.chunks;
    const mime = c.recorder?.mimeType || c.mime || "audio/webm";
    releaseCapture();
    if (!alive.current) return;
    setLevel(0);
    if (cancelled.current) {
      setState("idle");
      return;
    }
    const verdict = gate.verdict();
    if (!verdict.upload) {
      setState("idle");
      notice(NO_SPEECH_NOTICE, "info");
      return;
    }
    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 200) {
      setState("idle");
      notice(NO_SPEECH_NOTICE, "info");
      return;
    }
    if (blob.size > 1_400_000) {
      setState("idle");
      notice("रिकॉर्डिंग बहुत लंबी है। छोटा बोलिए।");
      return;
    }
    setState("transcribing");
    try {
      const data = await blobToBase64(blob);
      const res = await authFetch("/api/ai/transcribe", {
        method: "POST",
        body: JSON.stringify({ patientId: optsRef.current.patientId, mimeType: blob.type || mime, data, lang: optsRef.current.lang === "en-IN" ? "en" : "hi", durationMs }),
      });
      if (!alive.current || cancelled.current) return;
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { code?: string } | null;
        if (res.status === 403 && j?.code === "ai_photos_unasked") optsRef.current.onNeedConsent?.();
        else if (res.status === 403) notice("इस परिवार ने आवाज़ AI को भेजना बंद किया है। टाइप करें या कीबोर्ड का माइक इस्तेमाल करें।");
        else if (res.status === 413) notice("रिकॉर्डिंग बहुत लंबी है। छोटा बोलिए।");
        else notice("आवाज़ पहचानी नहीं जा सकी। टाइप करें या फिर कोशिश करें।");
        return;
      }
      const body = (await res.json()) as TranscribeResponse;
      if (body.status === "ok") optsRef.current.onFinal(body.text);
      else if (body.status === "no_speech") notice("आवाज़ साफ़ नहीं सुनाई दी। पास से, धीरे-धीरे बोलकर फिर कोशिश करें।", "info");
      else if (body.reason === "rate_limited") notice("AI का कोटा अभी पूरा हो गया है। कुछ देर बाद फिर कोशिश करें, या टाइप करें।");
      else notice("आवाज़ पहचान अभी उपलब्ध नहीं है। टाइप करें।");
    } catch {
      if (alive.current && !cancelled.current) notice("इंटरनेट जाँचकर फिर कोशिश करें।");
    } finally {
      if (alive.current) setState("idle");
    }
  }, [notice, releaseCapture]);

  const startServer = useCallback(async () => {
    const o = optsRef.current;
    if (o.media === "unasked") {
      o.onNeedConsent?.();
      return;
    }
    if (o.media !== "on" || !o.patientId) return;
    cancelled.current = false;
    setState("starting");
    // Created inside the tap, before anything is awaited: iOS only lets a gesture start audio.
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let audio: AudioContext | null = null;
    try {
      audio = Ctx ? new Ctx() : null;
      void audio?.resume();
    } catch {
      audio = null;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      void audio?.close().catch(() => undefined);
      if (!alive.current) return;
      setState("idle");
      const name = err instanceof Error ? err.name : "";
      notice(MIC_ERROR[name] ?? "माइक शुरू नहीं हो पाया। फिर कोशिश करें।");
      return;
    }
    if (!alive.current || cancelled.current) {
      stream.getTracks().forEach((t) => t.stop());
      void audio?.close().catch(() => undefined);
      return;
    }
    const mime = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        void audio?.close().catch(() => undefined);
        setState("idle");
        notice("इस फ़ोन पर रिकॉर्डिंग शुरू नहीं हो पाई। टाइप करें।");
        return;
      }
    }
    const gate = new SpeechGate();
    const now = Date.now();
    capture.current = { recorder, stream, audio, timer: null, gate, startedAt: now, lastTick: now, chunks: [], mime };
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) capture.current?.chunks.push(e.data);
    };
    recorder.onstop = () => void finishCapture();
    recorder.onerror = () => {
      cancelled.current = true;
      void finishCapture();
    };

    // The level meter: also what makes "stop on silence" and "do not upload silence" possible.
    let analyser: AnalyserNode | null = null;
    let frame: Uint8Array<ArrayBuffer> | null = null;
    if (audio) {
      try {
        const source = audio.createMediaStreamSource(stream);
        analyser = audio.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        frame = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      } catch {
        analyser = null;
      }
    }
    let lastSecond = -1;
    const cap = capture.current;
    cap.timer = setInterval(() => {
      const tNow = Date.now();
      const dt = tNow - cap.lastTick;
      cap.lastTick = tNow;
      let rms = 0;
      if (analyser && frame) {
        analyser.getByteTimeDomainData(frame);
        rms = rmsOfBytes(frame);
      }
      gate.push(rms, dt);
      setLevel(Math.min(1, rms * 6));
      const left = Math.max(0, Math.ceil((CAPTURE.maxMs - gate.state.elapsedMs) / 1000));
      if (left !== lastSecond) {
        lastSecond = left;
        setSecondsLeft(left);
      }
      // Without a meter (no AudioContext) the clip simply runs to the cap or the person's stop.
      const why = analyser ? gate.shouldStop() : gate.state.elapsedMs >= CAPTURE.maxMs ? "max" : null;
      if (why && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // already stopping
        }
      }
    }, 80);
    try {
      recorder.start();
      setState("listening");
    } catch {
      releaseCapture();
      setState("idle");
      notice("इस फ़ोन पर रिकॉर्डिंग शुरू नहीं हो पाई। टाइप करें।");
    }
  }, [finishCapture, notice, releaseCapture]);

  // ------------------------------------------------------------------------------------- public
  const start = useCallback(() => {
    if (state !== "idle") return;
    if (engineRef.current === "browser") startBrowser();
    else if (engineRef.current === "server") void startServer();
  }, [startBrowser, startServer, state]);

  const stop = useCallback(() => {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    const rec = capture.current?.recorder;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // already stopping
      }
    }
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recognition.current) {
      recognition.current.abort();
      return;
    }
    const rec = capture.current?.recorder;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // already stopping
      }
    } else {
      releaseCapture();
      setState("idle");
    }
  }, [releaseCapture]);

  return { engine, state, level, secondsLeft, start, stop, cancel };
}
