import type { ToolSet } from "ai";

import { answerAttentionTool } from "./tools/answer-attention";
import { attentionFeedbackTool } from "./tools/attention-feedback";
import { commentOnCardTool } from "./tools/comment-on-card";
import { createCardTool } from "./tools/create-card";
import { followUpTool } from "./tools/follow-up";
import { forgetTool } from "./tools/forget";
import { getCardTool } from "./tools/get-card";
import { leaveNoteTool } from "./tools/leave-note";
import { logWorkTool } from "./tools/log-work";
import { lookIntoTool } from "./tools/look-into";
import { moveCardTool } from "./tools/move-card";
import { myAttentionTool } from "./tools/my-attention";
import { proposeRoutineTool } from "./tools/propose-routine";
import { recallTool } from "./tools/recall";
import { rememberTool } from "./tools/remember";
import { resolveAttentionTool } from "./tools/resolve-attention";
import type { Scope } from "./tools/scope";
import { searchActivityTool } from "./tools/search-activity";
import { searchCardsTool } from "./tools/search-cards";
import { teamDirectoryTool } from "./tools/team-directory";
import { workSnapshotTool } from "./tools/work-snapshot";

export type { Scope } from "./tools/scope";

// One file per tool, each a function of the conversation's scope. The keys here are the names the
// model sees. Write tools exist only in owner mode, except one for teammates: leaving a note for
// the owner. Privacy is enforced by what the tools query, not by the prompt.
export function assistantTools(scope: Scope): ToolSet {
  const lookups = readTools(scope);
  const read = { ...lookups, look_into: lookIntoTool(scope, lookups) };
  if (scope.mode === "teammate") {
    return { ...read, leave_note_for_owner: leaveNoteTool(scope) };
  }
  return {
    ...read,
    answer_attention: answerAttentionTool(scope),
    attention_feedback: attentionFeedbackTool(scope),
    resolve_attention: resolveAttentionTool(scope),
    follow_up: followUpTool(scope),
    propose_routine: proposeRoutineTool(scope),
    remember: rememberTool(scope),
    forget: forgetTool(scope),
    log_work: logWorkTool(scope),
    create_card: createCardTool(scope),
    move_card: moveCardTool(scope),
    comment_on_card: commentOnCardTool(scope),
  };
}

// What a routine can use too: lookups only, scoped like a conversation in the same mode.
export function readTools(scope: Scope) {
  return {
    team_directory: teamDirectoryTool(scope),
    work_snapshot: workSnapshotTool(scope),
    search_activity: searchActivityTool(scope),
    search_cards: searchCardsTool(scope),
    get_card: getCardTool(scope),
    recall: recallTool(scope),
    ...(scope.mode === "owner" ? { my_attention: myAttentionTool(scope) } : {}),
  };
}
