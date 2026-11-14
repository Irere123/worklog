import {
  BracketsCurlyIcon,
  BroadcastIcon,
  MicrophoneIcon,
  NotePencilIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { Ghost } from "#ui/ghost";
import { ProductMark } from "#ui/product-mark";
import { color, media, space, text } from "#ui/tokens.stylex";

import { page, type } from "./styles";

type Source = { name: string; brings: string; mark: ReactNode };

const TOOLS: Source[] = [
  {
    name: "GitHub",
    brings: "Pull requests, reviews, issues",
    mark: <ProductMark product="github" size={22} />,
  },
  {
    name: "GitLab",
    brings: "Merge requests and pipelines",
    mark: <ProductMark product="gitlab" size={22} />,
  },
  {
    name: "Gitea",
    brings: "Your self-hosted repos",
    mark: <ProductMark product="gitea" size={22} />,
  },
  {
    name: "Slack",
    brings: "The threads that decide things",
    mark: <ProductMark product="slack" size={22} />,
  },
  {
    name: "Discord",
    brings: "Channels and threads",
    mark: <ProductMark product="discord" size={22} />,
  },
  {
    name: "Webhooks",
    brings: "Any tool, mapped by rules",
    mark: <WebhooksLogoIcon size={22} />,
  },
];

const PEOPLE: Source[] = [
  {
    name: "Agents",
    brings: "Progress, runs and questions",
    mark: <Ghost size={22} still />,
  },
  {
    name: "Logs",
    brings: "A sentence about what happened",
    mark: <NotePencilIcon size={22} />,
  },
  {
    name: "Voice",
    brings: "Dictated on the phone or laptop",
    mark: <MicrophoneIcon size={22} />,
  },
  {
    name: "REST API",
    brings: "One OpenAPI contract",
    mark: <BracketsCurlyIcon size={22} />,
  },
  {
    name: "Event stream",
    brings: "Resumable, for any client",
    mark: <BroadcastIcon size={22} />,
  },
];

/** Where the record comes from, drifting past in two rows like a ticker. */
export function Sources() {
  return (
    <section aria-labelledby="sources" {...stylex.props(page.section)}>
      <p id="sources" {...stylex.props(page.narrow, type.lede, styles.lede)}>
        Code, chat, agents and a sentence from you.
        <br />
        Every source becomes one line, credited to whoever did it.
      </p>
      <div {...stylex.props(styles.rows)}>
        <Row items={TOOLS} />
        <Row items={PEOPLE} reverse />
      </div>
    </section>
  );
}

function Row({
  items,
  reverse = false,
}: {
  items: Source[];
  reverse?: boolean;
}) {
  return (
    <div {...stylex.props(styles.viewport)}>
      {/* The list twice, so the loop's seam lands on an identical frame. */}
      <ul {...stylex.props(styles.track, reverse && styles.reverse)}>
        {[...items, ...items].map((item, at) => (
          <li
            key={`${item.name}-${at < items.length ? "a" : "b"}`}
            aria-hidden={at >= items.length}
            {...stylex.props(styles.item)}
          >
            <span {...stylex.props(styles.mark)}>{item.mark}</span>
            <span {...stylex.props(styles.name)}>{item.name}</span>
            <span {...stylex.props(styles.brings)}>{item.brings}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const slide = stylex.keyframes({
  from: { transform: "translateX(0)" },
  to: { transform: "translateX(-50%)" },
});

const styles = stylex.create({
  lede: {
    textAlign: "center",
    marginBottom: space.x5,
    color: color.fgMuted,
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    maxWidth: 1104,
    marginInline: "auto",
  },
  viewport: {
    overflow: "hidden",
    maskImage:
      "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
  },
  track: {
    display: "flex",
    gap: space.md,
    width: "max-content",
    margin: 0,
    padding: 0,
    listStyle: "none",
    animationName: slide,
    animationDuration: "48s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    animationPlayState: {
      default: "running",
      ":hover": { default: null, [media.hover]: "paused" },
      "@media (prefers-reduced-motion: reduce)": "paused",
    },
  },
  reverse: {
    animationDirection: "reverse",
    animationDuration: "56s",
  },
  item: {
    display: "flex",
    flexDirection: "column",
    width: 188,
    height: 112,
    padding: space.lg,
    paddingTop: space.lg,
    borderRadius: 16,
    backgroundColor: "light-dark(oklch(0.958 0.004 80), oklch(0.205 0.005 80))",
    color: color.fgMuted,
  },
  mark: {
    display: "flex",
    marginBottom: "auto",
  },
  name: {
    fontSize: text.copy,
    fontWeight: 500,
    color: color.fg,
  },
  brings: {
    fontSize: text.meta,
    lineHeight: "16px",
    color: color.fgMuted,
  },
});
