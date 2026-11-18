import {
  CheckCircleIcon,
  ShieldCheckIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { Schemas } from "#api/client";
import { ApiError, api, unwrap } from "#api/client";
import { AuthFrame, authStyles } from "#features/auth/frame";
import { Avatar } from "#ui/avatar";
import { Button } from "#ui/button";
import { ErrorNote } from "#ui/feedback";
import { Field, Select, Switch } from "#ui/field";
import { color, radius, space, text } from "#ui/tokens.stylex";

const SIGNING = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"];

/**
 * The first page a coding agent's sign-in opens. Someone signed in goes straight back to the
 * authorization request, now with a session; anyone else signs in first and lands back here.
 */
export function ConnectSignIn() {
  const query = useMemo(() => location.search.slice(1), []);
  const approval = useApproval(query);
  const signedOut = needsSignIn(approval.error);
  useEffect(() => {
    if (approval.isSuccess) {
      const fresh = new URLSearchParams(query);
      for (const name of SIGNING) {
        fresh.delete(name);
      }
      location.replace(`/api/auth/oauth2/authorize?${fresh.toString()}`);
    } else if (signedOut) {
      location.replace(signInUrl(query));
    }
  }, [approval.isSuccess, signedOut, query]);
  if (approval.isError && !signedOut) {
    return <CantApprove error={approval.error} />;
  }
  return (
    <AuthFrame
      title="Connecting your agent"
      subtitle="One moment while Worklog checks who you are."
    >
      {null}
    </AuthFrame>
  );
}

type Grant = "read" | "write";

const GRANTS: { scope: Grant; label: string; hint: string }[] = [
  {
    scope: "read",
    label: "Read the board",
    hint: "Cards, who’s on them and their discussion, so it can find the task and not collide with a teammate.",
  },
  {
    scope: "write",
    label: "Change cards",
    hint: "Create cards, move them between columns and comment, as itself.",
  },
];

/**
 * Where a person decides whether a coding tool may work for them: what it is and who vouches for
 * that, which workspace it joins, and what it may touch. Reporting its progress to them is the
 * point of connecting, so that one isn't optional.
 */
export function ApproveAgent() {
  const query = useMemo(() => location.search.slice(1), []);
  const approval = useApproval(query);

  if (needsSignIn(approval.error)) {
    return (
      <AuthFrame
        title="Sign in to approve this agent"
        subtitle="An agent works for a person, so approving one takes you, signed in, not an API key."
      >
        <Button
          variant="primary"
          onClick={() => {
            location.assign(signInUrl(query));
          }}
        >
          Sign in
        </Button>
      </AuthFrame>
    );
  }
  if (approval.isError) {
    return <CantApprove error={approval.error} />;
  }
  if (!approval.data) {
    return <AuthFrame title="Connect a coding agent">{null}</AuthFrame>;
  }
  if (approval.data.workspaces.length === 0) {
    return (
      <AuthFrame
        title="You’re not in a workspace yet"
        subtitle="An agent joins a team as yours. Start a workspace or accept an invite, then connect it again."
      >
        {null}
      </AuthFrame>
    );
  }
  return <ApprovalForm query={query} approval={approval.data} />;
}

function ApprovalForm({
  query,
  approval,
}: {
  query: string;
  approval: Schemas["AgentApproval"];
}) {
  const requested = new Set(
    (new URLSearchParams(query).get("scope") ?? "").split(" ")
  );
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [grants, setGrants] = useState<Record<Grant, boolean>>({
    read: true,
    write: true,
  });
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { client, workspaces } = approval;
  const chosen = workspace ?? workspaces[0]?.id ?? null;
  const place = workspaces.find((w) => w.id === chosen);

  async function decide(accept: boolean) {
    setBusy(accept ? "approve" : "deny");
    setError(null);
    try {
      if (accept && chosen !== null) {
        await authPost("/api/auth/update-session", {
          agentWorkspaceId: chosen,
        });
      }
      const scope = [...requested]
        .filter((s) => s !== "" && !(isGrant(s) && !grants[s]))
        .join(" ");
      const url = await authPost("/api/auth/oauth2/consent", {
        accept,
        ...(accept ? { scope } : {}),
        oauth_query: query,
      });
      location.assign(url);
    } catch (error_) {
      setError(error_);
      setBusy(null);
    }
  }

  return (
    <AuthFrame
      title={`Let ${client.name} work for you?`}
      subtitle={
        place?.agent
          ? `It’s already your agent in ${place.name}; approving reconnects it.`
          : "It joins your team in Worklog as your agent: it reports what it’s doing, and asks you when it needs a decision."
      }
      footer={`Signed in as ${approval.signedInAs}.`}
    >
      <ClientCard client={client} />
      <div {...stylex.props(authStyles.form)}>
        {workspaces.length > 1 && (
          <Field label="Workspace">
            {(id) => (
              <Select
                id={id}
                value={chosen ?? ""}
                onValueChange={setWorkspace}
                options={workspaces.map((w) => ({
                  value: w.id,
                  label: w.agent ? `${w.name} (connected)` : w.name,
                }))}
              />
            )}
          </Field>
        )}
        <ul {...stylex.props(styles.grants)}>
          <li {...stylex.props(styles.grant)}>
            <CheckCircleIcon
              size={18}
              weight="fill"
              {...stylex.props(styles.always)}
            />
            <div {...stylex.props(styles.grantText)}>
              <p {...stylex.props(styles.grantLabel)}>Report its progress</p>
              <p {...stylex.props(styles.grantHint)}>
                What it’s working on, what it finished, and questions for you.
              </p>
            </div>
          </li>
          {GRANTS.filter((g) => requested.has(g.scope)).map((g) => (
            <li key={g.scope} {...stylex.props(styles.grant)}>
              <div {...stylex.props(styles.grantText)}>
                <p {...stylex.props(styles.grantLabel)}>{g.label}</p>
                <p {...stylex.props(styles.grantHint)}>{g.hint}</p>
              </div>
              <Switch
                label={g.label}
                checked={grants[g.scope]}
                onCheckedChange={(on) =>
                  setGrants((now) => ({ ...now, [g.scope]: on }))
                }
              />
            </li>
          ))}
        </ul>
        {error !== null && <ErrorNote error={error} />}
        <div {...stylex.props(styles.actions)}>
          <Button
            variant="ghost"
            busy={busy === "deny"}
            disabled={busy !== null}
            onClick={() => {
              void decide(false);
            }}
          >
            Don’t allow
          </Button>
          <Button
            variant="primary"
            busy={busy === "approve"}
            disabled={busy !== null}
            onClick={() => {
              void decide(true);
            }}
          >
            Approve
          </Button>
        </div>
      </div>
    </AuthFrame>
  );
}

function ClientCard({
  client,
}: {
  client: Schemas["AgentApproval"]["client"];
}) {
  const agent = {
    id: client.id,
    name: client.name,
    kind: "agent",
    agentProvider: client.provider,
  };
  return (
    <div {...stylex.props(styles.who)}>
      <Avatar person={agent} size={40} />
      <div {...stylex.props(styles.whoText)}>
        <p {...stylex.props(styles.name)}>{client.name}</p>
        {client.verifiedHost === null ? (
          <p {...stylex.props(styles.proof, styles.unverified)}>
            <WarningIcon size={14} weight="fill" />
            It named itself. Approve only if you just connected it.
          </p>
        ) : (
          <p {...stylex.props(styles.proof, styles.verified)}>
            <ShieldCheckIcon size={14} weight="fill" />
            Verified by {client.verifiedHost}
          </p>
        )}
      </div>
    </div>
  );
}

function useApproval(query: string) {
  const clientId = new URLSearchParams(query).get("client_id") ?? "";
  return useQuery({
    queryKey: ["agent-approval", clientId],
    queryFn: async () =>
      await unwrap(
        api.GET("/v1/agent-approval", { params: { query: { clientId } } })
      ),
    retry: false,
  });
}

function needsSignIn(error: unknown) {
  return error instanceof ApiError && error.status === 401;
}

function signInUrl(query: string) {
  return `/login?next=${encodeURIComponent(`/connect/sign-in?${query}`)}`;
}

function CantApprove({ error }: { error: unknown }) {
  return (
    <AuthFrame
      title="This connection can’t be approved"
      subtitle="Start connecting again from your coding tool."
    >
      <ErrorNote error={error} />
    </AuthFrame>
  );
}

function isGrant(scope: string): scope is Grant {
  return GRANTS.some((g) => g.scope === scope);
}

async function authPost(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      field(json, "error_description") ??
        field(json, "message") ??
        "That didn’t go through. Start connecting again from your tool."
    );
  }
  return field(json, "url") ?? "/";
}

function field(json: unknown, name: string) {
  if (typeof json !== "object" || json === null) {
    return null;
  }
  const value: unknown = Reflect.get(json, name);
  return typeof value === "string" ? value : null;
}

const styles = stylex.create({
  who: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.raised,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  whoText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  name: { fontSize: text.copy, fontWeight: 600 },
  proof: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: text.meta,
  },
  verified: { color: color.fgMuted },
  unverified: { color: color.amberFg },
  grants: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  grant: { display: "flex", alignItems: "flex-start", gap: space.md },
  always: { color: color.accentFg, flexShrink: 0, marginTop: 1 },
  grantText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flexGrow: 1,
    minWidth: 0,
  },
  grantLabel: { fontSize: text.label, fontWeight: 500 },
  grantHint: { fontSize: text.meta, color: color.fgMuted },
  actions: { display: "flex", justifyContent: "flex-end", gap: space.sm },
});
