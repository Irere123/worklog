import { CaretDownIcon, NewspaperIcon, PlusIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { exactTime, shortDay } from "#lib/time";
import { Button } from "#ui/button";
import { Badge } from "#ui/chip";
import { EmptyState, ErrorNote, Skeleton } from "#ui/feedback";
import { Ghost } from "#ui/ghost";
import { PageHeader, layout } from "#ui/layout";
import { Markdown } from "#ui/markdown";
import { Menu, MenuItem } from "#ui/overlay";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

const dateLong = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Briefs are finite and dated: a page you finish, not a feed you scroll. */
export function Briefs({ selectedId }: { selectedId?: string }) {
  const briefs = useQuery(q.briefs());
  const list = briefs.data ?? [];
  const selected = list.find((b) => b.id === selectedId) ?? list[0];
  const client = useQueryClient();
  const navigate = useNavigate();
  const make = useMutation({
    mutationFn: async (period: "daily" | "weekly") =>
      await unwrap(api.POST("/v1/briefs", { body: { period } })),
    onSuccess: (brief) => {
      void client.invalidateQueries({ queryKey: ["briefs"] });
      void navigate({ to: "/briefs", search: { id: brief.id } });
      toast.success("Your brief is ready");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader
        title="Briefs"
        actions={
          <Menu
            align="end"
            trigger={
              <Button
                size="sm"
                variant="primary"
                icon={<PlusIcon size={14} />}
                trailing={<CaretDownIcon size={13} />}
                busy={make.isPending}
              >
                Make one now
              </Button>
            }
          >
            <MenuItem onClick={() => make.mutate("daily")}>
              Today so far
            </MenuItem>
            <MenuItem onClick={() => make.mutate("weekly")}>This week</MenuItem>
          </Menu>
        }
      />
      <div {...stylex.props(styles.split)}>
        <nav
          aria-label="Briefs"
          {...stylex.props(styles.list, briefs.isPending && styles.listPending)}
        >
          {briefs.isPending && <Skeleton lines={5} height={40} />}
          {briefs.isError && <ErrorNote error={briefs.error} />}
          {list.map((brief) => (
            <Link
              key={brief.id}
              to="/briefs"
              search={{ id: brief.id }}
              {...stylex.props(
                styles.item,
                brief.id === selected?.id && styles.itemOn
              )}
            >
              <span {...stylex.props(styles.itemDate)}>
                {shortDay(brief.periodStart)} ·{" "}
                {brief.period === "daily" ? "Daily" : "Weekly"}
              </span>
              <span {...stylex.props(styles.itemTitle)}>{brief.title}</span>
            </Link>
          ))}
        </nav>
        <div {...stylex.props(styles.reader)}>
          {briefs.isSuccess && list.length === 0 && (
            <EmptyState
              icon={<NewspaperIcon size={20} />}
              title="No briefs yet"
              action={
                <Button
                  variant="primary"
                  onClick={() => make.mutate("daily")}
                  busy={make.isPending}
                >
                  Make today’s brief
                </Button>
              }
            >
              Briefs gather what changed, what shipped and what’s waiting on
              you. Schedule them in Settings → Automations.
            </EmptyState>
          )}
          {selected && (
            <article {...stylex.props(styles.article)}>
              <header {...stylex.props(styles.articleHead)}>
                <div {...stylex.props(layout.row)}>
                  <Badge
                    tone={selected.period === "daily" ? "accent" : "violet"}
                  >
                    {selected.period === "daily"
                      ? "Daily brief"
                      : "Weekly brief"}
                  </Badge>
                  {selected.composedBy !== "template" && (
                    <Badge icon={<Ghost size={14} still tinted />}>
                      Written by your assistant
                    </Badge>
                  )}
                </div>
                <h1 {...stylex.props(styles.title)}>{selected.title}</h1>
                <p
                  {...stylex.props(styles.when)}
                  title={exactTime(selected.createdAt)}
                >
                  {dateLong.format(new Date(selected.periodStart))}
                </p>
              </header>
              <BriefNumbers data={selected.data} />
              <Markdown>{selected.body}</Markdown>
              <footer {...stylex.props(styles.end)}>
                <span>That’s everything for this brief.</span>
                <Link
                  to="/assistant"
                  search={{
                    ask: `About “${selected.title}”: what matters most in it for me, and what should I do first?`,
                  }}
                  {...stylex.props(styles.ask)}
                >
                  Ask your assistant about it
                </Link>
              </footer>
            </article>
          )}
        </div>
      </div>
    </>
  );
}

type Data = Record<string, unknown>;

function lengthAt(data: Data, ...path: string[]) {
  let value: unknown = data;
  for (const key of path) {
    value =
      typeof value === "object" && value !== null
        ? (Reflect.get(value, key) as unknown)
        : undefined;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  return typeof value === "number" ? value : null;
}

/**
 * The numbers the brief was written from, read before the prose: how much needs you, how much
 * moved. Missing fields simply don't show, so older briefs still render.
 */
function BriefNumbers({ data }: { data: Data }) {
  const stats = [
    {
      label: "Need you",
      value: lengthAt(data, "needsAttention"),
      tone: styles.statAccent,
    },
    { label: "In progress", value: lengthAt(data, "inProgress") },
    { label: "Closed", value: lengthAt(data, "board", "closed") },
    { label: "New in Maybe?", value: lengthAt(data, "board", "newInMaybe") },
    {
      label: "Drifting soon",
      value: lengthAt(data, "driftingSoon"),
      tone: styles.statWarn,
    },
  ].filter((s) => s.value !== null);
  if (stats.length === 0) {
    return null;
  }
  return (
    <dl {...stylex.props(styles.stats)}>
      {stats.map((s) => (
        <div key={s.label} {...stylex.props(styles.stat)}>
          <dd
            {...stylex.props(
              styles.statValue,
              s.value === 0 ? styles.statZero : s.tone
            )}
          >
            {s.value}
          </dd>
          <dt {...stylex.props(styles.statLabel)}>{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}

const styles = stylex.create({
  split: {
    flexGrow: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: {
      default: "280px minmax(0, 1fr)",
      "@media (max-width: 860px)": "minmax(0, 1fr)",
    },
    gridTemplateRows: {
      default: null,
      "@media (max-width: 860px)": "auto minmax(0, 1fr)",
    },
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: space.sm,
    overflowY: "auto",
    maxHeight: { default: null, "@media (max-width: 860px)": 168 },
    borderRightWidth: { default: 1, "@media (max-width: 860px)": 0 },
    borderBottomWidth: { default: 0, "@media (max-width: 860px)": 1 },
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderStyle: "solid",
    borderColor: color.line,
  },
  // On a phone the reader sits under the list, so the list keeps its loaded height while empty.
  listPending: {
    minHeight: { default: null, "@media (max-width: 860px)": 168 },
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
  },
  itemOn: {
    backgroundColor: {
      default: color.uiActive,
      ":hover": { default: null, [media.hover]: color.uiActive },
    },
  },
  itemDate: { fontSize: text.meta, color: color.fgMuted },
  itemTitle: {
    fontSize: text.label,
    fontWeight: 500,
    color: color.fg,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  reader: { overflowY: "auto", minHeight: 0 },
  article: {
    maxWidth: 680,
    marginInline: "auto",
    paddingInline: space.x4,
    paddingTop: space.x5,
    paddingBottom: 96,
    display: "flex",
    flexDirection: "column",
    gap: space.xl,
  },
  // A ruled strip, like the figures box in a printed report: a brief is a document, and five
  // boxed tiles made it read as a dashboard.
  // Five figures can't share one row on a phone, and wrapped they leave a ruled cell hanging, so
  // there they become a figures list: label, then number, one per line.
  stats: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(auto-fit, minmax(96px, 1fr))",
      "@media (max-width: 640px)": "minmax(0, 1fr)",
    },
    rowGap: { default: space.md, "@media (max-width: 640px)": 0 },
    paddingBottom: { default: space.md, "@media (max-width: 640px)": 0 },
    // The heading's rule above closes the strip's top edge.
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  stat: {
    display: "flex",
    flexDirection: {
      default: "column-reverse",
      "@media (max-width: 640px)": "row-reverse",
    },
    justifyContent: {
      default: null,
      "@media (max-width: 640px)": "space-between",
    },
    alignItems: { default: null, "@media (max-width: 640px)": "baseline" },
    gap: 2,
    paddingInline: { default: space.lg, "@media (max-width: 640px)": 0 },
    paddingBlock: { default: null, "@media (max-width: 640px)": space.sm },
    borderInlineStartWidth: {
      default: 1,
      ":first-child": 0,
      "@media (max-width: 640px)": 0,
    },
    borderInlineStartStyle: "solid",
    borderInlineStartColor: color.line,
    paddingInlineStart: {
      default: space.lg,
      ":first-child": 0,
      "@media (max-width: 640px)": 0,
    },
    borderTopWidth: {
      default: 0,
      "@media (max-width: 640px)": { default: 1, ":first-child": 0 },
    },
    borderTopStyle: "solid",
    borderTopColor: color.line,
  },
  statValue: {
    margin: 0,
    fontSize: {
      default: text.titleLg,
      "@media (max-width: 640px)": text.title,
    },
    lineHeight: {
      default: leading.titleLg,
      "@media (max-width: 640px)": leading.title,
    },
    fontWeight: 600,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
    color: color.fg,
  },
  statAccent: { color: color.accentFg },
  statWarn: { color: color.amberFg },
  statZero: { color: color.fgFaint },
  statLabel: { fontSize: text.meta, color: color.fgMuted },
  articleHead: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
    paddingBottom: space.xl,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  title: {
    fontSize: text.titleLg,
    lineHeight: leading.titleLg,
    fontWeight: 600,
    letterSpacing: "-0.02em",
  },
  when: { fontSize: text.label, color: color.fgMuted },
  ask: {
    color: color.accentFg,
    textDecoration: {
      default: "none",
      ":hover": { default: null, [media.hover]: "underline" },
    },
  },
  end: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.xl,
    paddingTop: space.xl,
    borderTopWidth: 1,
    borderTopStyle: "dashed",
    borderTopColor: color.line,
    fontSize: text.meta,
    color: color.fgFaint,
    textAlign: "center",
  },
});
