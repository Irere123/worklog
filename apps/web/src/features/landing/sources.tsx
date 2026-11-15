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
    mark: <ProductMark product="github" size={20} />,
  },
  {
    name: "GitLab",
    brings: "Merge requests and pipelines",
    mark: <ProductMark product="gitlab" size={20} />,
  },
  {
    name: "Gitea",
    brings: "Your self-hosted repos",
    mark: <ProductMark product="gitea" size={24} />,
  },
  {
    name: "Slack",
    brings: "The threads that decide things",
    mark: <ProductMark product="slack" size={20} />,
  },
  {
    name: "Discord",
    brings: "Channels and threads",
    mark: <ProductMark product="discord" size={20} />,
  },
  {
    name: "Webhooks",
    brings: "Any tool, mapped by rules",
    mark: <WebhooksLogoIcon size={20} />,
  },
];

const PEOPLE: Source[] = [
  {
    name: "Agents",
    brings: "Progress, runs and questions",
    mark: <Ghost size={20} still />,
  },
  {
    name: "Logs",
    brings: "A sentence about what happened",
    mark: <NotePencilIcon size={20} />,
  },
  {
    name: "Voice",
    brings: "Dictated on the phone or laptop",
    mark: <MicrophoneIcon size={20} />,
  },
  {
    name: "REST API",
    brings: "One OpenAPI contract",
    mark: <BracketsCurlyIcon size={20} />,
  },
  {
    name: "Event stream",
    brings: "Resumable, for any client",
    mark: <BroadcastIcon size={20} />,
  },
];

/** Where the record comes from, drifting past in two rows like a ticker. */
export function Sources() {
  return (
    <section
      aria-labelledby="sources"
      {...stylex.props(page.wide, page.section)}
    >
      <p id="sources" {...stylex.props(type.lede, styles.lede)}>
        Code, chat, agents and a sentence from you. Every source becomes one
        line, credited to whoever did it.
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
  // Half the doubled list plus half a gap, so the seam lands exactly on the copy.
  to: { transform: `translateX(calc(-50% - ${space.lg} / 2))` },
});

const styles = stylex.create({
  lede: {
    marginInline: "auto",
    marginBottom: space.x4,
    textAlign: "center",
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
  },
  viewport: {
    overflow: "hidden",
    maskImage:
      "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
  },
  track: {
    display: "flex",
    gap: space.lg,
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
    width: 176,
    height: 112,
    padding: 14,
    borderRadius: 12,
    backgroundColor: {
      default: "oklch(0.2 0.01 80 / 0.035)",
      ":hover": {
        default: null,
        [media.hover]: "oklch(0.2 0.01 80 / 0.06)",
      },
    },
    color: color.fgMuted,
    transitionProperty: "background-color",
    transitionDuration: "200ms",
  },
  // Every name sits the same step under its mark, however its line below wraps. The box is a
  // fixed 24px, so a mark drawn larger to match its neighbours' weight doesn't push its name down.
  mark: {
    display: "flex",
    alignItems: "center",
    height: 24,
    marginBottom: 12,
  },
  name: {
    fontSize: 14,
    fontWeight: 500,
    color: color.fg,
  },
  brings: {
    fontSize: text.meta,
    lineHeight: "16px",
    color: color.fgMuted,
  },
});
