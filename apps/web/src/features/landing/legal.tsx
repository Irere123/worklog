import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { color, space } from "#ui/tokens.stylex";

import { SOURCE } from "./links";
import { Site } from "./site";
import { links, page, type } from "./styles";

export const CONTACT = "privacy@worklog.app";
const UPDATED = "15 November 2026";

type Section = { title: string; body: ReactNode };

/** A legal page: plain sections in a reading column, and when it last changed. */
function Legal({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: ReactNode;
  sections: Section[];
}) {
  return (
    <Site>
      <article {...stylex.props(page.narrow, styles.article)}>
        <header {...stylex.props(styles.head)}>
          <h1 {...stylex.props(type.display)}>{title}</h1>
          <p {...stylex.props(styles.updated)}>Last updated {UPDATED}</p>
          <p {...stylex.props(styles.intro)}>{intro}</p>
        </header>
        {sections.map((section, at) => (
          <section key={section.title} {...stylex.props(styles.section)}>
            <h2 {...stylex.props(styles.title)}>
              <span {...stylex.props(styles.number)}>{at + 1}.</span>
              {section.title}
            </h2>
            <div {...stylex.props(styles.body)}>{section.body}</div>
          </section>
        ))}
      </article>
    </Site>
  );
}

function Mail() {
  return (
    <a href={`mailto:${CONTACT}`} {...stylex.props(links.inline)}>
      {CONTACT}
    </a>
  );
}

// Built on call, not at load: the sections use the styles declared at the foot of the file.
function privacy(): Section[] {
  return [
    {
      title: "What this policy covers",
      body: (
        <p>
          This policy covers Worklog Cloud, the hosted service, and this
          website. Worklog is also open-source software that teams run on their
          own servers. A server your team runs is operated by your team, which
          decides how its data is handled; nothing from it reaches us.
        </p>
      ),
    },
    {
      title: "What we collect",
      body: (
        <ul {...stylex.props(styles.points)}>
          <li {...stylex.props(styles.point)}>
            <strong>Your account:</strong> your email address and name, and your
            profile picture if you sign in with GitHub or Discord.
          </li>
          <li {...stylex.props(styles.point)}>
            <strong>Your workspace:</strong> what your team and its connected
            tools send to it. That includes events from GitHub, GitLab, Gitea,
            Slack, Discord and webhooks, cards and comments, logs people write,
            briefs, conversations with the assistant, and what the assistant
            remembers.
          </li>
          <li {...stylex.props(styles.point)}>
            <strong>Connections:</strong> the tokens that let Worklog read the
            tools you connect. They are stored encrypted.
          </li>
          <li {...stylex.props(styles.point)}>
            <strong>Running the service:</strong> logs and traces of requests
            and background jobs. They record what happened and how long it took,
            never the content of messages, payloads or prompts.
          </li>
          <li {...stylex.props(styles.point)}>
            <strong>Your browser:</strong> a cookie that keeps you signed in,
            and local storage for small preferences such as your theme. We use
            no advertising or third-party tracking cookies.
          </li>
        </ul>
      ),
    },
    {
      title: "How we use it",
      body: (
        <p>
          Only to run Worklog for you: to show your team its work, send the
          pings, briefs and digests you ask for, answer questions, keep the
          service secure, and fix what breaks. We don’t sell your data, and we
          don’t use it for advertising.
        </p>
      ),
    },
    {
      title: "AI",
      body: (
        <p>
          AI is optional. When it’s on, the text needed to answer a question or
          write a brief is sent to a model provider through OpenRouter. Privacy
          rules are applied first, by our servers: a model only ever sees what
          the person asking is allowed to see. We don’t use your content to
          train models.
        </p>
      ),
    },
    {
      title: "Who else handles it",
      body: (
        <p>
          A small number of service providers process data on our behalf, under
          contract and only to run Worklog: the cloud provider that hosts it, an
          email delivery service, the model providers above when AI is on, and a
          telemetry service that receives the logs described above. We disclose
          data to anyone else only when the law requires it.
        </p>
      ),
    },
    {
      title: "How long we keep it",
      body: (
        <p>
          Raw deliveries from connected tools are kept for 90 days and then
          deleted. Your workspace’s record stays while the workspace exists.
          When you ask us to delete your account or workspace, we delete it
          within 30 days, except for what the law requires us to keep.
        </p>
      ),
    },
    {
      title: "Your choices and rights",
      body: (
        <p>
          You can see, correct, export or delete your data. Much of it you can
          change in Worklog itself; for anything else, including deleting your
          account or workspace, email <Mail />. We answer within 30 days.
        </p>
      ),
    },
    {
      title: "Security",
      body: (
        <p>
          Data travels over HTTPS, connection tokens are encrypted at rest, and
          each workspace’s data is kept apart by the server. No system is
          perfectly secure; if something goes wrong that affects your data, we
          will tell you.
        </p>
      ),
    },
    {
      title: "Children",
      body: <p>Worklog is for work, and not for anyone under 16.</p>,
    },
    {
      title: "Changes",
      body: (
        <p>
          When this policy changes, we update it here and change the date above.
          If a change matters to how your data is used, we tell workspace owners
          by email first.
        </p>
      ),
    },
    {
      title: "Contact",
      body: (
        <p>
          Questions about privacy go to <Mail />.
        </p>
      ),
    },
  ];
}

function terms(): Section[] {
  return [
    {
      title: "These terms",
      body: (
        <p>
          These terms apply when you use Worklog Cloud, the hosted service, or
          this website. By using them you agree to these terms. If you use
          Worklog for a team or a company, you agree on its behalf.
        </p>
      ),
    },
    {
      title: "The software and the service",
      body: (
        <p>
          Worklog’s code is open source under the{" "}
          <a
            href={`${SOURCE}/blob/main/LICENSE`}
            {...stylex.props(links.inline)}
          >
            GNU Affero General Public License v3
          </a>
          . That license, not these terms, governs what you do with the code,
          including running it on your own server. These terms cover only the
          service we run.
        </p>
      ),
    },
    {
      title: "Your account",
      body: (
        <p>
          Give accurate details and keep your sign-in secure. You’re responsible
          for what happens through your account and the API keys you create,
          including keys you give to agents. Workspace owners decide who joins
          their workspace and what their agents may do.
        </p>
      ),
    },
    {
      title: "Your content",
      body: (
        <p>
          What you and your team put into Worklog stays yours. You give us
          permission to store and process it only to run the service for you.
          Make sure you have the right to connect the tools and share the
          content you bring in.
        </p>
      ),
    },
    {
      title: "Fair use",
      body: (
        <ul {...stylex.props(styles.points)}>
          <li {...stylex.props(styles.point)}>
            Don’t use Worklog for anything unlawful or harmful.
          </li>
          <li {...stylex.props(styles.point)}>
            Don’t try to reach data that isn’t yours, or to break security.
          </li>
          <li {...stylex.props(styles.point)}>
            Don’t overload the service, or use it to send spam or other unwanted
            messages.
          </li>
        </ul>
      ),
    },
    {
      title: "Plans and payment",
      body: (
        <p>
          The plans and prices are on the pricing page. Paid plans are billed in
          advance each month. You can cancel at any time, and your plan runs to
          the end of the period you paid for. If prices change, we tell you at
          least 30 days before.
        </p>
      ),
    },
    {
      title: "AI features",
      body: (
        <p>
          The assistant and written briefs are generated by models and can be
          wrong. Check what matters before you act on it.
        </p>
      ),
    },
    {
      title: "Availability and changes",
      body: (
        <p>
          We work to keep Worklog running and your data safe, but we can’t
          promise it will never be interrupted. We may change or remove
          features; when a change takes something away that you rely on, we tell
          you first.
        </p>
      ),
    },
    {
      title: "Ending your use",
      body: (
        <p>
          You can stop using Worklog at any time and ask us to delete your data.
          We may suspend an account that breaks these terms, and we tell you why
          unless the law prevents it.
        </p>
      ),
    },
    {
      title: "Disclaimer and liability",
      body: (
        <p>
          Worklog is provided as it is, without warranties beyond those the law
          requires. As far as the law allows, we are not liable for indirect or
          consequential losses, and our total liability is limited to what you
          paid us in the 12 months before the claim.
        </p>
      ),
    },
    {
      title: "Governing law",
      body: <p>These terms are governed by the laws of Rwanda.</p>,
    },
    {
      title: "Changes and contact",
      body: (
        <p>
          When these terms change, we update them here and change the date
          above, and we tell workspace owners about changes that matter.
          Questions go to <Mail />.
        </p>
      ),
    },
  ];
}

export function PrivacyPage() {
  return (
    <Legal
      title="Privacy policy"
      intro="What Worklog collects, why, and what you can do about it, in plain words."
      sections={privacy()}
    />
  );
}

export function TermsPage() {
  return (
    <Legal
      title="Terms of use"
      intro="The agreement between you and Worklog when you use Worklog Cloud and this website."
      sections={terms()}
    />
  );
}

const styles = stylex.create({
  article: {
    maxWidth: 736,
    paddingBottom: space.x5,
  },
  head: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    paddingTop: {
      default: 96,
      "@media (max-width: 640px)": 64,
    },
    paddingBottom: space.x4,
    marginBottom: space.x4,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  updated: {
    margin: 0,
    fontSize: 13,
    color: color.fgMuted,
  },
  intro: {
    margin: 0,
    fontSize: 17,
    lineHeight: "27px",
    color: color.fgMuted,
    textWrap: "pretty",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    paddingBlock: space.xl,
  },
  title: {
    display: "flex",
    gap: space.sm,
    margin: 0,
    fontSize: 17,
    lineHeight: "24px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  number: {
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    fontSize: 15,
    lineHeight: "25px",
    color: color.fgMuted,
    textWrap: "pretty",
  },
  points: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingLeft: space.xxl,
    listStyleType: "disc",
  },
  point: {
    paddingLeft: space.xs,
  },
});
