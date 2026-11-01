import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { VisuallyHidden } from "./feedback";
import { color, font } from "./tokens.stylex";

type Person = {
  id: string;
  name: string;
  kind?: string;
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
 * People are circles and agents are rounded squares with a face of their own, so a glance at any
 * list tells who is human: agents never pass as people, even with a picture.
 */
export function Avatar({
  person,
  size = 20,
  ring = false,
  labelled = false,
}: {
  person: Person | null | undefined;
  size?: number;
  ring?: boolean;
  /**
   * Speak the name to screen readers. Off by default: almost everywhere the name is printed
   * beside the avatar, and hearing it twice is noise.
   */
  labelled?: boolean;
}) {
  // A dead link (a revoked GitHub avatar, an expired Slack URL) falls back to initials.
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
  return (
    <span
      title={person.name}
      aria-hidden={!labelled}
      {...stylex.props(
        styles.base,
        styles.size(size),
        picture ? styles.photoGround : styles.tint(hueOf(person.id)),
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
        <Mark agent={agent} name={person.name} size={size} seed={person.id} />
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
  name,
  size,
  seed,
}: {
  agent: boolean;
  name: string;
  size: number;
  seed: string;
}) {
  return agent ? (
    <AgentFace seed={seed} size={Math.round(size * 0.86)} />
  ) : (
    <span aria-hidden>{initials(name)}</span>
  );
}

// Six agents in one list all wearing the same robot icon read as one thing; a face drawn from
// the agent's id keeps each one recognisable at 16px, the way a person's picture does.
const EYES = [
  <g key="dots">
    <circle cx="8.3" cy="10.8" r="2.3" />
    <circle cx="15.7" cy="10.8" r="2.3" />
  </g>,
  <g key="pills">
    <rect x="6.8" y="7.6" width="3.2" height="6.4" rx="1.6" />
    <rect x="14" y="7.6" width="3.2" height="6.4" rx="1.6" />
  </g>,
  <rect key="visor" x="5" y="8.6" width="14" height="4.6" rx="2.3" />,
  <g key="happy" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M5.9 11.8q2.4-3.2 4.8 0" />
    <path d="M13.3 11.8q2.4-3.2 4.8 0" />
  </g>,
  <g key="wink">
    <circle cx="8.3" cy="10.8" r="2.3" />
    <path
      d="M13.4 10.8h4.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    />
  </g>,
  <g key="square">
    <rect x="6.2" y="8.6" width="4.4" height="4.4" rx="1" />
    <rect x="13.4" y="8.6" width="4.4" height="4.4" rx="1" />
  </g>,
];
const MOUTHS = [
  <path key="line" d="M9.2 17h5.6" />,
  <path key="smile" d="M8.6 16q3.4 3 6.8 0" />,
  <circle key="o" cx="12" cy="17" r="1.6" />,
  <rect key="teeth" x="8.6" y="15.6" width="6.8" height="3" rx="1" />,
];

function AgentFace({ seed, size }: { seed: string; size: number }) {
  // A second hash, so the face doesn't follow the tint: two green agents still differ.
  let hash = 7;
  for (const char of seed) {
    hash = (hash * 131 + (char.codePointAt(0) ?? 0)) % 9973;
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      strokeLinecap="round"
    >
      {EYES[hash % EYES.length]}
      <g fill="none" stroke="currentColor" strokeWidth="2.2">
        {MOUTHS[Math.floor(hash / EYES.length) % MOUTHS.length]}
      </g>
    </svg>
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
  // An inset hairline keeps a pale photo from melting into the page behind it.
  picture: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: "inherit",
    outline: `1px solid ${color.line}`,
    outlineOffset: -1,
  },
  // While a picture loads, a neutral ground rather than a colored disc that flashes away.
  photoGround: { backgroundColor: color.ui },
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
