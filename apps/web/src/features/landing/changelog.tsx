import * as stylex from "@stylexjs/stylex";

import { color, space } from "#ui/tokens.stylex";

import { PageHead } from "./intro";
import { SOURCE } from "./links";
import { Site } from "./site";
import { links, page, type } from "./styles";

type Entry = { date: string; title: string; body: string; tags: string[] };

// Written from the repository's history, newest first. One entry per day something shipped.
const ENTRIES: Entry[] = [
  {
    date: "2026-11-15",
    title: "Open source, and open to every team",
    body: "Worklog is now licensed under the AGPL-3.0. Anyone can sign in and start a workspace, and a team’s own server can stay invite-only with SIGNUP=closed. The front page, pricing and these notes are new.",
    tags: ["Open source", "Sign-up"],
  },
  {
    date: "2026-11-14",
    title: "An assistant you can read at a glance",
    body: "The assistant’s ghost shows what it’s doing, thinking, writing or done, and agents show their state the same way. Dictation now spells your team’s names right, because it’s transcribed with the workspace’s names in mind.",
    tags: ["Assistant", "Voice"],
  },
  {
    date: "2026-11-13",
    title: "Real logos for connected tools",
    body: "GitHub, Slack, GitLab and the rest appear in their own colours wherever they’re named, and status badges carry a filled glyph of their own shape.",
    tags: ["Design"],
  },
  {
    date: "2026-11-10",
    title: "People, with their working hours",
    body: "A roster shows each teammate’s working hours and a square for every day of activity. The sidebar is grouped by whose things are whose, and Worklog has a hand-drawn mark.",
    tags: ["People", "Design"],
  },
  {
    date: "2026-11-09",
    title: "See what the assistant is doing",
    body: "The assistant reports each step as it works, and its memory is grounded in evidence it can point to. Who’s online now arrives as whole snapshots over the event stream.",
    tags: ["Assistant", "Live"],
  },
  {
    date: "2026-11-03",
    title: "Email-first sign-in",
    body: "Sign in with a link sent to your email, or with GitHub or Discord. Servers gained health checks, a separate migrate step and a graceful shutdown, and can trace requests, jobs and model calls to Tinybird.",
    tags: ["Sign-in", "Self-hosting"],
  },
  {
    date: "2026-11-02",
    title: "Faster, and at home on a phone",
    body: "Pages load faster, responses are compressed, every screen has a phone layout, and the assistant’s replies say more about what they found.",
    tags: ["Performance", "Phone"],
  },
  {
    date: "2026-11-01",
    title: "The web app",
    body: "Home, inbox, board, activity, the assistant, briefs, people and settings, in one app. GitLab joins the connectors, and bun run seed fills an empty server with a demo team.",
    tags: ["Web app", "Connectors"],
  },
  {
    date: "2026-10-28",
    title: "Connectors that install in a click",
    body: "GitHub, Gitea, Slack and Discord install as apps and bring their recent history. Events flow through ingestion lanes, and scheduled routines run as jobs on any worker.",
    tags: ["Connectors"],
  },
  {
    date: "2026-10-27",
    title: "An assistant with a constitution",
    body: "Every assistant follows a written constitution and its owner’s voice. Each memory keeps where it came from, memory exports as Markdown, and long conversations are compacted so they start from what matters.",
    tags: ["Assistant", "Memory"],
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
              <ul {...stylex.props(styles.tags)}>
                {entry.tags.map((tag) => (
                  <li key={tag} {...stylex.props(type.chip)}>
                    {tag}
                  </li>
                ))}
              </ul>
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
  // A date in the margin and the note beside it, ruled off from the next, like a dated log.
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
  tags: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.sm,
    margin: 0,
    marginTop: space.xs,
    padding: 0,
    listStyle: "none",
  },
});
