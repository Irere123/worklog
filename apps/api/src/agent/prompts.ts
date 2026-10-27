import type { Visibility } from "#db/schema";

import brief from "./prompts/brief.md" with { type: "text" };
import check from "./prompts/check.md" with { type: "text" };
import compaction from "./prompts/compaction.md" with { type: "text" };
import consolidate from "./prompts/consolidate.md" with { type: "text" };
import constitution from "./prompts/constitution.md" with { type: "text" };
import conversation from "./prompts/conversation.md" with { type: "text" };
import custom from "./prompts/custom.md" with { type: "text" };
import log from "./prompts/log.md" with { type: "text" };
import memoryPage from "./prompts/memory-page.md" with { type: "text" };
import owner from "./prompts/owner.md" with { type: "text" };
import reconcile from "./prompts/reconcile.md" with { type: "text" };
import teammate from "./prompts/teammate.md" with { type: "text" };
import untrusted from "./prompts/untrusted.md" with { type: "text" };

// Every prompt the assistant speaks with lives in this folder as Markdown, so what it is told can
// be read and diffed without reading code. Placeholders are `{{name}}`; a missing one throws, so a
// renamed placeholder fails the first time it runs rather than reaching the model as braces.
const PROMPTS = {
  brief,
  check,
  compaction,
  consolidate,
  conversation,
  custom,
  log,
  "memory-page": memoryPage,
  owner,
  reconcile,
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

// Who the assistant is, the same for every owner and for everything it writes: conversations,
// briefs and automations. Only a reviewed commit changes it: no tool writes it, so nothing planted
// in ingested text can rewrite it.
export const CONSTITUTION = constitution.trim();

export const UNTRUSTED_NOTE = untrusted.trim();

// For what is delivered rather than said in a conversation. The data behind a team version is
// already team-visible only; this tells the model why, so it doesn't hint at what was left out.
export function audienceNote(visibility: Visibility, name: string) {
  return visibility === "private"
    ? `Only ${name} reads this.`
    : `Others might read this too, so it is built only from what ${name}'s team can see. Don't hint at anything beyond it.`;
}
