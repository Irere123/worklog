import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { q } from "#api/queries";

type Heard = { results: SpeechRecognitionResultList };

// The Web Speech API isn't in TypeScript's DOM types; this is the part dictation uses.
type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  addEventListener: {
    (type: "result", listener: (event: Heard) => void): void;
    (type: "end" | "error", listener: () => void): void;
  };
};

type RecognizerClass = new () => Recognizer;

/** Where dictation stands. One at a time; `start`, `stop`, `cancel` and `settle` move it. */
export type DictationPhase = "idle" | "listening" | "transcribing";

// Opus first: speech at 32 kbps is about 240 KB a minute and transcribes as well as a WAV ten
// times its size. Safari records only MP4.
const RECORDINGS = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];
const BITRATE = 32_000;
// A tap on the mic and back isn't worth a call, and a message isn't five minutes long.
const MIN_MS = 500;
const MAX_MS = 5 * 60_000;
// Loudness (RMS × 6, so 0–1) that a voice passes and a quiet room, after noise suppression, doesn't.
const VOICE = 0.12;

type Session = {
  /** The box when it started, and the part kept in front of what's heard. */
  started: string;
  before: string;
  /** What dictation last put in the box: while the box still says it, the person hasn't edited. */
  written: string | null;
  /** The browser's live words, while it's listening. */
  recognizer: Recognizer | null;
  /** Whether a recording decides the end: false listening with the browser alone. */
  recording: boolean;
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  audio: AudioContext | null;
  chunks: Blob[];
  /** When the recorder started: the microphone prompt before it isn't part of the recording. */
  startedAt: number;
  /** Unknown until the meter has run: a recording it never heard a voice in isn't sent. */
  voice: "unknown" | "silent" | "heard";
  upload: AbortController;
  timer: number;
  /** Waiting on the last words to send them: given the box's text once they're in. */
  deliver: ((said: string) => void) | null;
};

/**
 * Speaking instead of typing. The browser's own recognition shows words as they're heard; with a
 * model on the server, the recording is then transcribed with the workspace's names spelled
 * right and replaces them, unless the person has edited the text since. With neither,
 * `supported` is false and nothing is shown.
 */
export function useDictation({
  value,
  onChange,
  onEnd,
  meter,
}: {
  /** The text in the box now: what's heard is written after what was there at the start. */
  value: string;
  onChange: (next: string) => void;
  /**
   * It finished (heard, transcribed or failed), with the box's text: the parent's own state may
   * not show the last words yet. Not called after `cancel`, whose caller knows.
   */
  onEnd?: (said: string) => void;
  /** Shows how loudly it hears you, as a `--level` from 0 to 1 set on it each frame. */
  meter?: RefObject<HTMLElement | null>;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const transcribes = useQuery({ ...q.me(), select: (me) => me.ai }).data;
  const session = useRef<Session | null>(null);
  // A transcript arrives long after the click that asked for it, and compares with the box then.
  const box = useRef(value);
  useLayoutEffect(() => {
    box.current = value;
  }, [value]);
  // Cleared first, as `cancel` does, so the recorder's stop event finds no session to transcribe.
  useEffect(
    () => () => {
      const { current } = session;
      session.current = null;
      release(current, true);
    },
    []
  );

  const write = (current: Session, text: string) => {
    const next = [current.before, text].filter(Boolean).join(" ");
    current.written = next;
    box.current = next;
    onChange(next);
  };

  const settle = (current: Session) => {
    if (session.current !== current) {
      return;
    }
    release(current, false);
    session.current = null;
    setPhase("idle");
    onEnd?.(box.current);
    current.deliver?.(box.current);
  };

  const transcribe = async (current: Session, recording: Blob) => {
    setPhase("transcribing");
    // The transcript supersedes the browser's last words; they mustn't land after it.
    current.recognizer?.abort();
    current.recognizer = null;
    try {
      const { text } = await unwrap(
        api.POST("/v1/transcriptions", {
          // The schema types a binary body as a string; the recording goes out as itself.
          body: "",
          bodySerializer: () => recording,
          headers: { "content-type": recording.type },
          signal: current.upload.signal,
        })
      );
      const untouched = box.current === (current.written ?? current.started);
      if (text && untouched && session.current === current) {
        write(current, text);
      }
    } catch {
      if (current.upload.signal.aborted) {
        return;
      }
      // Words from the browser already in the box stand; with none, say why nothing came.
      if (current.written === null) {
        toast.error("Couldn't make out what you said. Try again.");
      }
    }
    settle(current);
  };

  const measure = (current: Session, stream: MediaStream) => {
    const { audio } = current;
    if (!audio) {
      return;
    }
    void audio.resume();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let level = 0;
    const tick = () => {
      if (
        session.current !== current ||
        current.recorder?.state !== "recording"
      ) {
        meter?.current?.style.setProperty("--level", "0");
        return;
      }
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }
      const loudness = Math.min(1, Math.sqrt(sum / samples.length) * 6);
      if (audio.state === "running") {
        if (loudness > VOICE) {
          current.voice = "heard";
        } else if (current.voice === "unknown") {
          current.voice = "silent";
        }
      }
      // Rises at once and falls slowly, so the ring follows a voice instead of flickering.
      level = Math.max(loudness, level * 0.85);
      meter?.current?.style.setProperty("--level", level.toFixed(3));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const record = async (current: Session) => {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      // Stopped while the browser asked for the microphone.
      if (session.current !== current || !current.recording) {
        stopTracks(stream);
        return;
      }
      const recorder = new MediaRecorder(stream, {
        mimeType: RECORDINGS.find((type) =>
          MediaRecorder.isTypeSupported(type)
        ),
        audioBitsPerSecond: BITRATE,
      });
      recorder.addEventListener("dataavailable", (event) => {
        current.chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        const long = performance.now() - current.startedAt >= MIN_MS;
        if (session.current === current && long && current.voice !== "silent") {
          void transcribe(
            current,
            new Blob(current.chunks, { type: recorder.mimeType })
          );
        } else {
          // A tap and back is a change of mind; a real recording with no voice in it needs a word.
          if (long && current.voice === "silent" && current.written === null) {
            toast.error("Didn't hear anything. Check your microphone.");
          }
          settle(current);
        }
      });
      current.stream = stream;
      current.recorder = recorder;
      recorder.start();
      current.startedAt = performance.now();
      measure(current, stream);
    } catch {
      stopTracks(stream);
      if (session.current !== current) {
        return;
      }
      // The browser's live words, if it has them, carry on alone and end the dictation.
      current.recording = false;
      if (!current.recognizer) {
        toast.error(
          "Worklog can't hear you. Allow the microphone for this site."
        );
        settle(current);
      }
    }
  };

  const listen = (current: Session) => {
    const Recognition = recognizerClass();
    if (!Recognition) {
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.addEventListener("result", (event) => {
      // Stopping still delivers what was already heard; after a cancel nothing may land.
      if (session.current !== current || current.recognizer !== recognition) {
        return;
      }
      const heard = Array.from(
        event.results,
        (result) => result[0]?.transcript ?? ""
      )
        .join("")
        .trim();
      if (heard) {
        current.voice = "heard";
        write(current, heard);
      }
    });
    const ended = () => {
      if (current.recognizer !== recognition) {
        return;
      }
      current.recognizer = null;
      // With a recording, it decides the end; the live words just stop where they are.
      if (!current.recording) {
        settle(current);
      }
    };
    recognition.addEventListener("end", ended);
    recognition.addEventListener("error", ended);
    current.recognizer = recognition;
    recognition.start();
  };

  /** Stops listening. What was heard stays and, with a model, is transcribed. */
  const stop = () => {
    const { current } = session;
    if (!current) {
      return;
    }
    current.recognizer?.stop();
    if (current.recorder?.state === "recording") {
      current.recorder.stop();
      stopTracks(current.stream);
      return;
    }
    if (current.recorder) {
      return;
    }
    // No recording yet: the microphone prompt is still up, or the browser is listening alone.
    current.recording = false;
    if (!current.recognizer) {
      settle(current);
    }
  };

  /** Whether it started: there may be no way to listen, or a dictation already going. */
  const start = () => {
    const live = recognizerClass() !== null;
    const recorded = recordable(transcribes);
    if (session.current || (!live && !recorded)) {
      return false;
    }
    const current: Session = {
      started: value,
      before: value.trim(),
      written: null,
      recognizer: null,
      recording: recorded,
      recorder: null,
      stream: null,
      // Made in the click itself: Safari suspends one made after the microphone prompt.
      audio: recorded ? new AudioContext() : null,
      chunks: [],
      startedAt: 0,
      voice: "unknown",
      upload: new AbortController(),
      timer: window.setTimeout(stop, MAX_MS),
      deliver: null,
    };
    session.current = current;
    setPhase("listening");
    listen(current);
    if (recorded) {
      void record(current);
    }
    return true;
  };

  return {
    supported: recognizerClass() !== null || recordable(transcribes),
    phase,
    start,
    stop,
    /** Stops, and hands `deliver` the box's text once the last words are in: to send them. */
    finish: (deliver: (said: string) => void) => {
      const { current } = session;
      if (!current) {
        deliver(value);
        return;
      }
      current.deliver = deliver;
      stop();
    },
    /** Ends dictation and drops anything still being heard: the words were sent or cleared. */
    cancel: () => {
      const { current } = session;
      session.current = null;
      setPhase("idle");
      release(current, true);
    },
  };
}

function recognizerClass(): RecognizerClass | null {
  const found: unknown =
    Reflect.get(globalThis, "SpeechRecognition") ??
    Reflect.get(globalThis, "webkitSpeechRecognition");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the browser's own constructor, checked to exist; its shape is the standard one above
  return typeof found === "function" ? (found as RecognizerClass) : null;
}

function recordable(transcribes: boolean | undefined) {
  return (
    transcribes === true &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Lets go of the microphone and what listens to it; `drop` also abandons the words. */
function release(current: Session | null, drop: boolean) {
  if (!current) {
    return;
  }
  window.clearTimeout(current.timer);
  if (drop) {
    current.upload.abort();
    current.recognizer?.abort();
    current.recognizer = null;
    if (current.recorder?.state === "recording") {
      current.recorder.stop();
    }
  }
  stopTracks(current.stream);
  void current.audio?.close().catch(() => null);
  current.audio = null;
}

function stopTracks(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}
