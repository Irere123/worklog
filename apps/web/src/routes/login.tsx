import { EnvelopeSimpleIcon, KeyIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { SubmitEvent } from "react";

import { ApiError, auth } from "#api/client";
import { q } from "#api/queries";
import { AuthFrame, authStyles } from "#features/auth/frame";
import { requestMagicLink, socialSignIn } from "#features/auth/session";
import { Button } from "#ui/button";
import { Badge } from "#ui/chip";
import { ErrorNote } from "#ui/feedback";
import { Field, Input } from "#ui/field";
import { ProductMark } from "#ui/product-mark";
import { color, space, text } from "#ui/tokens.stylex";

type Search = { next?: string };

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · Worklog" }] }),
  ssr: false,
  validateSearch: (search: Record<string, unknown>): Search => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: Login,
});

type Provider = "github" | "discord";

const PROVIDERS: Record<Provider, string> = {
  github: "GitHub",
  discord: "Discord",
};

function Login() {
  const { next = "/home" } = Route.useSearch();
  const config = useQuery(q.authConfig());
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [redirecting, setRedirecting] = useState<Provider | null>(null);
  const [showKey, setShowKey] = useState(false);
  const lastUsed = useMemo(() => readLastUsed(), []);
  const providers = (config.data?.socialProviders ?? []).filter(isShown);
  const setupOpen = config.data?.setupOpen === true;

  async function send(event?: SubmitEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestMagicLink(email.trim(), next);
      rememberLastUsed("email");
      setResent(sent !== null);
      setSent(email.trim());
    } catch (error_) {
      setError(error_);
    }
    setBusy(false);
  }

  function continueWith(provider: Provider) {
    setRedirecting(provider);
    setError(null);
    rememberLastUsed(provider);
    socialSignIn(provider, next).catch(() => {
      setRedirecting(null);
      setError(
        new Error(
          `We couldn’t reach ${PROVIDERS[provider]}. Try again, or use your email.`
        )
      );
    });
  }

  if (sent) {
    return (
      <AuthFrame
        title="Check your email"
        subtitle={
          <>
            {resent ? "We sent another link" : "We sent a link"} to{" "}
            <strong>{sent}</strong>. Open it on this device to sign in here. It
            works for five minutes.
          </>
        }
        footer={
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void send();
              }}
              {...stylex.props(authStyles.link)}
            >
              Send it again
            </button>
            {" · "}
            <button
              type="button"
              onClick={() => {
                setSent(null);
                setResent(false);
              }}
              {...stylex.props(authStyles.link)}
            >
              Use a different address
            </button>
          </>
        }
      >
        {error !== null && <ErrorNote error={error} />}
        {import.meta.env.DEV && (
          <p {...stylex.props(authStyles.note)}>
            In development without a mail server, the link is in the API’s
            console instead.
          </p>
        )}
      </AuthFrame>
    );
  }

  if (showKey) {
    return (
      <AuthFrame
        title="Sign in with an API key"
        subtitle="Only in development: you’ll see Worklog as whoever owns the key, such as an agent."
        footer={
          <button
            type="button"
            onClick={() => setShowKey(false)}
            {...stylex.props(authStyles.link)}
          >
            Back to email, GitHub and Discord
          </button>
        }
      >
        <ApiKeyForm next={next} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Sign in to Worklog"
      subtitle="Your team’s logbook: what shipped, what’s stuck, and what needs you."
      footer={
        setupOpen || import.meta.env.DEV ? (
          <>
            {setupOpen && (
              <>
                This server has no workspace yet.{" "}
                <Link to="/setup" {...stylex.props(authStyles.link)}>
                  Set one up
                </Link>
              </>
            )}
            {/* Keys are for agents and scripts; outside development, people sign in as themselves. */}
            {import.meta.env.DEV && (
              <button
                type="button"
                onClick={() => setShowKey(true)}
                {...stylex.props(authStyles.link, styles.footerAction)}
              >
                Sign in with an API key
              </button>
            )}
          </>
        ) : undefined
      }
    >
      <form
        onSubmit={(event) => {
          void send(event);
        }}
        {...stylex.props(authStyles.form)}
      >
        <Field
          label="Email"
          hint={
            config.data?.signupOpen === false
              ? "Invited? Use the address your invite went to."
              : "New here? You’ll name your team’s workspace next. Invited? Use the address your invite went to."
          }
        >
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
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={redirecting !== null}
          icon={<EnvelopeSimpleIcon size={14} />}
        >
          Email me a sign-in link
        </Button>
      </form>
      {providers.length > 0 && (
        <>
          <div {...stylex.props(authStyles.divider)}>or</div>
          <div {...stylex.props(authStyles.form)}>
            {providers.map((provider) => {
              const name = PROVIDERS[provider];
              return (
                <div key={provider} {...stylex.props(styles.provider)}>
                  <Button
                    busy={redirecting === provider}
                    disabled={redirecting !== null || busy}
                    icon={<ProductMark product={provider} size={16} />}
                    onClick={() => continueWith(provider)}
                    sx={authStyles.full}
                  >
                    Continue with {name}
                  </Button>
                  {lastUsed === provider && (
                    <Badge sx={styles.lastUsed}>Last used</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {error !== null && <ErrorNote error={error} />}
    </AuthFrame>
  );
}

// The API also signs people in with Slack, but the web app offers only these two for now.
function isShown(provider: string): provider is Provider {
  return provider in PROVIDERS;
}

const LAST_USED = "worklog.lastSignIn";

function readLastUsed() {
  try {
    return localStorage.getItem(LAST_USED);
  } catch {
    return null;
  }
}

function rememberLastUsed(method: Provider | "email") {
  try {
    localStorage.setItem(LAST_USED, method);
  } catch {
    // Private windows may refuse storage; the hint is a nicety.
  }
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
          ? new Error(
              "That key doesn’t work on this server. Check you copied all of it."
            )
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
        hint="It starts with wl_. Make one in Settings → API keys."
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
        Sign in
      </Button>
    </form>
  );
}

const styles = stylex.create({
  provider: { position: "relative", minWidth: 0 },
  lastUsed: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineEnd: space.sm,
    transform: "translateY(-50%)",
    height: 16,
    paddingInline: space.xs,
    fontSize: text.caption,
    color: color.accentFg,
    backgroundColor: color.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.lineUi,
    pointerEvents: "none",
  },
  footerAction: {
    display: "block",
    marginInline: "auto",
    marginBlockStart: space.sm,
  },
});
