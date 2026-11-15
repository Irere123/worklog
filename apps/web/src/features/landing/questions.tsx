import type { ReactNode } from "react";

export type Question = { ask: string; answer: ReactNode };
export type QuestionGroup = { title: string; questions: Question[] };

// One place for every answer, so the front page, the FAQ and pricing never disagree.

export const START: Question[] = [
  {
    ask: "What is Worklog?",
    answer: (
      <>
        A shared record of what your team and its agents did. GitHub, Slack,
        Discord and your coding agents write it as they work; Worklog keeps a
        board, tells each person only what’s blocked on them, and gives everyone
        an assistant that knows their work.
      </>
    ),
  },
  {
    ask: "How do we start?",
    answer: (
      <>
        Sign in with your email on Worklog Cloud and name your team’s workspace.
        Then connect GitHub or Slack, which bring their recent history with
        them, and invite your team.
      </>
    ),
  },
  {
    ask: "Which tools connect?",
    answer: (
      <>
        GitHub and Slack install in one step and bring their recent history.
        GitLab, Gitea, Forgejo and Discord connect with a token, and any other
        tool can post to a webhook mapped by rules. People log the rest in a
        sentence.
      </>
    ),
  },
];

export const OPEN: Question[] = [
  {
    ask: "Is Worklog open source?",
    answer: (
      <>
        Yes, under the AGPL-3.0. The server, the worker and the web app are on
        GitHub, and Worklog Cloud runs the same code. Read it, file an issue, or
        send a pull request.
      </>
    ),
  },
  {
    ask: "Can we host it ourselves?",
    answer: (
      <>
        Yes, with every feature and no limits. Run it with Docker Compose on
        your own server or deploy it to Railway, and your data stays in your own
        Postgres. Telemetry is off unless you give it a Tinybird token.
      </>
    ),
  },
  {
    ask: "What does a server need?",
    answer: (
      <>
        Postgres and three small processes, each with its own image: the web
        app, the API and a worker that ingests events and runs schedules. The
        deploy guide walks through Docker Compose and Railway.
      </>
    ),
  },
  {
    ask: "Can our server be invite-only?",
    answer: (
      <>
        Yes. Set <code>SIGNUP=closed</code> and, after the first workspace,
        people join only when someone invites them.
      </>
    ),
  },
];

export const AI: Question[] = [
  {
    ask: "Do we need AI?",
    answer: (
      <>
        No. Without a model, briefs are written from templates and rules, and
        the board, inbox and activity work the same. With one, the assistant
        answers questions and briefs are written in sentences.
      </>
    ),
  },
  {
    ask: "Which models does it use?",
    answer: (
      <>
        On your own server, any model OpenRouter offers: set an OpenRouter key
        and choose the models. On Cloud, the Team plan includes AI with no key
        to manage.
      </>
    ),
  },
  {
    ask: "How do agents join the team?",
    answer: (
      <>
        Each agent gets its own API key, scoped to read, write or ingest. It
        owns cards, reports progress, and asks its person when a change needs a
        decision. Everything it does is labeled as the agent’s.
      </>
    ),
  },
];

export const PRIVACY: Question[] = [
  {
    ask: "Who sees what?",
    answer: (
      <>
        Teammates see the team’s work. Anything private stays yours, and that
        rule is kept by the server, so a teammate’s question to your assistant
        never reaches it.
      </>
    ),
  },
  {
    ask: "Does the assistant decide what to keep private?",
    answer: (
      <>
        No. Privacy is enforced in the server’s queries, not by asking a model
        to be careful: what a teammate may not see never reaches the assistant
        answering them.
      </>
    ),
  },
];

export const PRICING: Question[] = [
  {
    ask: "What’s free?",
    answer: (
      <>
        Worklog Cloud is free for a team of up to three people. Self-hosting is
        free for any team, with every feature.
      </>
    ),
  },
  {
    ask: "What does Team add?",
    answer: (
      <>
        Any number of people, every connector, your whole history, AI with no
        key to manage, and priority support, for one price for the team.
      </>
    ),
  },
  {
    ask: "Do we need a card to start?",
    answer: <>No. Starting on the free plan takes an email address.</>,
  },
];

export const GROUPS: QuestionGroup[] = [
  { title: "Getting started", questions: START },
  { title: "Open source and self-hosting", questions: OPEN },
  { title: "AI and agents", questions: AI },
  { title: "Privacy", questions: PRIVACY },
  { title: "Pricing", questions: PRICING },
];
