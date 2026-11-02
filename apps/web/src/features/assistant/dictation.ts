import { useEffect, useRef, useState } from "react";

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

function recognizerClass(): RecognizerClass | null {
  const found: unknown =
    Reflect.get(globalThis, "SpeechRecognition") ??
    Reflect.get(globalThis, "webkitSpeechRecognition");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the browser's own constructor, checked to exist; its shape is the standard one above
  return typeof found === "function" ? (found as RecognizerClass) : null;
}

/**
 * Speaking a question instead of typing it, with the browser's own speech recognition: words
 * appear as they're heard, and the person sends when it reads right. Where the browser has none,
 * `supported` is false and nothing is shown.
 */
export function useDictation(onHeard: (heard: string) => void) {
  const [listening, setListening] = useState(false);
  const active = useRef<Recognizer | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const start = () => {
    const Recognition = recognizerClass();
    if (!Recognition || active.current) {
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.addEventListener("result", (event) => {
      // Stopping still delivers what was already heard; after a cancel nothing may land.
      if (active.current !== recognition) {
        return;
      }
      const heard = Array.from(
        event.results,
        (result) => result[0]?.transcript ?? ""
      ).join("");
      onHeard(heard.trim());
    });
    const done = () => {
      if (active.current === recognition) {
        active.current = null;
      }
      setListening(false);
    };
    recognition.addEventListener("end", done);
    recognition.addEventListener("error", done);
    active.current = recognition;
    recognition.start();
    setListening(true);
  };

  return {
    supported: recognizerClass() !== null,
    listening,
    start,
    stop: () => active.current?.stop(),
    /** Ends dictation and drops anything still being heard: the words were sent or cleared. */
    cancel: () => {
      const recognition = active.current;
      active.current = null;
      setListening(false);
      recognition?.abort();
    },
  };
}
