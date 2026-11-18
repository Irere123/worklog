import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { q } from "#api/queries";

type Heard = { results: SpeechRecognitionResultList };

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

const RECORDINGS = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];
const BITRATE = 32_000;
const MIN_MS = 500;
const MAX_MS = 5 * 60_000;
const VOICE = 0.12;

type Session = {
  started: string;
  before: string;
  written: string | null;
  recognizer: Recognizer | null;
  recording: boolean;
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  audio: AudioContext | null;
  chunks: Blob[];
  startedAt: number;
  voice: "unknown" | "silent" | "heard";
  upload: AbortController;
  timer: number;
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
  const box = useRef(value);
  useLayoutEffect(() => {
    box.current = value;
  }, [value]);
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
    current.recognizer?.abort();
    current.recognizer = null;
    try {
      const { text } = await unwrap(
        api.POST("/v1/transcriptions", {
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
      if (!current.recording) {
        settle(current);
      }
    };
    recognition.addEventListener("end", ended);
    recognition.addEventListener("error", ended);
    current.recognizer = recognition;
    recognition.start();
  };

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
    current.recording = false;
    if (!current.recognizer) {
      settle(current);
    }
  };

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
    finish: (deliver: (said: string) => void) => {
      const { current } = session;
      if (!current) {
        deliver(value);
        return;
      }
      current.deliver = deliver;
      stop();
    },
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
