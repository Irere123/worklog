import { useQuery } from "@tanstack/react-query";

import { q } from "#api/queries";
import { clip } from "#lib/text";

const FALLBACK = [
  "What changed while I was away?",
  "What’s blocked right now?",
  "Draft my standup",
];

/**
 * First questions built from what's in front of the person right now: what's waiting on them,
 * the card they're on, a decision an agent needs. Generic ones fill in when there's little to go
 * on, so a new workspace still gets three.
 */
/** What a suggestion shows, and the full question it sends. */
export type Suggestion = { label: string; ask: string };

const plain = (question: string): Suggestion => ({
  label: question,
  ask: question,
});

export function useSuggestions(): Suggestion[] {
  const open = useQuery(q.attention("open"));
  const mine = useQuery(q.cards({ assignee: "me", stage: "active" }));
  const picked: Suggestion[] = [];
  const waiting = open.data ?? [];
  const decision = waiting.find((item) => item.kind === "agent.needs_you");
  if (decision) {
    const about = decision.title.replace(/^[^:]+ needs you:\s*/u, "");
    // The chip shows a short line; the question carries the whole request.
    picked.push({
      label: `Help me decide: ${clip(about, 48)}`,
      ask: `Help me decide: ${about} What are the trade-offs, and what would you do?`,
    });
  } else if (waiting.length > 0) {
    picked.push({
      label: `What needs me today? (${waiting.length} waiting)`,
      ask: "What needs me today?",
    });
  }
  const [current] = mine.data ?? [];
  if (current) {
    picked.push(plain(`Where does #${current.number} stand, and what’s next?`));
  }
  for (const question of FALLBACK) {
    if (picked.length < 3) {
      picked.push(plain(question));
    }
  }
  return picked.slice(0, 3);
}
