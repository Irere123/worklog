import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { PromptMark, toolOf } from "./agent-mark";
import { VisuallyHidden } from "./feedback";
import { Ghost } from "./ghost";
import type { Mood } from "./ghost";
import { ProductMark } from "./product-mark";
import { color, font } from "./tokens.stylex";

type Person = {
  id: string;
  name: string;
  kind?: string;
  agentProvider?: string | null;
  avatarUrl?: string | null;
};

export function hueOf(id: string) {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }
  return hash;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/u);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * People are circles and agents are rounded squares, so a glance at any list tells who is human:
 * agents never pass as people, even with a picture. Your own assistant wears the ghost it has
 * everywhere else; a coding agent wears its tool's mark as published, so you see what it runs on.
 * Our own drawings (the ghost, the prompt) hold still unless `live`: only a run still in play
 * moves, so finished work stays quiet.
 */
export function Avatar({
  person,
  size = 20,
  ring = false,
  labelled = false,
  mood,
  live = false,
}: {
  person: Person | null | undefined;
  size?: number;
  ring?: boolean;
  /** How an agent is doing, shown on its face; ignored for people. */
  mood?: Mood;
  /** Lets an agent's face move: for a run still in play, or the agent's own page. */
  live?: boolean;
  /**
   * Speak the name to screen readers. Off by default: almost everywhere the name is printed
   * beside the avatar, and hearing it twice is noise.
   */
  labelled?: boolean;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!person) {
    return (
      <span
        aria-hidden
        {...stylex.props(styles.base, styles.empty, styles.size(size))}
      />
    );
  }
  const agent = person.kind === "agent";
  const picture =
    person.avatarUrl && person.avatarUrl !== broken ? person.avatarUrl : null;
  const neutral =
    picture !== null || (agent && toolOf(person.agentProvider) !== undefined);
  return (
    <span
      title={person.name}
      aria-hidden={!labelled}
      {...stylex.props(
        styles.base,
        styles.size(size),
        neutral ? styles.neutralGround : styles.tint(hueOf(person.id)),
        agent ? styles.agent : styles.human,
        ring && styles.ring
      )}
    >
      {picture ? (
        <img
          src={picture}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(picture)}
          {...stylex.props(styles.picture)}
        />
      ) : (
        <Mark
          agent={agent}
          provider={person.agentProvider}
          name={person.name}
          size={size}
          mood={mood}
          live={live}
        />
      )}
      {labelled && (
        <VisuallyHidden>
          {agent ? `${person.name} (agent)` : person.name}
        </VisuallyHidden>
      )}
    </span>
  );
}

export function AvatarStack({
  people,
  size = 20,
  max = 3,
}: {
  people: Person[];
  size?: number;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span {...stylex.props(styles.stack)}>
      {shown.map((p) => (
        <span key={p.id} {...stylex.props(styles.stacked)}>
          <Avatar person={p} size={size} ring labelled />
        </span>
      ))}
      {extra > 0 && (
        <span {...stylex.props(styles.more, styles.size(size))}>+{extra}</span>
      )}
    </span>
  );
}

function Mark({
  agent,
  provider,
  name,
  size,
  mood,
  live,
}: {
  agent: boolean;
  provider: string | null | undefined;
  name: string;
  size: number;
  mood: Mood | undefined;
  live: boolean;
}) {
  if (!agent) {
    return <span aria-hidden>{initials(name)}</span>;
  }
  if (provider === "worklog") {
    return (
      <Ghost mood={mood} size={Math.round(size * 0.78)} still={!live} tinted />
    );
  }
  const tool = toolOf(provider);
  if (tool !== undefined) {
    return <ProductMark product={tool} size={Math.round(size * 0.72)} />;
  }
  return (
    <PromptMark size={Math.round(size * 0.66)} mood={mood} still={!live} />
  );
}

const styles = stylex.create({
  base: {
    display: "inline-grid",
    placeItems: "center",
    flexShrink: 0,
    fontFamily: font.sans,
    fontWeight: 600,
    letterSpacing: "0.01em",
    userSelect: "none",
    overflow: "hidden",
  },
  size: (size: number) => ({
    width: size,
    height: size,
    fontSize: Math.max(8, Math.round(size * 0.4)),
  }),
  tint: (hue: number) => ({
    color: `light-dark(oklch(0.38 0.09 ${hue}), oklch(0.9 0.06 ${hue}))`,
    backgroundColor: `light-dark(oklch(0.9 0.05 ${hue}), oklch(0.36 0.07 ${hue}))`,
  }),
  picture: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: "inherit",
    outline: `1px solid ${color.line}`,
    outlineOffset: -1,
  },
  neutralGround: { backgroundColor: color.ui },
  human: { borderRadius: "50%" },
  agent: { borderRadius: "28%" },
  empty: {
    borderRadius: "50%",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.lineStrong,
  },
  ring: { boxShadow: `0 0 0 2px ${color.bg}` },
  stack: { display: "inline-flex", alignItems: "center" },
  stacked: { marginInlineStart: { default: -4, ":first-child": 0 } },
  more: {
    display: "inline-grid",
    placeItems: "center",
    marginInlineStart: -4,
    borderRadius: "50%",
    fontWeight: 600,
    color: color.fgMuted,
    backgroundColor: color.uiActive,
    boxShadow: `0 0 0 2px ${color.bg}`,
  },
});
