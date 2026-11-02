import {
  AlarmIcon,
  ArrowsLeftRightIcon,
  BinocularsIcon,
  BookOpenIcon,
  BookmarkSimpleIcon,
  BrainIcon,
  CalendarDotsIcon,
  CardsIcon,
  CaretRightIcon,
  ChatCenteredTextIcon,
  ChatCircleIcon,
  CheckSquareIcon,
  HourglassMediumIcon,
  EraserIcon,
  MagnifyingGlassIcon,
  NoteIcon,
  NotePencilIcon,
  PlusSquareIcon,
  PulseIcon,
  ThumbsUpIcon,
  TrayIcon,
  UserFocusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { UIMessage } from "ai";
import type { ComponentType } from "react";
import { useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { SourceGlyph } from "#features/activity/activity-line";
import type { Member } from "#features/cards/card-bits";
import { Logo } from "#features/shell/logo";
import { ago } from "#lib/time";
import { Button } from "#ui/button";
import { Markdown } from "#ui/markdown";
import {
  color,
  font,
  leading,
  media,
  motion,
  radius,
  space,
  text,
} from "#ui/tokens.stylex";

import { ASKS, describe, summarize } from "./tool-words";

/** One thing the assistant did on the way to a reply, live or from the stored transcript. */
export type Step =
  | { kind: "thought"; text: string; live: boolean }
  | {
      kind: "tool";
      tool: string;
      input: unknown;
      status: "running" | "done" | "failed";
      count: number | null;
      /** A write held back for the owner's Allow: the attention item that asks. */
      approvalId: string | null;
      /** What a lookup found, as references to show and open. */
      found: Found[];
      output?: unknown;
      error?: string;
    };

type StoredStep = Schemas["MessageStep"];
type Found = Schemas["StepFound"];

// As many as the server keeps on a stored step, so a reply looks the same before and after.
const FOUND_SHOWN = 8;

export function storedSteps(steps: StoredStep[]): Step[] {
  return steps.map((step) =>
    step.kind === "thought"
      ? { kind: "thought", text: step.text, live: false }
      : {
          kind: "tool",
          tool: step.tool,
          input: step.input,
          status: step.ok ? "done" : "failed",
          count: step.count,
          approvalId: step.approvalId,
          found: step.found,
        }
  );
}

type ToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const STATUS: Record<string, "done" | "failed"> = {
  "output-available": "done",
  "output-error": "failed",
};

function foundIn(output: unknown): Found[] {
  const items: unknown[] = Array.isArray(output) ? output : [output];
  return items.slice(0, FOUND_SHOWN).flatMap((item): Found[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const read = (key: string): unknown =>
      Object.getOwnPropertyDescriptor(item, key)?.value;
    const word = (key: string) => {
      const value = read(key);
      return typeof value === "string" ? value : null;
    };
    const title = word("title");
    const number = read("number");
    return title === null
      ? []
      : [
          {
            title,
            number: typeof number === "number" ? number : null,
            at: word("at"),
            source: word("source"),
            url: word("url"),
          },
        ];
  });
}

// The review returns `{ blocked: true, approvalId }` in place of a write it held back.
function heldFor(output: unknown) {
  if (typeof output !== "object" || output === null) {
    return null;
  }
  const blocked: unknown = Object.getOwnPropertyDescriptor(
    output,
    "blocked"
  )?.value;
  const id: unknown = Object.getOwnPropertyDescriptor(
    output,
    "approvalId"
  )?.value;
  const proposed: unknown = Object.getOwnPropertyDescriptor(
    output,
    "proposed"
  )?.value;
  // A proposed routine waits on the same Allow as a held write.
  return (blocked === true || proposed === true) && typeof id === "string"
    ? id
    : null;
}

/** The steps in a reply as it streams: reasoning and tool calls, in the order they happened. */
export function liveSteps(parts: UIMessage["parts"]): Step[] {
  const steps: Step[] = [];
  for (const part of parts) {
    if (part.type === "reasoning") {
      if (part.text.trim()) {
        steps.push({
          kind: "thought",
          text: part.text,
          live: part.state === "streaming",
        });
      }
    } else if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
      const tool = part as ToolPart;
      steps.push({
        kind: "tool",
        tool: tool.toolName ?? tool.type.replace(/^tool-/u, ""),
        input: tool.input,
        status: STATUS[tool.state ?? ""] ?? "running",
        count: Array.isArray(tool.output) ? tool.output.length : null,
        approvalId: heldFor(tool.output),
        found: foundIn(tool.output),
        output: tool.output,
        error: tool.errorText,
      });
    }
  }
  return steps;
}

// Writes change the record, so they stay in view as their own lines; only lookups fold away.
const WRITES = new Set([
  "remember",
  "forget",
  "follow_up",
  "log_work",
  "create_card",
  "move_card",
  "comment_on_card",
  "answer_attention",
  "resolve_attention",
  "attention_feedback",
  "propose_routine",
  "leave_note_for_owner",
]);

const isWrite = (step: Step) => step.kind === "tool" && WRITES.has(step.tool);

/**
 * The work behind a reply. While the assistant works, each step shows as it happens; once it
 * answers, the lookups fold into one line ("Checked 3 things · 4s") that opens on a click, and
 * anything it changed stays in view, because that is the record.
 */
export function WorkLog({
  steps,
  working,
  answering,
  seconds,
  people,
}: {
  steps: Step[];
  /** Still on this turn: the last step may be in progress. */
  working: boolean;
  /** The reply text has started, so the lookups fold away. */
  answering: boolean;
  /** How long the work took, when this page watched it happen. */
  seconds?: number;
  people: Map<string, Member>;
}) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) {
    return null;
  }
  if (working && !answering) {
    return (
      <ol {...stylex.props(styles.steps)}>
        {steps.map((step, i) => (
          <StepRow key={i} step={step} people={people} />
        ))}
      </ol>
    );
  }
  const reads = steps.filter((step) => !isWrite(step));
  const writes = steps.filter(isWrite);
  return (
    <div {...stylex.props(styles.log)}>
      {reads.length > 0 && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          {...stylex.props(styles.summary)}
        >
          <span {...stylex.props(styles.summaryText)}>
            {summarize(reads, people)}
          </span>
          {seconds !== undefined && seconds >= 1 && (
            <span {...stylex.props(styles.summaryTime)}>
              · {formatSeconds(seconds)}
            </span>
          )}
          <CaretRightIcon
            size={11}
            weight="bold"
            {...stylex.props(styles.caret, open && styles.caretOpen)}
          />
        </button>
      )}
      {open && (
        <ol {...stylex.props(styles.steps)}>
          {reads.map((step, i) => (
            <StepRow key={i} step={step} people={people} />
          ))}
        </ol>
      )}
      {writes.length > 0 && (
        <ol {...stylex.props(styles.steps)}>
          {writes.map((step, i) => (
            <StepRow key={i} step={step} people={people} />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepRow({
  step,
  people,
}: {
  step: Step;
  people: Map<string, Member>;
}) {
  return step.kind === "thought" ? (
    <Thought step={step} />
  ) : (
    <ToolRow step={step} people={people} />
  );
}

/** Reasoning stays folded, even while it streams: the reply is what people came for. */
function Thought({ step }: { step: Extract<Step, { kind: "thought" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <li {...stylex.props(styles.step)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        {...stylex.props(styles.stepHead)}
      >
        <span {...stylex.props(styles.icon)}>
          <BrainIcon size={14} />
        </span>
        <span {...stylex.props(styles.label, step.live && styles.shimmer)}>
          {step.live ? "Thinking…" : "Thought it through"}
        </span>
        <CaretRightIcon
          size={11}
          weight="bold"
          {...stylex.props(
            styles.caret,
            styles.rowCaret,
            open && styles.caretOpen
          )}
        />
      </button>
      {open && <p {...stylex.props(styles.thoughtText)}>{step.text}</p>}
    </li>
  );
}

// Memory changes are the ones people most want to check, so they link to the memory page.
const MEMORY_WRITES = new Set(["remember", "forget"]);

const ICONS: Record<string, ComponentType<IconProps>> = {
  search_activity: PulseIcon,
  search_cards: MagnifyingGlassIcon,
  get_card: CardsIcon,
  work_snapshot: UserFocusIcon,
  team_directory: UsersThreeIcon,
  my_attention: TrayIcon,
  recall: BookOpenIcon,
  remember: BookmarkSimpleIcon,
  forget: EraserIcon,
  follow_up: AlarmIcon,
  look_into: BinocularsIcon,
  log_work: NotePencilIcon,
  create_card: PlusSquareIcon,
  move_card: ArrowsLeftRightIcon,
  comment_on_card: ChatCenteredTextIcon,
  answer_attention: ChatCircleIcon,
  resolve_attention: CheckSquareIcon,
  attention_feedback: ThumbsUpIcon,
  propose_routine: CalendarDotsIcon,
  leave_note_for_owner: NoteIcon,
};

function ToolRow({
  step,
  people,
}: {
  step: Extract<Step, { kind: "tool" }>;
  people: Map<string, Member>;
}) {
  const [open, setOpen] = useState(false);
  if (step.approvalId !== null) {
    return <HeldRow step={step} approvalId={step.approvalId} people={people} />;
  }
  const Icon = ICONS[step.tool] ?? WrenchIcon;
  const failed = step.status === "failed";
  const running = step.status === "running";
  const hasDetail = step.input !== undefined || step.output !== undefined;
  return (
    <li {...stylex.props(styles.step)}>
      <button
        type="button"
        aria-expanded={open}
        disabled={!hasDetail}
        onClick={() => setOpen(!open)}
        {...stylex.props(styles.stepHead)}
      >
        <span {...stylex.props(styles.icon, failed && styles.iconFailed)}>
          {failed ? <WarningCircleIcon size={14} /> : <Icon size={14} />}
        </span>
        <span {...stylex.props(styles.label, running && styles.shimmer)}>
          {describe(step, people)}
          {running && "…"}
        </span>
        {step.status === "done" && step.count !== null && (
          <span {...stylex.props(styles.count)}>
            {step.count === 1 ? "1 result" : `${step.count} results`}
          </span>
        )}
        {failed && (
          <span {...stylex.props(styles.count, styles.failed)}>
            didn’t work
          </span>
        )}
        {hasDetail && (
          <CaretRightIcon
            size={11}
            weight="bold"
            {...stylex.props(
              styles.caret,
              styles.rowCaret,
              open && styles.caretOpen
            )}
          />
        )}
      </button>
      {step.status === "done" && MEMORY_WRITES.has(step.tool) && (
        <Link to="/settings/memory" {...stylex.props(styles.memoryLink)}>
          See what it remembers
        </Link>
      )}
      {open && <ToolDetail step={step} />}
    </li>
  );
}

/**
 * A write teammates would see that the review held back: it waits here and in the inbox for the
 * owner's Allow or Deny, and a tap runs exactly what was proposed.
 */
function HeldRow({
  step,
  approvalId,
  people,
}: {
  step: Extract<Step, { kind: "tool" }>;
  approvalId: string;
  people: Map<string, Member>;
}) {
  const client = useQueryClient();
  // Asked by id: the open list is capped and leaves out snoozed items, both still waiting.
  const request = useQuery(q.attentionItem(approvalId));
  const [answer, setAnswer] = useState<"allow" | "deny" | null>(null);
  const act = useMutation({
    mutationFn: async (actionId: "allow" | "deny") =>
      await unwrap(
        api.POST("/v1/attention/{id}/actions/{actionId}", {
          params: { path: { id: approvalId, actionId } },
        })
      ),
    onMutate: (actionId) => setAnswer(actionId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["attention"] });
      void client.invalidateQueries({ queryKey: ["cards"] });
    },
    onError: (error) => {
      setAnswer(null);
      toast.error(error.message);
    },
  });
  const waiting =
    answer === null &&
    (request.data?.state === "open" || request.data?.state === "snoozed");
  // Until the request is read, the row claims neither way; one that's gone was dealt with.
  const settled =
    answer !== null ||
    request.isError ||
    (request.data !== undefined && !waiting);
  const what =
    ASKS[step.tool]?.(step.input) ?? describe(step, people).toLowerCase();
  let status = "answered in your inbox";
  if (answer === "allow") {
    status = "you allowed it";
  } else if (answer === "deny") {
    status = "you declined it";
  }
  return (
    <li {...stylex.props(styles.step)}>
      <div {...stylex.props(styles.held, waiting && styles.heldWaiting)}>
        <span {...stylex.props(styles.icon, waiting && styles.iconHeld)}>
          <HourglassMediumIcon size={14} />
        </span>
        <span {...stylex.props(styles.heldText, settled && styles.heldDone)}>
          {settled ? "Asked for your OK to" : "Wants your OK to"} {what}
          {settled && (
            <span {...stylex.props(styles.heldStatus)}> · {status}</span>
          )}
        </span>
        {waiting && (
          <span {...stylex.props(styles.heldActions)}>
            <Button
              size="sm"
              variant="primary"
              onClick={() => act.mutate("allow")}
            >
              Allow
            </Button>
            <Button size="sm" onClick={() => act.mutate("deny")}>
              Deny
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

/** What the tool was asked and what came back, as fields; the raw JSON is one click further. */
function ToolDetail({ step }: { step: Extract<Step, { kind: "tool" }> }) {
  const [raw, setRaw] = useState(false);
  const fields = fieldsOf(step.input);
  return (
    <div {...stylex.props(styles.detail)}>
      {fields.length > 0 && (
        <dl {...stylex.props(styles.fields)}>
          {fields.map(([key, value]) => (
            <div key={key} {...stylex.props(styles.field)}>
              <dt {...stylex.props(styles.fieldKey)}>{humanize(key)}</dt>
              <dd {...stylex.props(styles.fieldValue)}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {step.error && <p {...stylex.props(styles.errorText)}>{step.error}</p>}
      {reportOf(step.output) && (
        <div>
          <span {...stylex.props(styles.detailLabel)}>The helper’s report</span>
          <Markdown size="label">{reportOf(step.output) ?? ""}</Markdown>
        </div>
      )}
      {step.found.length > 0 && (
        <ul aria-label="What it found" {...stylex.props(styles.found)}>
          {step.found.map((item, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- found items have no ids, and the list never changes order
            <li key={i}>
              <FoundRow item={item} />
            </li>
          ))}
          {step.count !== null && step.count > step.found.length && (
            <li {...stylex.props(styles.foundMore)}>
              and {step.count - step.found.length} more
            </li>
          )}
        </ul>
      )}
      {raw && (
        <>
          <Detail label="Asked" value={step.input} />
          {step.output !== undefined && (
            <Detail label="Found" value={step.output} />
          )}
        </>
      )}
      <button
        type="button"
        onClick={() => setRaw(!raw)}
        {...stylex.props(styles.rawToggle)}
      >
        {raw ? "Hide raw" : "Show raw"}
      </button>
    </div>
  );
}

/** One thing a lookup found: a card opens over the page, an event links to where it happened. */
function FoundRow({ item }: { item: Found }) {
  const { number } = item;
  if (number !== null) {
    return (
      <Link
        to="."
        search={(prev: Record<string, unknown>) => ({ ...prev, card: number })}
        {...stylex.props(styles.foundItem)}
      >
        <span {...stylex.props(styles.foundNumber)}>#{number}</span>
        <span {...stylex.props(styles.foundTitle)}>{item.title}</span>
      </Link>
    );
  }
  const body = (
    <>
      <span {...stylex.props(styles.foundMark)}>
        {item.source === null || item.source === "worklog" ? (
          <Logo size={12} />
        ) : (
          <SourceGlyph source={item.source} size={12} />
        )}
      </span>
      <span {...stylex.props(styles.foundTitle)}>{item.title}</span>
      {item.at && (
        <time dateTime={item.at} {...stylex.props(styles.foundTime)}>
          {ago(item.at)}
        </time>
      )}
    </>
  );
  return item.url ? (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      {...stylex.props(styles.foundItem)}
    >
      {body}
    </a>
  ) : (
    <span {...stylex.props(styles.foundItem)}>{body}</span>
  );
}

// `look_into` hands a question to a helper and gets a short report back.
function reportOf(output: unknown) {
  const report: unknown =
    typeof output === "object" && output !== null
      ? Object.getOwnPropertyDescriptor(output, "report")?.value
      : undefined;
  return typeof report === "string" ? report : null;
}

function fieldsOf(input: unknown): [string, string][] {
  if (typeof input !== "object" || input === null) {
    return [];
  }
  return Object.entries(input).flatMap(([key, value]): [string, string][] => {
    if (typeof value === "string" || typeof value === "number") {
      return [[key, String(value)]];
    }
    if (typeof value === "boolean") {
      return [[key, value ? "Yes" : "No"]];
    }
    return [];
  });
}

function humanize(key: string) {
  const words = key
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>")
    .replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function Detail({ label, value }: { label: string; value: unknown }) {
  const shown =
    typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  return (
    <div>
      <span {...stylex.props(styles.detailLabel)}>{label}</span>
      <pre {...stylex.props(styles.detailBody)}>
        {shown.length > 4000 ? `${shown.slice(0, 4000)}\n…` : shown}
      </pre>
    </div>
  );
}

function formatSeconds(seconds: number) {
  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.45 },
});

const styles = stylex.create({
  log: { display: "flex", flexDirection: "column", gap: space.xs, minWidth: 0 },
  summary: {
    alignSelf: "flex-start",
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    maxWidth: "100%",
    minHeight: 24,
    paddingInline: 0,
    fontSize: text.label,
    lineHeight: leading.label,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: "transparent",
    borderWidth: 0,
    cursor: "pointer",
    textAlign: "start",
  },
  summaryText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  summaryTime: {
    flexShrink: 0,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  caret: {
    flexShrink: 0,
    color: color.fgFaint,
    transitionProperty: "transform",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.out,
  },
  caretOpen: { transform: "rotate(90deg)" },
  rowCaret: {
    opacity: { default: 0, ":is(button:hover *, button:focus-visible *)": 1 },
  },
  steps: {
    display: "flex",
    flexDirection: "column",
    gap: space.xxs,
    margin: 0,
    paddingBlock: space.xs,
    paddingInlineStart: space.md,
    listStyle: "none",
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: color.line,
  },
  step: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    minWidth: 0,
  },
  stepHead: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    width: "100%",
    minHeight: 24,
    paddingInline: space.xs,
    borderRadius: radius.sm,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
    textAlign: "start",
    backgroundColor: {
      default: "transparent",
      ":hover:not(:disabled)": { default: null, [media.hover]: color.ui },
    },
    borderWidth: 0,
    cursor: { default: "pointer", ":disabled": "default" },
  },
  icon: {
    display: "inline-flex",
    flexShrink: 0,
    color: color.fgFaint,
  },
  iconFailed: { color: color.redFg },
  iconHeld: { color: color.amberFg },
  held: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.sm,
    minHeight: 36,
    paddingBlock: space.xs,
    paddingInline: space.sm,
    borderRadius: radius.md,
  },
  heldWaiting: { backgroundColor: color.amberSubtle },
  heldDone: { color: color.fgMuted },
  heldStatus: { color: color.fgFaint },
  heldText: {
    flexGrow: 1,
    minWidth: 0,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fg,
  },
  heldActions: { display: "flex", gap: space.xs },
  label: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  count: {
    flexShrink: 0,
    fontSize: text.meta,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  failed: { color: color.redFg },
  shimmer: {
    animationName: pulse,
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  thoughtText: {
    margin: 0,
    paddingInlineStart: 25,
    paddingInlineEnd: space.md,
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fgMuted,
    whiteSpace: "pre-wrap",
    textWrap: "pretty",
  },
  fields: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    columnGap: space.lg,
    rowGap: space.xs,
    margin: 0,
  },
  field: { display: "contents" },
  fieldKey: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgFaint,
  },
  fieldValue: {
    margin: 0,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fg,
    overflowWrap: "anywhere",
  },
  errorText: {
    margin: 0,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.redFg,
  },
  found: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  foundItem: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    minHeight: 24,
    paddingInline: space.xs,
    marginInline: `calc(-1 * ${space.xs})`,
    borderRadius: radius.sm,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fg,
    textDecoration: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
  },
  foundNumber: {
    flexShrink: 0,
    fontFamily: font.mono,
    fontSize: text.caption,
    color: color.fgFaint,
  },
  foundMark: { display: "inline-flex", flexShrink: 0, color: color.fgMuted },
  foundTitle: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  foundTime: {
    flexShrink: 0,
    color: color.fgFaint,
    fontVariantNumeric: "tabular-nums",
  },
  foundMore: {
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgFaint,
  },
  rawToggle: {
    alignSelf: "flex-start",
    padding: 0,
    borderWidth: 0,
    fontSize: text.caption,
    lineHeight: leading.caption,
    color: {
      default: color.fgFaint,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  memoryLink: {
    alignSelf: "flex-start",
    marginInlineStart: 25,
    fontSize: text.meta,
    color: color.accentFg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
  },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    marginInlineStart: 25,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    boxShadow: `inset 0 0 0 1px ${color.line}`,
  },
  detailLabel: {
    fontSize: text.caption,
    lineHeight: leading.caption,
    fontWeight: 500,
    color: color.fgFaint,
  },
  detailBody: {
    margin: 0,
    maxHeight: 220,
    overflow: "auto",
    fontFamily: font.mono,
    fontSize: text.caption,
    lineHeight: leading.caption,
    color: color.fgMuted,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});
