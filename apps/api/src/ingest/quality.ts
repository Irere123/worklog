import type { WorklogEvent } from "./types";

/**
 * Connector-agnostic quality rules. Connectors drop what's obviously not work (stars, label edits,
 * "ok 👍"); these rules apply the workspace's policy on top, so every source behaves the same way.
 */

/** How much each kind of event matters in briefs and summaries (0..1), unless the connector says otherwise. */
const BASE_IMPORTANCE: Record<string, number> = {
  "release.published": 0.9,
  "log.blocker": 0.9,
  "deploy.failed": 0.85,
  "pr.merged": 0.8,
  "log.decision": 0.8,
  "agent.needs_you": 0.8,
  "pr.opened": 0.6,
  "review.submitted": 0.55,
  "issue.closed": 0.55,
  "deploy.succeeded": 0.55,
  "issue.opened": 0.45,
  "pr.closed": 0.4,
  "review.requested": 0.35,
  "comment.created": 0.3,
  "code.pushed": 0.3,
  "message.posted": 0.25,
};

/** Bots (dependabot, renovate, CI) are kept only for these, and at low importance. */
const BOT_KINDS_KEPT = new Set([
  "pr.opened",
  "pr.merged",
  "release.published",
  "deploy.succeeded",
  "deploy.failed",
]);

export type QualitySettings = {
  /** "quiet" (default): keep only a bot's PRs/releases/deploys, at low importance. "drop": ignore bots. "keep": treat bots like people. */
  bots?: "quiet" | "drop" | "keep";
  /** Event kinds this connection should never record (e.g. ["code.pushed"]). */
  ignoreKinds?: string[];
};

export type Gate =
  | { keep: true; importance: number }
  | { keep: false; reason: string };

export function gate(
  event: WorklogEvent,
  isBot: boolean,
  settings: QualitySettings
): Gate {
  if ((settings.ignoreKinds ?? []).includes(event.kind)) {
    return {
      keep: false,
      reason: `kind ${event.kind} is ignored for this connection`,
    };
  }
  let importance = event.importance ?? BASE_IMPORTANCE[event.kind] ?? 0.4;
  if (isBot) {
    const policy = settings.bots ?? "quiet";
    if (policy === "drop") {
      return {
        keep: false,
        reason: "bot activity is ignored for this connection",
      };
    }
    if (policy === "quiet") {
      if (!BOT_KINDS_KEPT.has(event.kind)) {
        return {
          keep: false,
          reason: `bot ${event.kind} (only bot PRs, releases and deploys are kept)`,
        };
      }
      importance *= 0.3;
    }
  }
  return { keep: true, importance: Math.max(0, Math.min(1, importance)) };
}
