import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { api, auth, unwrap } from "#api/client";
import { q } from "#api/queries";
import { Button } from "#ui/button";
import { ErrorNote, Skeleton } from "#ui/feedback";
import { color, text } from "#ui/tokens.stylex";

import { AuthFrame, authStyles } from "./frame";
import { signOut } from "./session";

/** Where an invite link lands: sign in with any account, then join as the person invited. */
export function Join({ code }: { code: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const invite = useQuery(q.invite(code));
  const session = useQuery({ ...q.session(), retry: false });
  const user = session.data?.user ?? null;
  const here = `/join/${code}`;

  const accept = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/invites/{code}/accept", {
          params: { path: { code } },
        })
      ),
    onSuccess: async ({ workspace }) => {
      auth.setWorkspace(workspace.id);
      client.clear();
      await navigate({ to: "/home" });
    },
  });

  if (invite.isPending || session.isPending) {
    return (
      <AuthFrame title="Opening your invite">
        <Skeleton lines={3} />
      </AuthFrame>
    );
  }
  if (!invite.data) {
    return (
      <AuthFrame
        title="This invite link doesn’t work any more"
        subtitle="Someone already joined with it, or a newer link replaced it. Ask whoever sent it for a fresh one."
        footer={
          <>
            Already in a workspace?{" "}
            <Link to="/login" {...stylex.props(authStyles.link)}>
              Sign in
            </Link>
          </>
        }
      >
        {null}
      </AuthFrame>
    );
  }

  const { name, workspace } = invite.data;
  return (
    <AuthFrame
      title={`Join ${workspace.name}`}
      legal
      subtitle={`You’re invited as ${name}. Sign in with any account, and it becomes ${name}’s in ${workspace.name}.`}
    >
      <div {...stylex.props(authStyles.form)}>
        {user ? (
          <>
            <Button
              variant="primary"
              busy={accept.isPending}
              onClick={() => accept.mutate()}
            >
              Join {workspace.name}
            </Button>
            <p {...stylex.props(styles.who)}>
              Signed in as {user.email}.{" "}
              <button
                type="button"
                onClick={() => {
                  void signOut(client).then(
                    async () =>
                      await navigate({ to: "/login", search: { next: here } })
                  );
                }}
                {...stylex.props(authStyles.link, styles.inline)}
              >
                Use another account
              </button>
            </p>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              void navigate({ to: "/login", search: { next: here } });
            }}
          >
            Sign in to join
          </Button>
        )}
        {accept.error && <ErrorNote error={accept.error} />}
      </div>
    </AuthFrame>
  );
}

const styles = stylex.create({
  who: { margin: 0, fontSize: text.meta, color: color.fgMuted },
  inline: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    font: "inherit",
    cursor: "pointer",
  },
});
