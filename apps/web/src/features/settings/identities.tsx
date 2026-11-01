import { FingerprintIcon, RobotIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { SourceName } from "#features/activity/activity-line";
import { useMembers } from "#features/cards/card-bits";
import { agoPhrase } from "#lib/time";
import { Avatar } from "#ui/avatar";
import { Badge } from "#ui/chip";
import { EmptyState, Skeleton } from "#ui/feedback";
import { Segmented, Select } from "#ui/field";
import { color, radius, space, text } from "#ui/tokens.stylex";

import { Card, SettingsPage, settingsStyles } from "./frame";

type Identity = Schemas["Identity"];

/**
 * Accounts in connected tools that Worklog couldn't tie to a member. Their work shows up as
 * "Someone" until linked; linking credits the past activity too.
 */
export function Identities() {
  const [show, setShow] = useState<"unlinked" | "all">("unlinked");
  const identities = useQuery(q.allIdentities(show === "unlinked"));
  const list = (identities.data ?? []).toSorted(
    (a, b) => b.eventCount - a.eventCount
  );
  return (
    <SettingsPage
      title="People in your tools"
      description="GitHub, GitLab, Slack and Discord accounts, and who they belong to. Linking one credits everything it did, past and future, to that person."
      actions={
        <Segmented
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            { value: "unlinked", label: "Unlinked" },
            { value: "all", label: "All" },
          ]}
        />
      }
    >
      <Card>
        {identities.isPending && (
          <div {...stylex.props(settingsStyles.pad)}>
            <Skeleton lines={4} />
          </div>
        )}
        {identities.isSuccess && list.length === 0 && (
          <EmptyState
            icon={<FingerprintIcon size={20} />}
            title={
              show === "unlinked" ? "Everyone is linked" : "No accounts yet"
            }
          >
            {show === "unlinked"
              ? "Every account that has done something is credited to a member."
              : "Accounts appear as connected tools send activity."}
          </EmptyState>
        )}
        <ul {...stylex.props(settingsStyles.list)}>
          {list.map((identity) => (
            <IdentityRow key={identity.id} identity={identity} />
          ))}
        </ul>
      </Card>
    </SettingsPage>
  );
}

function IdentityRow({ identity }: { identity: Identity }) {
  const { list: members, byId } = useMembers();
  const client = useQueryClient();
  const owner = identity.memberId ? byId.get(identity.memberId) : undefined;
  const assign = useMutation({
    mutationFn: async (member: string | null) =>
      await unwrap(
        api.PATCH("/v1/identities/{id}", {
          params: { path: { id: identity.id } },
          body: { member },
        })
      ),
    onSuccess: (result, member) => {
      void client.invalidateQueries({ queryKey: ["identities"] });
      void client.invalidateQueries({ queryKey: ["activities"] });
      const who = member ? (byId.get(member)?.name ?? "them") : null;
      toast.success(
        who
          ? `Linked to ${who}. ${result.reattributed} past ${result.reattributed === 1 ? "activity" : "activities"} now credited.`
          : "Unlinked"
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const name =
    identity.displayName ?? identity.externalHandle ?? identity.externalId;
  return (
    <li {...stylex.props(settingsStyles.listRow)}>
      <span {...stylex.props(styles.source)}>
        <SourceName
          source={identity.provider.split(":")[0] ?? identity.provider}
        />
      </span>
      <div {...stylex.props(settingsStyles.main)}>
        <p {...stylex.props(settingsStyles.strong)}>
          {name}
          {identity.isBot && (
            <Badge icon={<RobotIcon size={11} />} sx={styles.bot}>
              bot
            </Badge>
          )}
        </p>
        <p {...stylex.props(settingsStyles.sub)}>
          {identity.externalHandle && identity.externalHandle !== name
            ? `@${identity.externalHandle} · `
            : ""}
          {identity.eventCount} {identity.eventCount === 1 ? "event" : "events"}
          {identity.lastSeenAt
            ? ` · last seen ${agoPhrase(identity.lastSeenAt)}`
            : ""}
        </p>
      </div>
      {owner && <Avatar person={owner} size={22} />}
      <Select
        aria-label={`Who is ${name}?`}
        value={identity.memberId ?? ""}
        disabled={assign.isPending}
        onChange={(e) => assign.mutate(e.target.value || null)}
        sx={styles.select}
      >
        <option value="">Not linked</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.kind === "agent" ? " (agent)" : ""}
          </option>
        ))}
      </Select>
    </li>
  );
}

const styles = stylex.create({
  source: {
    display: "inline-flex",
    justifyContent: "center",
    flexShrink: 0,
    minWidth: 76,
    paddingBlock: 2,
    paddingInline: space.sm,
    borderRadius: radius.xs,
    fontSize: text.caption,
    fontWeight: 600,
    textAlign: "center",
    color: color.fgMuted,
    backgroundColor: color.ui,
  },
  bot: { marginInlineStart: space.sm },
  select: { width: 180, flexShrink: 0 },
});
