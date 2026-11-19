import { createRoute, z } from "@hono/zod-openapi";

import { AUDIO_FORMATS, MAX_AUDIO_BYTES, transcribe } from "#agent/transcribe";
import type { AudioType } from "#agent/transcribe";
import { errors, json, respond, router } from "#http/router";
import { ErrorSchema } from "#http/schemas/common";
import { Transcript } from "#http/schemas/transcriptions";
import { readBounded } from "#lib/body";
import { badRequest, tooLarge } from "#lib/errors";

const Audio = { schema: z.string().openapi({ format: "binary" }) };

export const transcriptionRoutes = router().openapi(
  createRoute({
    method: "post",
    path: "/v1/transcriptions",
    operationId: "transcription.create",
    tags: ["Assistant"],
    summary: "Turn dictated speech into text",
    description:
      "The recording is the raw body, typed by its `Content-Type`. The text comes back with the workspace's own names (people, boards, repos, cards) spelled right. 503 when the server has no model; dictate with the browser's own recognition then.",
    request: {
      body: {
        required: true,
        content: Object.fromEntries(
          Object.keys(AUDIO_FORMATS).map((type) => [type, Audio])
        ),
      },
    },
    responses: {
      200: json(Transcript),
      ...errors,
      413: json(ErrorSchema, "Recording too long"),
      503: json(ErrorSchema, "No model on this server"),
    },
  }),
  async (c) => {
    const type = audioType(c.req.header("content-type"));
    const bytes = await readBounded(c.req.raw, MAX_AUDIO_BYTES);
    if (bytes === null) {
      throw tooLong();
    }
    if (bytes.byteLength === 0) {
      throw badRequest("The recording is empty");
    }
    return respond(
      c,
      Transcript,
      await transcribe(
        c.get("ctx"),
        c.get("member"),
        { bytes, type },
        c.req.raw.signal
      ),
      200
    );
  }
);

function audioType(header: string | undefined) {
  const type = header?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!(type in AUDIO_FORMATS)) {
    throw badRequest(
      `Send the recording as one of ${Object.keys(AUDIO_FORMATS).join(", ")}`
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked against AUDIO_FORMATS' keys on the line above
  return type as AudioType;
}

function tooLong() {
  return tooLarge("That recording is too long to transcribe");
}
