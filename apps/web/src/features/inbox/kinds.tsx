import {
  AlarmIcon,
  ChatCenteredDotsIcon,
  KanbanIcon,
  TrayIcon,
  UserPlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type { Tone } from "#ui/chip";
import { Ghost } from "#ui/ghost";

const KINDS: Record<string, { label: string; icon: ReactNode; tone: Tone }> = {
  "agent.needs_you": {
    label: "Agent needs a decision",
    // The one agent item still waiting on someone, so the one whose ghost moves.
    icon: <Ghost mood="waiting" size={14} tinted />,
    tone: "amber",
  },
  "agent.failed": {
    label: "Agent couldn’t finish",
    icon: <Ghost mood="error" size={14} still tinted />,
    tone: "red",
  },
  "agent.finished": {
    label: "Agent finished",
    icon: <Ghost mood="done" size={14} still tinted />,
    tone: "green",
  },
  "assistant.approval": {
    label: "Approval",
    icon: <ChatCenteredDotsIcon size={13} weight="fill" />,
    tone: "amber",
  },
  "card.assigned": {
    label: "Assigned to you",
    icon: <UserPlusIcon size={13} weight="fill" />,
    tone: "blue",
  },
  "card.activity": {
    label: "Card you follow",
    icon: <KanbanIcon size={13} weight="fill" />,
    tone: "neutral",
  },
  "card.drifting": {
    label: "Drifting",
    icon: <AlarmIcon size={13} weight="fill" />,
    tone: "amber",
  },
  blocking: {
    label: "Someone is blocked on you",
    icon: <WarningCircleIcon size={13} weight="fill" />,
    tone: "red",
  },
  mention: {
    label: "Mentioned you",
    icon: <ChatCenteredDotsIcon size={13} weight="fill" />,
    tone: "blue",
  },
};

export function kindOf(kind: string) {
  return (
    KINDS[kind] ?? {
      label: kind.replaceAll(/[._]/gu, " "),
      icon: <TrayIcon size={13} weight="fill" />,
      tone: "neutral" as Tone,
    }
  );
}
