import { z } from "zod";

import type { Payload } from "./events";

const VERDICTS = new Map([
  ["pull_request_approved", "approved"],
  ["pull_request_review_approved", "approved"],
  ["pull_request_rejected", "changes_requested"],
  ["pull_request_review_rejected", "changes_requested"],
  ["pull_request_comment", "commented"],
  ["pull_request_review_comment", "commented"],
]);

const User = z.object({
  id: z.number().optional(),
  login: z.string(),
  avatar_url: z.string().optional(),
});

const Reviewed = z.object({
  action: z.literal("reviewed"),
  sender: User,
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    html_url: z.string(),
    user: User,
    updated_at: z.string().optional(),
  }),
  review: z.object({
    type: z.string().optional(),
    content: z.string().nullish(),
  }),
});

/**
 * A Gitea or Forgejo review webhook in GitHub's shape, so the shared mapping records it: the
 * verdict, the author told, the reviewer's request resolved. Null for anything else, including
 * GitHub-style inline comments, which carry a `comment`.
 */
export function asGithubReview(eventType: string, payload: unknown) {
  const state = VERDICTS.get(eventType);
  if (!state) {
    return null;
  }
  const parsed = Reviewed.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  const { sender, pull_request: pr, review } = parsed.data;
  const at = pr.updated_at;
  return {
    action: "submitted",
    sender,
    pull_request: pr,
    review: {
      id: `${pr.number}:${sender.id ?? sender.login}:${at ?? ""}`,
      state,
      body: review.content ?? null,
      html_url: pr.html_url,
      user: sender,
      submitted_at: at,
    },
  } satisfies Payload;
}
