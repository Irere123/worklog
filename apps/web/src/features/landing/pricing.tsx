import { CheckCircleIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";

import { color, media, motion, radius, shadow, space } from "#ui/tokens.stylex";

import { Questions } from "./faq";
import { DEPLOY, SOURCE } from "./links";
import { AI, OPEN, PRICING } from "./questions";
import type { Question } from "./questions";
import { Site } from "./site";
import { useStart } from "./start";
import { cta, page, type } from "./styles";

type Plan = {
  name: string;
  price: string;
  per: string;
  pitch: string;
  action: string;
  includes: string[];
  lead: boolean;
};

const FREE: Plan = {
  name: "Free",
  price: "$0",
  per: "per month",
  pitch: "Worklog Cloud for a small team finding its rhythm.",
  action: "Start free",
  includes: [
    "Up to 3 people",
    "Board, inbox, activity and briefs",
    "2 connected tools",
    "90 days of history",
  ],
  lead: false,
};

const TEAM: Plan = {
  name: "Team",
  price: "$49",
  per: "per month, for the whole team",
  pitch: "One price however many people join, with AI included.",
  action: "Start with Team",
  includes: [
    "Everything in Free",
    "Any number of people",
    "Every connector",
    "Your whole history",
    "The assistant and written briefs, no key needed",
    "Priority email support",
  ],
  lead: true,
};

const SELF: Plan = {
  name: "Self-hosted",
  price: "Free",
  per: "forever, under the AGPL-3.0",
  pitch: "The same code on your own server, with every feature.",
  action: "Read the deploy guide",
  includes: [
    "Every feature, no limits",
    "Your Postgres, your data",
    "Docker Compose or Railway",
    "AI with your own OpenRouter key",
  ],
  lead: false,
};

const BEFORE: Question[] = [...PRICING, OPEN[1], AI[1]].filter(
  (each) => each !== undefined
);

/**
 * What Worklog costs, laid out as resurf lays out its license: the plans side by side, the fine
 * print under them, and the questions people ask before choosing right beside the answer.
 */
export function Pricing() {
  const start = useStart();
  return (
    <Site>
      <header {...stylex.props(page.wide, styles.head)}>
        <h1 {...stylex.props(type.display)}>Free to start. Yours to run.</h1>
        <p {...stylex.props(type.lede)}>
          Worklog Cloud is free for a team of three. The same open-source code
          runs on your own server, free, with every feature.
        </p>
      </header>

      <div {...stylex.props(page.wide, styles.plans)}>
        <PlanCard plan={FREE} to={start} />
        <PlanCard plan={TEAM} to={start} />
        <PlanCard plan={SELF} href={DEPLOY} />
      </div>
      <ul {...stylex.props(page.wide, styles.fine)}>
        <li>Prices in USD</li>
        <li aria-hidden {...stylex.props(styles.sep)}>
          ·
        </li>
        <li>No card to start</li>
        <li aria-hidden {...stylex.props(styles.sep)}>
          ·
        </li>
        <li>Self-hosting has every feature</li>
      </ul>

      <section {...stylex.props(page.narrow, page.section, styles.before)}>
        <h2 {...stylex.props(type.heading, styles.beforeTitle)}>
          Before you choose
        </h2>
        <div {...stylex.props(styles.beforeList)}>
          <Questions items={BEFORE} />
          <p {...stylex.props(styles.help)}>
            Something else? Read the{" "}
            <Link to="/faq" {...stylex.props(styles.helpLink)}>
              FAQ
            </Link>
            , or{" "}
            <a href={`${SOURCE}/issues`} {...stylex.props(styles.helpLink)}>
              ask on GitHub
            </a>
            .
          </p>
        </div>
      </section>
    </Site>
  );
}

function PlanCard({
  plan,
  to,
  href,
}: {
  plan: Plan;
  to?: string;
  href?: string;
}) {
  const button = stylex.props(
    cta.base,
    plan.lead ? cta.primary : styles.outline,
    styles.action
  );
  return (
    <article {...stylex.props(styles.plan, plan.lead && styles.lead)}>
      <h2 {...stylex.props(styles.name)}>{plan.name}</h2>
      <p {...stylex.props(styles.price)}>
        <span {...stylex.props(styles.amount)}>{plan.price}</span>
        <span {...stylex.props(styles.per)}>{plan.per}</span>
      </p>
      <p {...stylex.props(styles.pitch)}>{plan.pitch}</p>
      {to === undefined ? (
        <a href={href} {...button}>
          {plan.action}
        </a>
      ) : (
        <Link to={to} {...button}>
          {plan.action}
        </Link>
      )}
      <ul {...stylex.props(styles.includes)}>
        {plan.includes.map((line) => (
          <li key={line} {...stylex.props(styles.include)}>
            <CheckCircleIcon
              size={16}
              weight="fill"
              {...stylex.props(styles.check, plan.lead && styles.checkLead)}
            />
            {line}
          </li>
        ))}
      </ul>
    </article>
  );
}

const PHONE = "@media (max-width: 640px)";

const styles = stylex.create({
  head: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.xxl,
    paddingTop: {
      default: 96,
      [PHONE]: 64,
    },
    paddingBottom: 48,
    textAlign: "center",
  },
  plans: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(3, minmax(0, 1fr))",
      "@media (max-width: 900px)": "1fr",
    },
    gap: space.md,
    alignItems: "stretch",
  },
  plan: {
    display: "flex",
    flexDirection: "column",
    padding: space.x3,
    borderRadius: 16,
    backgroundColor:
      "light-dark(oklch(0.2 0.01 80 / 0.04), oklch(1 0 0 / 0.04))",
    boxShadow: "inset 0 0 0 1px light-dark(transparent, oklch(1 0 0 / 0.05))",
  },
  // The plan most teams grow into stands a step forward, as resurf's paid card does.
  lead: {
    backgroundColor: color.raised,
    boxShadow: shadow.lift,
  },
  name: {
    margin: 0,
    fontSize: 15,
    lineHeight: "22px",
    fontWeight: 500,
  },
  price: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: space.md,
    margin: 0,
    marginTop: space.xl,
  },
  amount: {
    fontSize: 32,
    lineHeight: "38px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
  },
  per: {
    fontSize: 13,
    color: color.fgMuted,
  },
  pitch: {
    margin: 0,
    marginTop: space.md,
    minHeight: 42,
    fontSize: 14,
    lineHeight: "21px",
    color: color.fgMuted,
    textWrap: "pretty",
  },
  action: {
    width: "100%",
    marginTop: space.xxl,
  },
  outline: {
    backgroundColor: {
      default: color.raised,
      ":hover": { default: null, [media.hover]: color.ui },
    },
    boxShadow: `0 0 0 1px ${color.lineUi}`,
    color: color.fg,
  },
  includes: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    margin: 0,
    marginTop: space.xxl,
    paddingTop: space.xxl,
    paddingInline: 0,
    listStyle: "none",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  include: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.md,
    fontSize: 14,
    lineHeight: "20px",
  },
  check: {
    flexShrink: 0,
    marginTop: 2,
    color: color.fgFaint,
  },
  checkLead: {
    color: color.accent,
  },
  fine: {
    display: "flex",
    flexDirection: {
      default: "row",
      [PHONE]: "column",
    },
    justifyContent: "center",
    alignItems: "center",
    gap: {
      default: space.md,
      [PHONE]: space.xs,
    },
    marginTop: space.x3,
    marginBottom: 0,
    listStyle: "none",
    fontSize: 13,
    color: color.fgMuted,
  },
  sep: {
    display: {
      default: "list-item",
      [PHONE]: "none",
    },
    color: "light-dark(oklch(0.22 0.01 80 / 0.3), oklch(0.94 0.004 80 / 0.3))",
  },
  before: {
    display: "grid",
    gridTemplateColumns: {
      default: "220px minmax(0, 1fr)",
      "@media (max-width: 760px)": "1fr",
    },
    gap: space.x4,
    alignItems: "start",
  },
  beforeTitle: {
    fontSize: 32,
  },
  beforeList: {
    display: "flex",
    flexDirection: "column",
    gap: space.x3,
  },
  help: {
    margin: 0,
    fontSize: 13,
    color: color.fgMuted,
  },
  helpLink: {
    color: color.fg,
    textDecorationLine: "underline",
    textDecorationColor: color.lineStrong,
    textUnderlineOffset: 3,
    transitionProperty: "text-decoration-color",
    transitionDuration: motion.fast,
    borderRadius: radius.xs,
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${color.focus}`,
    },
    outlineOffset: 2,
  },
});
