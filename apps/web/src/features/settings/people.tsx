import {
  CopyIcon,
  KeyIcon,
  PlusIcon,
  RobotIcon,
  TrashIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, auth, unwrap } from "#api/client";
import { q } from "#api/queries";
import { useMe } from "#features/auth/session";
import { providerName, useMembers } from "#features/cards/card-bits";
import { ago, fromNow } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Button } from "#ui/button";
import { Badge } from "#ui/chip";
import { EmptyState, Skeleton } from "#ui/feedback";
import { Checkbox, Field, Input, Select } from "#ui/field";
import { Dialog, Tooltip } from "#ui/overlay";
import { color, radius, space, text } from "#ui/tokens.stylex";

import { Card, SettingsPage, settingsStyles } from "./frame";

type Scope = "read" | "write" | "ingest";

export function ApiKeys() {
  const me = useMe();
  const handle = me?.member.handle ?? "me";
  const tokens = useQuery({ ...q.tokens(handle), enabled: me !== undefined });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<{
    id: string;
    name: string;
    prefix: string;
  } | null>(null);
  const client = useQueryClient();
  // Browsers usually sign in with a cookie; when it's a key, revoking it here signs this tab out.
  const inUse = auth.key();
  const revoke = useMutation({
    mutationFn: async (id: string) =>
      await unwrap(api.DELETE("/v1/tokens/{id}", { params: { path: { id } } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["tokens"] });
      toast("Key revoked: anything using it stops working now");
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <SettingsPage
      title="API keys"
      description="For scripts, agents and integrations that act as you. A key can do what its scopes allow, nothing more."
      actions={
        <Button
          size="sm"
          variant="primary"
          icon={<PlusIcon size={14} />}
          onClick={() => setCreating(true)}
        >
          New key
        </Button>
      }
    >
      <Card>
        {tokens.isPending && (
          <div {...stylex.props(settingsStyles.pad)}>
            <Skeleton lines={3} />
          </div>
        )}
        {tokens.data?.length === 0 && (
          <EmptyState icon={<KeyIcon size={20} />} title="No keys yet" />
        )}
        <ul {...stylex.props(settingsStyles.list)}>
          {tokens.data?.map((t) => (
            <li
              key={t.id}
              {...stylex.props(settingsStyles.listRow, settingsStyles.rowWraps)}
            >
              <KeyIcon size={15} {...stylex.props(styles.icon)} />
              <div
                {...stylex.props(settingsStyles.main, settingsStyles.mainWraps)}
              >
                <p {...stylex.props(settingsStyles.strong)}>
                  {t.name}
                  {inUse?.startsWith(t.prefix) === true && (
                    <Badge tone="accent" sx={styles.here}>
                      This browser
                    </Badge>
                  )}
                </p>
                <p {...stylex.props(settingsStyles.sub)}>
                  <span {...stylex.props(settingsStyles.mono)}>
                    {t.prefix}…
                  </span>{" "}
                  · created {ago(t.createdAt)}
                  {t.lastUsedAt
                    ? ` · last used ${fromNow(t.lastUsedAt)}`
                    : " · never used"}
                  {t.expiresAt ? ` · expires ${fromNow(t.expiresAt)}` : ""}
                </p>
              </div>
              <div {...stylex.props(settingsStyles.rowEnd)}>
                {t.scopes.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
                <Tooltip label="Revoke">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Revoke ${t.name}`}
                    icon={<TrashIcon size={14} />}
                    onClick={() => setRevoking(t)}
                  />
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Dialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
          }
        }}
        size="sm"
        title={`Revoke “${revoking?.name ?? ""}”?`}
        description={
          inUse !== null &&
          revoking !== null &&
          inUse.startsWith(revoking.prefix)
            ? "This browser signs in with this key, so you’ll be signed out. Anything else using it stops working too, and a revoked key can’t be restored."
            : "Anything using it stops working straight away, and a revoked key can’t be restored."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              busy={revoke.isPending}
              onClick={() => {
                if (revoking) {
                  revoke.mutate(revoking.id, {
                    onSettled: () => setRevoking(null),
                  });
                }
              }}
            >
              Revoke key
            </Button>
          </>
        }
      />
      <NewKey
        open={creating}
        onClose={() => setCreating(false)}
        handle={handle}
      />
    </SettingsPage>
  );
}

function NewKey({
  open,
  onClose,
  handle,
}: {
  open: boolean;
  onClose: () => void;
  handle: string;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read", "write"]);
  const [days, setDays] = useState("90");
  const [secret, setSecret] = useState<string | null>(null);
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/members/{ref}/tokens", {
          params: { path: { ref: handle } },
          body: {
            name: name.trim(),
            scopes,
            expiresInDays: days ? Number(days) : undefined,
          },
        })
      ),
    onSuccess: (key) => {
      setSecret(key.token);
      void client.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const close = () => {
    setSecret(null);
    setName("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          close();
        }
      }}
      title={secret ? "Copy your key now" : "New API key"}
      description={
        secret
          ? "It won’t be shown again. Store it where your script or agent reads secrets."
          : undefined
      }
      footer={
        secret ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim() || scopes.length === 0}
              busy={create.isPending}
              onClick={() => create.mutate()}
            >
              Create key
            </Button>
          </>
        )
      }
    >
      <div {...stylex.props(styles.body)}>
        {secret ? (
          <SecretField value={secret} />
        ) : (
          <>
            <Field
              label="Name"
              hint="Where it’s used, so you know what breaks if you revoke it."
            >
              {(id) => (
                <Input
                  id={id}
                  autoFocus
                  placeholder="Laptop scripts"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <fieldset {...stylex.props(styles.scopes)}>
              <legend {...stylex.props(styles.legend)}>Scopes</legend>
              {(
                [
                  ["read", "Read the board, activity and briefs"],
                  [
                    "write",
                    "Change cards, answer the inbox, talk to assistants",
                  ],
                  [
                    "ingest",
                    "Only log work and push events (for agents and CI)",
                  ],
                ] as [Scope, string][]
              ).map(([scope, label]) => (
                <label key={scope} {...stylex.props(styles.scope)}>
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(on) =>
                      setScopes(
                        on
                          ? [...scopes, scope]
                          : scopes.filter((s) => s !== scope)
                      )
                    }
                  />
                  <span {...stylex.props(styles.scopeName)}>{scope}</span>
                  <span {...stylex.props(settingsStyles.sub)}>{label}</span>
                </label>
              ))}
            </fieldset>
            <Field label="Expires">
              {(id) => (
                <Select
                  id={id}
                  value={days}
                  onValueChange={setDays}
                  options={[
                    { value: "30", label: "In 30 days" },
                    { value: "90", label: "In 90 days" },
                    { value: "365", label: "In a year" },
                    { value: "", label: "Never" },
                  ]}
                />
              )}
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function SecretField({ value }: { value: string }) {
  return (
    <div {...stylex.props(styles.secret)}>
      <code {...stylex.props(styles.secretCode)}>{value}</code>
      <Button
        size="sm"
        icon={<CopyIcon size={13} />}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success("Copied");
        }}
      >
        Copy
      </Button>
    </div>
  );
}

export function Members() {
  const { list } = useMembers();
  const me = useMe();
  const [adding, setAdding] = useState<"human" | "agent" | null>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const humans = list.filter((m) => m.kind === "human");
  const agents = list.filter((m) => m.kind === "agent");
  const admin = me?.member.role === "owner" || me?.member.role === "admin";
  return (
    <SettingsPage
      title="Members and agents"
      description="Everyone whose work shows up in Worklog. Agents act for a person, who stays accountable for them."
      actions={
        admin && (
          <>
            <Button
              size="sm"
              icon={<RobotIcon size={14} />}
              onClick={() => setAdding("agent")}
            >
              Add agent
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<UserPlusIcon size={14} />}
              onClick={() => setAdding("human")}
            >
              Invite
            </Button>
          </>
        )
      }
    >
      <Card title={`People · ${humans.length}`}>
        <MemberRows members={humans} />
      </Card>
      <Card
        title={`Agents · ${agents.length}`}
        description="Each agent logs in with its own key and reports work on behalf of its person."
      >
        <MemberRows
          members={agents}
          onKey={(m) =>
            admin || m.ownerId === me?.member.id
              ? () => setKeyFor(m.handle)
              : undefined
          }
        />
      </Card>
      <AddMember kind={adding} onClose={() => setAdding(null)} />
      <NewKey
        open={keyFor !== null}
        handle={keyFor ?? ""}
        onClose={() => setKeyFor(null)}
      />
    </SettingsPage>
  );
}

function MemberRows({
  members,
  onKey,
}: {
  members: Schemas["Member"][];
  /** For agents the viewer may issue keys to: opens the new-key dialog for that agent. */
  onKey?: (member: Schemas["Member"]) => (() => void) | undefined;
}) {
  const { byId } = useMembers();
  const me = useMe();
  return (
    <ul {...stylex.props(settingsStyles.list)}>
      {members.map((m) => {
        const owner = m.ownerId ? byId.get(m.ownerId) : undefined;
        const self = m.id === me?.member.id;
        // "Ada’s assistant" already says whom it works for.
        const namedForOwner =
          owner !== undefined && m.name.startsWith(owner.name);
        return (
          <li key={m.id} {...stylex.props(settingsStyles.listRow)}>
            <Avatar person={m} size={28} />
            <div {...stylex.props(settingsStyles.main)}>
              <p {...stylex.props(settingsStyles.strong)}>{m.name}</p>
              <p {...stylex.props(settingsStyles.sub)}>
                @{m.handle}
                {m.title ? ` · ${m.title}` : ""}
                {owner && !namedForOwner ? ` · works for ${owner.name}` : ""}
                {m.agentProvider ? ` · ${providerName(m.agentProvider)}` : ""}
              </p>
            </div>
            {self && <Badge>You</Badge>}
            {/* Someone using Worklog through an API key has no account but is plainly here. */}
            {m.kind === "human" && !m.signedUp && !self && (
              <Badge tone="amber" status="waiting">
                Invited
              </Badge>
            )}
            {m.role !== "member" && (
              <Badge tone="accent">
                {m.role === "owner" ? "Owner" : "Admin"}
              </Badge>
            )}
            <KeyButton open={onKey?.(m)} name={m.name} />
          </li>
        );
      })}
    </ul>
  );
}

function KeyButton({ open, name }: { open?: () => void; name: string }) {
  if (!open) {
    return null;
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<KeyIcon size={13} />}
      onClick={open}
      aria-label={`New key for ${name}`}
    >
      New key
    </Button>
  );
}

const ADD_COPY = {
  human: {
    title: "Invite a teammate",
    description: "They’ll get a sign-in link by email.",
  },
  agent: {
    title: "Add an agent",
    description: "You’ll be the person it works for.",
  },
};

function AddMember({
  kind,
  onClose,
}: {
  kind: "human" | "agent" | null;
  onClose: () => void;
}) {
  const me = useMe();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const client = useQueryClient();
  const add = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/members", {
          body: {
            kind: kind ?? "human",
            name: name.trim(),
            handle: handle.trim() || undefined,
            email: kind === "human" ? email.trim() || undefined : undefined,
            title: title.trim() || undefined,
            ownerId: kind === "agent" ? me?.member.id : undefined,
            agentProvider:
              kind === "agent" ? provider.trim() || undefined : undefined,
            issueToken: kind === "agent",
          },
        })
      ),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ["members"] });
      if (result.token === null) {
        toast.success(
          result.invited ? `Invite sent to ${email}` : `${name} added`
        );
        close();
      } else {
        setToken(result.token.token);
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const close = () => {
    setName("");
    setHandle("");
    setEmail("");
    setTitle("");
    setProvider("");
    setToken(null);
    onClose();
  };
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={(o) => {
        if (!o) {
          close();
        }
      }}
      title={
        token ? "Give this key to your agent" : ADD_COPY[kind ?? "human"].title
      }
      description={
        token
          ? "It won’t be shown again. The agent sends it as a Bearer token to log work and report progress."
          : ADD_COPY[kind ?? "human"].description
      }
      footer={
        token ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim() || (kind === "human" && !email.trim())}
              busy={add.isPending}
              onClick={() => add.mutate()}
            >
              {kind === "agent" ? "Add agent" : "Send invite"}
            </Button>
          </>
        )
      }
    >
      <div {...stylex.props(styles.body)}>
        {token ? (
          <SecretField value={token} />
        ) : (
          <>
            <Field label="Name">
              {(id) => (
                <Input
                  id={id}
                  autoFocus
                  placeholder={kind === "agent" ? "Atlas" : "Grace Uwase"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            {kind === "human" && (
              <Field label="Email">
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
            )}
            <Field
              label="Handle"
              hint="Optional. Used for @mentions; made from the name if empty."
            >
              {(id) => (
                <Input
                  id={id}
                  placeholder="atlas"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase())}
                />
              )}
            </Field>
            <Field label="Role">
              {(id) => (
                <Input
                  id={id}
                  placeholder={
                    kind === "agent" ? "Coding agent" : "Product designer"
                  }
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              )}
            </Field>
            {kind === "agent" && (
              <Field
                label="Runs on"
                hint="Optional: Cursor, Claude Code, Codex…"
              >
                {(id) => (
                  <Input
                    id={id}
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  />
                )}
              </Field>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

const styles = stylex.create({
  icon: { color: color.fgMuted, flexShrink: 0 },
  here: { marginInlineStart: space.sm, verticalAlign: "1px" },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    paddingInline: space.xl,
    paddingBottom: space.xl,
  },
  scopes: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    borderWidth: 0,
    padding: 0,
    margin: 0,
  },
  legend: { fontSize: text.label, fontWeight: 500, marginBottom: space.sm },
  scope: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    cursor: "pointer",
  },
  scopeName: { fontSize: text.label, fontWeight: 500, width: 52 },
  secret: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  secretCode: {
    flexGrow: 1,
    fontFamily: "ui-monospace, monospace",
    fontSize: 12.5,
    overflowWrap: "anywhere",
    userSelect: "all",
  },
});
