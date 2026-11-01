import { CopyIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { ApiError, api, auth, unwrap } from "#api/client";
import { q } from "#api/queries";
import { AuthFrame, authStyles } from "#features/auth/frame";
import { Button } from "#ui/button";
import { ErrorNote } from "#ui/feedback";
import { Field, Input } from "#ui/field";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Set up · Worklog" }] }),
  ssr: false,
  component: Setup,
});

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Two doors: a signed-in person with no workspace creates one, and a brand-new server is set
 * up from scratch, which returns the owner's first API key.
 */
function Setup() {
  const session = useQuery({ ...q.session(), retry: false });
  const signedIn = Boolean(session.data?.user);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const client = useQueryClient();
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: { workspaceName: "", name: "", email: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        if (signedIn) {
          await unwrap(
            api.POST("/v1/workspaces", {
              body: { name: value.workspaceName, timezone: zone() },
            })
          );
          client.clear();
          await navigate({ to: "/home" });
          return;
        }
        const result = await unwrap(
          api.POST("/v1/setup", {
            body: {
              workspaceName: value.workspaceName,
              name: value.name,
              email: value.email,
              timezone: zone(),
            },
          })
        );
        auth.setKey(result.token.token);
        client.clear();
        setToken(result.token.token);
      } catch (error_) {
        setError(
          error_ instanceof ApiError && error_.status === 403
            ? new Error(
                "This server already has a workspace. Sign in, or ask its owner to invite you."
              )
            : error_
        );
      }
    },
  });

  if (token) {
    return (
      <AuthFrame
        title="Your workspace is ready"
        subtitle="This is your API key. Keep it somewhere safe: it won't be shown again. Agents and scripts use keys like it to log work."
      >
        <Input
          readOnly
          value={token}
          onFocus={(e) => e.target.select()}
          spellCheck={false}
        />
        <Button
          icon={<CopyIcon size={14} />}
          onClick={() => {
            void navigator.clipboard.writeText(token);
            toast.success("Copied");
          }}
        >
          Copy key
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            void navigate({ to: "/home" });
          }}
        >
          Open Worklog
        </Button>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title={signedIn ? "Create a workspace" : "Set up Worklog"}
      subtitle={
        signedIn
          ? "You're signed in but don't belong to a workspace yet. Start one, or ask a teammate to invite you."
          : "Create the first workspace on this server. You'll be its owner."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" {...stylex.props(authStyles.link)}>
            Sign in
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        {...stylex.props(authStyles.form)}
      >
        <form.Field
          name="workspaceName"
          validators={{
            onChange: ({ value }) =>
              value.trim() ? undefined : "Name your workspace",
          }}
        >
          {(field) => (
            <Field
              label="Workspace"
              error={
                field.state.meta.isTouched
                  ? field.state.meta.errors[0]
                  : undefined
              }
            >
              {(id) => (
                <Input
                  id={id}
                  placeholder="Umuganda Health"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  autoFocus
                />
              )}
            </Field>
          )}
        </form.Field>
        {!signedIn && (
          <>
            <form.Field
              name="name"
              validators={{
                onChange: ({ value }) =>
                  value.trim() ? undefined : "What should teammates call you?",
              }}
            >
              {(field) => (
                <Field
                  label="Your name"
                  error={
                    field.state.meta.isTouched
                      ? field.state.meta.errors[0]
                      : undefined
                  }
                >
                  {(id) => (
                    <Input
                      id={id}
                      autoComplete="name"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field name="email">
              {(field) => (
                <Field
                  label="Email"
                  hint="For sign-in links. Optional if you'll use the API key."
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="email"
                      autoComplete="email"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </form.Field>
          </>
        )}
        {error !== null && <ErrorNote error={error} />}
        <form.Subscribe
          selector={(s) => [s.canSubmit, s.isSubmitting] as const}
        >
          {([canSubmit, submitting]) => (
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit}
              busy={submitting}
            >
              {signedIn ? "Create workspace" : "Create workspace and key"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthFrame>
  );
}
