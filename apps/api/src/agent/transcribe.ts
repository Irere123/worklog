import { z } from "zod";

import type { AppContext } from "#context";
import type { Member } from "#db/queries/members";
import { listVocabulary } from "#db/queries/vocabulary";
import type { Vocabulary } from "#db/queries/vocabulary";
import { unavailable, upstreamFailed } from "#lib/errors";
import { log } from "#telemetry/log";
import { traced } from "#telemetry/trace";

import { structured } from "./generate";
import { prompt } from "./prompts";

/** What a browser records in, by the name OpenRouter's transcription API knows it by. */
export const AUDIO_FORMATS = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
} as const;

export type AudioType = keyof typeof AUDIO_FORMATS;

// Minutes of compressed speech, far more than a message; it bounds what one request can buffer.
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";
const TIMEOUT_MS = 30_000;
const MAX_TERMS = 200;
const MAX_CARDS = 30;
// Whisper reads at most 224 tokens of prompt.
const HINT_CHARS = 600;

const Heard = z.object({
  text: z.string(),
  usage: z
    .object({ seconds: z.number().optional(), cost: z.number().optional() })
    .optional(),
});

const Fixed = z.object({ text: z.string() });

/**
 * Speech to text in two passes: a cheap speech model writes down what it heard, then the fast
 * model puts back the workspace's own names it misheard ("zac" → Slack). The second pass is
 * held to fixing words, never rewriting, and is skipped when it could only cost.
 */
export async function transcribe(
  ctx: AppContext,
  member: Member,
  audio: { bytes: Uint8Array; type: AudioType },
  signal?: AbortSignal
) {
  const { models } = ctx;
  if (!models) {
    throw unavailable("Transcription needs a model: set OPENROUTER_API_KEY");
  }
  return await traced(
    "dictation.transcribe",
    { "audio.bytes": audio.bytes.byteLength, "audio.type": audio.type },
    async (span) => {
      const vocabulary = await listVocabulary(ctx.db, {
        workspaceId: member.workspaceId,
        maxTerms: MAX_TERMS,
        maxCards: MAX_CARDS,
      });
      const heard = await hear(ctx, audio, vocabulary, signal);
      const text = heard.text.trim();
      const fixed =
        text && vocabulary.terms.length > 0
          ? await fixNames(models, text, vocabulary)
          : text;
      span.set({
        "audio.seconds": heard.usage?.seconds,
        "transcription.cost": heard.usage?.cost,
        "transcription.fixed": fixed !== text,
      });
      return { text: fixed };
    }
  );
}

async function hear(
  ctx: AppContext,
  audio: { bytes: Uint8Array; type: AudioType },
  vocabulary: Vocabulary,
  signal?: AbortSignal
) {
  const model = ctx.config.WORKLOG_TRANSCRIBE_MODEL;
  // A timeout, a dropped connection or a body that isn't a transcript fails like a refusal: a 502
  // the client falls back from, not an unhandled 500.
  let res: Response;
  try {
    res = await ctx.fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ctx.config.OPENROUTER_API_KEY ?? ""}`,
        "content-type": "application/json",
        "x-title": "Worklog",
        "http-referer": ctx.config.PUBLIC_URL,
      },
      body: JSON.stringify({
        model,
        input_audio: {
          data: Buffer.from(audio.bytes).toString("base64"),
          format: AUDIO_FORMATS[audio.type],
        },
        temperature: 0,
        provider: {
          // Work data never goes to providers that train on it, as for every other model call.
          data_collection: "deny",
          // Forwarded only to the provider that serves the request; the others drop it.
          options: { groq: { prompt: hint(vocabulary) } },
        },
      }),
      // The person who stopped waiting (cancelled, or left the page) shouldn't still be billed.
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    log.warn("transcription failed", { error, model });
    throw transcriptionFailed();
  }
  if (!res.ok) {
    log.warn("transcription failed", { status: res.status, model });
    throw transcriptionFailed();
  }
  const heard = Heard.safeParse(await res.json().catch(() => null));
  if (!heard.success) {
    log.warn("transcription failed", { status: res.status, model });
    throw transcriptionFailed();
  }
  return heard.data;
}

function transcriptionFailed() {
  return upstreamFailed("Couldn't turn that into text. Try again.");
}

async function fixNames(
  models: NonNullable<AppContext["models"]>,
  text: string,
  vocabulary: Vocabulary
) {
  try {
    const fixed = await structured(models, {
      model: "fast",
      // The vocabulary rides in the instructions, the same for every dictation in a workspace, so
      // it's the cached part of the prompt; only the words heard change.
      instructions: prompt("dictation", {
        terms: vocabulary.terms.join("\n"),
        cards: vocabulary.cards.join("\n"),
      }),
      prompt: text,
      timeout: "dictation",
      schema: Fixed,
    });
    const candidate = fixed.text.trim();
    if (candidate && onlyFixes(text, candidate)) {
      return candidate;
    }
    log.warn("dictation fix rejected", {
      heardWords: words(text),
      fixedWords: words(candidate),
    });
    return text;
  } catch (error) {
    log.warn("dictation fix failed", { error });
    return text;
  }
}

/**
 * Whether the second pass stayed a proofread. A fixed name changes a word or two ("get hub" →
 * GitHub), so a length that moved more than that means it rewrote, summarised or answered.
 */
function onlyFixes(heard: string, fixed: string) {
  const before = words(heard);
  return (
    Math.abs(before - words(fixed)) <= Math.max(2, Math.ceil(before * 0.2))
  );
}

function words(text: string) {
  return text.split(/\s+/u).filter(Boolean).length;
}

function hint(vocabulary: Vocabulary) {
  return `Worklog, GitHub, Slack, ${vocabulary.terms.join(", ")}`.slice(
    0,
    HINT_CHARS
  );
}
