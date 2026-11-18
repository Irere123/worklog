import type { Visibility } from "#db/schema";

import brief from "./prompts/brief.md" with { type: "text" };
import check from "./prompts/check.md" with { type: "text" };
import compaction from "./prompts/compaction.md" with { type: "text" };
import consolidate from "./prompts/consolidate.md" with { type: "text" };
import constitution from "./prompts/constitution.md" with { type: "text" };
import conversation from "./prompts/conversation.md" with { type: "text" };
import custom from "./prompts/custom.md" with { type: "text" };
import dictation from "./prompts/dictation.md" with { type: "text" };
import helper from "./prompts/helper.md" with { type: "text" };
import learn from "./prompts/learn.md" with { type: "text" };
import log from "./prompts/log.md" with { type: "text" };
import memoryPage from "./prompts/memory-page.md" with { type: "text" };
import owner from "./prompts/owner.md" with { type: "text" };
import reconcile from "./prompts/reconcile.md" with { type: "text" };
import review from "./prompts/review.md" with { type: "text" };
import teammate from "./prompts/teammate.md" with { type: "text" };
import untrusted from "./prompts/untrusted.md" with { type: "text" };

const PROMPTS = {
  brief,
  check,
  compaction,
  consolidate,
  conversation,
  custom,
  dictation,
  helper,
  learn,
  log,
  "memory-page": memoryPage,
  owner,
  reconcile,
  review,
  teammate,
} as const;

export type PromptName = keyof typeof PROMPTS;

export function prompt(name: PromptName, vars: Record<string, string> = {}) {
  return PROMPTS[name]
    .trim()
    .replaceAll(/\{\{(?<key>\w+)\}\}/gu, (_, key: string) => {
      const value = vars[key];
      if (value === undefined) {
        throw new Error(`Prompt "${name}" needs {{${key}}}`);
      }
      return value;
    });
}

export const CONSTITUTION = constitution.trim();

export const UNTRUSTED_NOTE = untrusted.trim();

export function audienceNote(visibility: Visibility, name: string) {
  return visibility === "private"
    ? `Only ${name} reads this.`
    : `Others might read this too, so it is built only from what ${name}'s team can see. Don't hint at anything beyond it.`;
}
