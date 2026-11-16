import { CopyIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { q } from "#api/queries";
import { Button } from "#ui/button";
import { ProductMark } from "#ui/product-mark";
import { color, radius, space, text } from "#ui/tokens.stylex";

/**
 * How a coding tool joins as someone's agent: they give it one URL, and the tool does the rest,
 * opening Worklog in their browser to approve it. Nothing to name, no key to paste; the tool says
 * what it is, and the agent appears with its own logo once it first calls.
 */
export function ConnectAgentSteps() {
  const config = useQuery(q.authConfig());
  const url = config.data?.mcpUrl ?? null;
  if (config.isPending) {
    return null;
  }
  if (url === null) {
    return (
      <p {...stylex.props(styles.note)}>
        Coding tools connect over HTTPS. Set this server’s{" "}
        <code {...stylex.props(styles.inline)}>PUBLIC_URL</code> to an{" "}
        <code {...stylex.props(styles.inline)}>https://</code> address to turn
        it on; until then, add an agent with an API key.
      </p>
    );
  }
  const cursor = `cursor://anysphere.cursor-deeplink/mcp/install?name=worklog&config=${encodeURIComponent(btoa(JSON.stringify({ url })))}`;
  const vscode = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "worklog", type: "http", url }))}`;
  return (
    <div {...stylex.props(styles.steps)}>
      <p {...stylex.props(styles.note)}>
        Add Worklog to your tool. It opens Worklog in your browser to ask you to
        approve it, then joins the team as your agent, reporting what it’s on
        and asking you when it needs a decision.
      </p>
      <div {...stylex.props(styles.buttons)}>
        <Button
          size="sm"
          icon={<ProductMark product="cursor" size={14} />}
          onClick={() => location.assign(cursor)}
        >
          Add to Cursor
        </Button>
        <Button
          size="sm"
          icon={<ProductMark product="copilot" size={14} />}
          onClick={() => location.assign(vscode)}
        >
          Add to VS Code
        </Button>
      </div>
      <Line
        label="Claude Code"
        value={`claude mcp add --transport http worklog ${url}`}
      />
      <Line label="Codex" value={`codex mcp add worklog --url ${url}`} />
      <Line label="Any other tool: add it as a remote MCP server" value={url} />
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div {...stylex.props(styles.line)}>
      <p {...stylex.props(styles.label)}>{label}</p>
      <div {...stylex.props(styles.copy)}>
        <code {...stylex.props(styles.code)}>{value}</code>
        <Button
          size="sm"
          variant="ghost"
          icon={<CopyIcon size={13} />}
          aria-label={`Copy: ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success("Copied");
          }}
        />
      </div>
    </div>
  );
}

const styles = stylex.create({
  steps: { display: "flex", flexDirection: "column", gap: space.lg },
  note: { fontSize: text.label, color: color.fgMuted },
  inline: { fontFamily: "ui-monospace, monospace", fontSize: 12 },
  buttons: { display: "flex", flexWrap: "wrap", gap: space.sm },
  line: { display: "flex", flexDirection: "column", gap: space.xs },
  label: { fontSize: text.meta, color: color.fgMuted },
  copy: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: space.xs,
    paddingInlineStart: space.md,
    paddingInlineEnd: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  code: {
    flexGrow: 1,
    minWidth: 0,
    fontFamily: "ui-monospace, monospace",
    fontSize: 12.5,
    overflowWrap: "anywhere",
  },
});
