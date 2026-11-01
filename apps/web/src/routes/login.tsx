import { EnvelopeSimpleIcon, KeyIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { SubmitEvent } from "react";

import { ApiError, auth } from "#api/client";
import { q } from "#api/queries";
import { AuthFrame, authStyles } from "#features/auth/frame";
import { requestMagicLink, socialSignIn } from "#features/auth/session";
import { Button } from "#ui/button";
import { ErrorNote } from "#ui/feedback";
import { Field, Input } from "#ui/field";

type Search = { next?: string };

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · Worklog" }] }),
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Search => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: Login,
});

const PROVIDERS: Record<string, string> = {
  github: "GitHub",
  slack: "Slack",
  discord: "Discord",
};

function Login() {
  const { next = "/home" } = Route.useSearch();
  const config = useQuery(q.authConfig());
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestMagicLink(email.trim(), next);
      setSent(email.trim());
    } catch (error_) {
      setError(error_);
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <AuthFrame
        title="Check your email"
        subtitle={
          <>
            We sent a sign-in link to <strong>{sent}</strong>. It works for five
            minutes.
          </>
        }
        footer={
          <button
            type="button"
            onClick={() => setSent(null)}
            {...stylex.props(authStyles.link)}
          >
            Use a different email
          </button>
        }
      >
        {import.meta.env.DEV && (
          <p {...stylex.props(authStyles.note)}>
            No mail server set up? The link is printed in the API’s console.
          </p>
        )}
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Sign in to Worklog"
      subtitle="Your team’s logbook. The tools write it, so nobody has to report status."
      footer={
        config.data?.setupOpen === true ? (
          <>
            New server?{" "}
            <Link to="/setup" {...stylex.props(authStyles.link)}>
              Set up a workspace
            </Link>
          </>
        ) : undefined
      }
    >
      {showKey ? (
        <>
          <ApiKeyForm next={next} />
          <button
            type="button"
            onClick={() => setShowKey(false)}
            {...stylex.props(authStyles.note, authStyles.link)}
          >
            Email me a sign-in link instead
          </button>
        </>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              void send(event);
            }}
            {...stylex.props(authStyles.form)}
          >
            <Field label="Email">
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@team.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              )}
            </Field>
            {error !== null && <ErrorNote error={error} />}
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              icon={<EnvelopeSimpleIcon size={14} />}
            >
              Email me a sign-in link
            </Button>
          </form>
          {(config.data?.socialProviders.length ?? 0) > 0 && (
            <>
              <div {...stylex.props(authStyles.divider)}>or</div>
              <div {...stylex.props(authStyles.form)}>
                {config.data?.socialProviders.map((provider) => (
                  <Button
                    key={provider}
                    onClick={() => {
                      socialSignIn(provider, next).catch(setError);
                    }}
                  >
                    Continue with {PROVIDERS[provider] ?? provider}
                  </Button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowKey(true)}
            {...stylex.props(authStyles.note, authStyles.link)}
          >
            Use an API key instead
          </button>
        </>
      )}
    </AuthFrame>
  );
}

function ApiKeyForm({ next }: { next: string }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const navigate = useNavigate();

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    auth.setKey(key.trim());
    try {
      client.clear();
      await client.query(q.session());
      await navigate({ to: next });
    } catch (error_) {
      auth.setKey(null);
      setError(
        error_ instanceof ApiError && error_.status === 401
          ? new Error("That key isn’t valid on this server.")
          : error_
      );
    }
    setBusy(false);
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      {...stylex.props(authStyles.form)}
    >
      <Field
        label="API key"
        hint="Keys start with wl_. Create one in Settings → API keys."
      >
        {(id) => (
          <Input
            id={id}
            required
            spellCheck={false}
            autoComplete="off"
            placeholder="wl_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            leading={<KeyIcon size={14} />}
            autoFocus
          />
        )}
      </Field>
      {error !== null && <ErrorNote error={error} />}
      <Button type="submit" variant="primary" busy={busy}>
        Sign in with key
      </Button>
    </form>
  );
}
