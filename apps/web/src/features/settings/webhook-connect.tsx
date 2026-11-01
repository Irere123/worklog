import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { Button } from "#ui/button";
import { Field, Input, Select, Textarea } from "#ui/field";
import { Dialog } from "#ui/overlay";
import { color, font, space, text } from "#ui/tokens.stylex";

type Verify = "token" | "hmac-sha256" | "standard-webhooks";

const VERIFY: { value: Verify; label: string; header: string }[] = [
  {
    value: "token",
    label: "Shared token in a header",
    header: "X-Webhook-Token",
  },
  {
    value: "hmac-sha256",
    label: "HMAC-SHA256 signature",
    header: "X-Signature",
  },
  {
    value: "standard-webhooks",
    label: "Standard Webhooks (Svix, GitLab 19+)",
    header: "",
  },
];

// A working starting point: one rule that turns a "deploy" event into activity. People edit it to
// match their tool's payload; the docs list every field a rule can use.
const STARTER = `[
  {
    "when": { "eventType": "deploy" },
    "emit": {
      "kind": "deploy.finished",
      "id": "deploy:{{id}}",
      "title": "Deployed {{service}} to {{environment}}",
      "url": "{{url}}",
      "actor": { "id": "{{user.id}}", "name": "{{user.name}}" }
    }
  }
]`;

function parseRules(source: string): { rules: unknown[] } | { error: string } {
  try {
    const parsed: unknown = JSON.parse(source);
    return Array.isArray(parsed)
      ? { rules: parsed }
      : { error: "Rules must be a JSON list: [ { … } ]" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Not valid JSON" };
  }
}

/**
 * The no-code connector: how the tool proves a delivery is real, where to find the event type, and
 * rules that map its payload to activity. Rules are JSON because they are a mapping, not a form.
 */
export function WebhookConnectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("Webhook");
  const [verify, setVerify] = useState<Verify>("token");
  const [header, setHeader] = useState("X-Webhook-Token");
  const [secret, setSecret] = useState("");
  const [eventHeader, setEventHeader] = useState("X-Event-Type");
  const [deliveryHeader, setDeliveryHeader] = useState("");
  const [rules, setRules] = useState(STARTER);
  const parsed = parseRules(rules);
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async () => {
      if ("error" in parsed) {
        throw new Error(parsed.error);
      }
      return await unwrap(
        api.POST("/v1/connections", {
          body: {
            provider: "webhook",
            name: name.trim(),
            secrets: { secret: secret.trim() },
            settings: {
              verify:
                verify === "standard-webhooks"
                  ? { type: verify }
                  : { type: verify, header: header.trim() },
              eventType: eventHeader.trim()
                ? { header: eventHeader.trim() }
                : undefined,
              deliveryId: deliveryHeader.trim()
                ? { header: deliveryHeader.trim() }
                : undefined,
              rules: parsed.rules,
            },
          },
        })
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["connections"] });
      toast.success(
        `${name.trim()} connected. Copy its URL from the connection page.`
      );
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="Connect a webhook"
      description="Any tool that can send a signed webhook: CI, deploys, Sentry, a self-hosted forge."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !secret.trim() || "error" in parsed}
            busy={create.isPending}
            onClick={() => create.mutate()}
          >
            Connect
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.form)}>
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <div {...stylex.props(styles.two)}>
          <Field label="How deliveries are signed">
            {(id) => (
              <Select
                id={id}
                value={verify}
                onValueChange={(next) => {
                  setVerify(next);
                  setHeader(
                    VERIFY.find((v) => v.value === next)?.header ?? header
                  );
                }}
                options={VERIFY}
              />
            )}
          </Field>
          {verify !== "standard-webhooks" && (
            <Field label="Signature header">
              {(id) => (
                <Input
                  id={id}
                  value={header}
                  onChange={(e) => setHeader(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
        <Field
          label="Secret"
          hint="The same value you paste into the tool’s webhook settings."
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          )}
        </Field>
        <div {...stylex.props(styles.two)}>
          <Field label="Event type header" hint="Optional. Rules match on it.">
            {(id) => (
              <Input
                id={id}
                value={eventHeader}
                onChange={(e) => setEventHeader(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Delivery id header"
            hint="Optional. Lets retries be recognised."
          >
            {(id) => (
              <Input
                id={id}
                value={deliveryHeader}
                placeholder="X-Delivery-Id"
                onChange={(e) => setDeliveryHeader(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field
          label="Rules"
          hint={
            "error" in parsed
              ? undefined
              : "Each rule says when it applies and what activity to record. {{path}} reads from the payload."
          }
          error={"error" in parsed ? parsed.error : undefined}
        >
          {(id) => (
            <Textarea
              id={id}
              spellCheck={false}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              sx={styles.rules}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    paddingInline: space.xl,
    paddingBottom: space.xl,
    overflowY: "auto",
  },
  two: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 1fr",
      "@media (max-width: 640px)": "1fr",
    },
    gap: space.md,
  },
  rules: {
    minHeight: 220,
    fontFamily: font.mono,
    fontSize: text.meta,
    lineHeight: 1.55,
    color: color.fg,
  },
});
