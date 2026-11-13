import {
  AlarmIcon,
  ChatCenteredDotsIcon,
  KanbanIcon,
  RobotIcon,
  TrayIcon,
  UserPlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type { Tone } from "#ui/chip";

const KINDS: Record<string, { label: string; icon: ReactNode; tone: Tone }> = {
  "agent.needs_you": {
    label: "Agent needs a decision",
    icon: <RobotIcon size={13} weight="fill" />,
    tone: "amber",
  },
  "agent.failed": {
    label: "Agent couldn’t finish",
    icon: <RobotIcon size={13} weight="fill" />,
    tone: "red",
  },
  "agent.finished": {
    label: "Agent finished",
    icon: <RobotIcon size={13} weight="fill" />,
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
