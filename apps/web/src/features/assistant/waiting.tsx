import { HourglassMediumIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import { q } from "#api/queries";
import { clip } from "#lib/text";
import { Section } from "#ui/layout";
import { color, leading, radius, space, text } from "#ui/tokens.stylex";

import { AllowDeny, useAnswerApproval } from "./approvals";

const APPROVAL = "assistant.approval";
const ASKING = /^Your assistant wants to /u;

/**
 * What the assistant holds for the owner's OK, on its own page as well as in the inbox: handing
 * work off means saying yes where the work is, not going to find it.
 */
export function WaitingOnYou() {
  const open = useQuery(q.attention("open"));
  const answer = useAnswerApproval();
  const items = (open.data ?? []).filter((item) => item.kind === APPROVAL);
  if (items.length === 0) {
    return null;
  }
  return (
    <Section title="Waiting on you">
      <ul {...stylex.props(styles.list)}>
        {items.map((item) => (
          <li key={item.id} {...stylex.props(styles.row)}>
            <HourglassMediumIcon size={15} {...stylex.props(styles.icon)} />
            <div {...stylex.props(styles.main)}>
              <p {...stylex.props(styles.ask)}>{askOf(item.title)}</p>
              {item.body && (
                <p {...stylex.props(styles.why)}>{clip(item.body, 160)}</p>
              )}
            </div>
            <span {...stylex.props(styles.actions)}>
              <AllowDeny
                onAnswer={(a) => answer.mutate({ id: item.id, answer: a })}
              />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function askOf(title: string) {
  const ask = title.replace(ASKING, "");
  return ask === title
    ? title
    : `${ask.charAt(0).toUpperCase()}${ask.slice(1)}`;
}

const styles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: color.amberSubtle,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.lg,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  icon: { flexShrink: 0, color: color.amberFg },
  main: {
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
    flexGrow: 1,
    minWidth: 0,
  },
  ask: {
    margin: 0,
    fontSize: text.label,
    lineHeight: leading.label,
    fontWeight: 500,
    color: color.fg,
  },
  why: {
    margin: 0,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgMuted,
  },
  actions: {
    display: "inline-flex",
    gap: space.xs,
    flexShrink: 0,
  },
});
