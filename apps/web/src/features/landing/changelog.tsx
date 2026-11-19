import * as stylex from "@stylexjs/stylex";

import { color, space } from "#ui/tokens.stylex";

import { PageHead } from "./intro";
import { SOURCE } from "./links";
import { Site } from "./site";
import { links, page, type } from "./styles";

type Entry = { date: string; title: string; body: string };

const ENTRIES: Entry[] = [
  {
    date: "2026-11-19",
    title: "Invite links and profile pictures",
    body: "Send an invite link that works with any account, and upload your own picture. The sidebar resizes to the width you like.",
  },
  {
    date: "2026-11-16",
    title: "Coding agents on the board",
    body: "Claude Code, Codex and other agents connect themselves, show on the cards they’re working on, and ask you when they need a decision.",
  },
  {
    date: "2026-11-15",
    title: "Open source",
    body: "Worklog is AGPL-3.0, and anyone can start a workspace.",
  },
  {
    date: "2026-11-14",
    title: "An assistant you can read at a glance",
    body: "Its face shows whether it’s thinking, writing or done, and dictation spells your team’s names right.",
  },
  {
    date: "2026-11-10",
    title: "People and their hours",
    body: "See each teammate’s working hours and how their weeks have gone.",
  },
  {
    date: "2026-11-03",
    title: "Sign in with email",
    body: "Sign in with a link sent to your inbox, or with GitHub or Discord.",
  },
  {
    date: "2026-11-02",
    title: "At home on a phone",
    body: "Every screen works on a phone, and pages load faster.",
  },
  {
    date: "2026-11-01",
    title: "The web app",
    body: "Home, inbox, boards, activity, briefs, people and your assistant, in one app.",
  },
  {
    date: "2026-10-28",
    title: "Connectors in a click",
    body: "GitHub, Gitea, Slack and Discord install as apps and bring their recent history with them.",
  },
  {
    date: "2026-10-27",
    title: "An assistant with a constitution",
    body: "Every assistant follows written rules and its owner’s voice, and remembers where each memory came from.",
  },
];

const DAY = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** What shipped and when, written for the people using it rather than from the commit log. */
export function Changelog() {
  return (
    <Site>
      <PageHead
        title="What’s new"
        lede={
          <>
            What shipped, and why it matters. Every change is also on{" "}
            <a href={`${SOURCE}/commits/main`} {...stylex.props(links.inline)}>
              GitHub
            </a>
            .
          </>
        }
      />
      <ol {...stylex.props(page.narrow, styles.entries)}>
        {ENTRIES.map((entry) => (
          <li key={entry.date} {...stylex.props(styles.entry)}>
            <time dateTime={entry.date} {...stylex.props(styles.date)}>
              {DAY.format(new Date(`${entry.date}T00:00:00Z`))}
            </time>
            <div {...stylex.props(styles.body)}>
              <h2 {...stylex.props(type.tileTitle, styles.title)}>
                {entry.title}
              </h2>
              <p {...stylex.props(styles.text)}>{entry.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Site>
  );
}

const styles = stylex.create({
  entries: {
    display: "flex",
    flexDirection: "column",
    maxWidth: 760,
    margin: 0,
    marginInline: "auto",
    listStyle: "none",
  },
  entry: {
    display: "grid",
    gridTemplateColumns: {
      default: "140px minmax(0, 1fr)",
      "@media (max-width: 640px)": "1fr",
    },
    gap: {
      default: space.x3,
      "@media (max-width: 640px)": space.sm,
    },
    paddingBlock: space.x4,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  date: {
    paddingTop: 2,
    fontSize: 13,
    lineHeight: "20px",
    color: color.fgMuted,
    fontVariantNumeric: "tabular-nums",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
  },
  title: {
    fontSize: 18,
  },
  text: {
    margin: 0,
    fontSize: 15,
    lineHeight: "24px",
    color: color.fgMuted,
    textWrap: "pretty",
  },
});
