import {
  ClockCounterClockwiseIcon,
  DownloadSimpleIcon,
  LockIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Schemas } from "#api/client";
import { api, unwrap } from "#api/client";
import { q } from "#api/queries";
import { ago, exactTime, fromNow } from "#lib/time";
import { Button } from "#ui/button";
import { Badge } from "#ui/chip";
import type { Tone } from "#ui/chip";
import { EmptyState, Skeleton } from "#ui/feedback";
import { Input, Segmented, Select, Textarea } from "#ui/field";
import { Markdown } from "#ui/markdown";
import { Dialog, Tooltip } from "#ui/overlay";
import { color, leading, space, text } from "#ui/tokens.stylex";

import { Card, Row, SettingsPage, settingsStyles } from "./frame";

type Memory = Schemas["Memory"];

/** The owner's own words to their assistant. Only the owner writes them: no tool can. */
export function Instructions() {
  const voice = useQuery(q.voice());
  const history = useQuery(q.voiceHistory());
  const usage = useQuery(q.usage(7));
  const client = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const save = useMutation({
    mutationFn: async (content: string) =>
      await unwrap(api.PUT("/v1/voice", { body: { content } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["voice"] });
      setDraft(null);
      toast.success("Instructions saved. They apply from the next message.");
    },
    onError: (error) => toast.error(error.message),
  });
  const current = voice.data?.content ?? "";
  const value = draft ?? current;
  const u = usage.data;

  return (
    <SettingsPage
      title="Instructions"
      description="Tell your assistant how to work for you. It follows these after Worklog's constitution, and it can never change them itself."
    >
      <Card
        footer={
          <>
            {(history.data?.length ?? 0) > 0 && (
              <Button
                size="sm"
                variant="ghost"
                icon={<ClockCounterClockwiseIcon size={14} />}
                onClick={() => setShowHistory(true)}
              >
                History
              </Button>
            )}
            <span {...stylex.props(styles.grow)} />
            {draft !== null && draft !== current && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Discard
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={draft === null || draft === current}
              busy={save.isPending}
              onClick={() => save.mutate(value)}
            >
              Save
            </Button>
          </>
        }
      >
        <div {...stylex.props(settingsStyles.pad)}>
          {voice.isPending ? (
            <Skeleton lines={4} />
          ) : (
            <Textarea
              aria-label="Instructions"
              placeholder={
                "Be brief. Lead with what changed and what needs me.\nNever message the team channel without asking."
              }
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              sx={styles.voice}
            />
          )}
          <p {...stylex.props(styles.note)}>
            {voice.data?.savedAt
              ? `Last saved ${fromNow(voice.data.savedAt)}.`
              : "Not set yet."}{" "}
            Markdown works.
          </p>
        </div>
      </Card>

      <Card
        title="This week"
        description="How much your assistant worked, and how much of it was cached."
      >
        <div {...stylex.props(styles.stats)}>
          <Stat label="Turns" value={u ? String(u.turns) : "—"} />
          <Stat label="Tokens in" value={u ? compact(u.inputTokens) : "—"} />
          <Stat label="Tokens out" value={u ? compact(u.outputTokens) : "—"} />
          <Stat
            label="Cache hits"
            value={
              u?.cacheHitRate === null || !u
                ? "—"
                : `${Math.round(u.cacheHitRate * 100)}%`
            }
          />
        </div>
      </Card>

      <Dialog
        open={showHistory}
        onOpenChange={setShowHistory}
        title="Earlier versions"
        size="lg"
      >
        <div {...stylex.props(styles.history)}>
          {history.data?.map((v, i) => (
            <div key={v.savedAt ?? i} {...stylex.props(styles.version)}>
              <div {...stylex.props(styles.versionHead)}>
                <span title={v.savedAt ? exactTime(v.savedAt) : undefined}>
                  {v.savedAt ? fromNow(v.savedAt) : "Earlier"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(v.content);
                    setShowHistory(false);
                  }}
                >
                  Restore
                </Button>
              </div>
              <Markdown size="label">{v.content || "_Empty_"}</Markdown>
            </div>
          ))}
        </div>
      </Dialog>
    </SettingsPage>
  );
}

const compact = (n: number) =>
  new Intl.NumberFormat("en", { notation: "compact" }).format(n);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div {...stylex.props(styles.stat)}>
      <span {...stylex.props(styles.statValue)}>{value}</span>
      <span {...stylex.props(styles.statLabel)}>{label}</span>
    </div>
  );
}

const KINDS: Record<Memory["kind"], { label: string; tone: Tone }> = {
  profile: { label: "About you", tone: "accent" },
  fact: { label: "Fact", tone: "blue" },
  journal: { label: "Journal", tone: "neutral" },
  digest: { label: "Digest", tone: "violet" },
};

const SOURCES: Record<Memory["source"], string> = {
  self: "You told it",
  agent: "It learned",
  teammate: "From a teammate",
};

/** Everything the assistant remembers, readable and forgettable: no hidden memory. */
export function MemoryPage() {
  const [kind, setKind] = useState<"all" | Memory["kind"]>("all");
  const [search, setSearch] = useState("");
  const [term] = useDebouncedValue(search.trim(), { wait: 250 });
  const memories = useQuery(
    q.memories({
      kind: kind === "all" ? undefined : kind,
      q: term || undefined,
    })
  );
  const [adding, setAdding] = useState(false);
  const client = useQueryClient();
  const forget = useMutation({
    mutationFn: async (id: string) =>
      await unwrap(
        api.DELETE("/v1/memories/{id}", { params: { path: { id } } })
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["memories"] });
      toast("Forgotten");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <SettingsPage
      title="Memory"
      description="What your assistant knows about you and your work. It learns from your own words and forgets anything you remove here."
      actions={
        <>
          <Button
            size="sm"
            icon={<DownloadSimpleIcon size={14} />}
            onClick={() => {
              void exportMemories();
            }}
          >
            Export
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<PlusIcon size={14} />}
            onClick={() => setAdding(true)}
          >
            Add
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.filters)}>
        <Segmented
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "profile", label: "About you" },
            { value: "fact", label: "Facts" },
            { value: "journal", label: "Journal" },
            { value: "digest", label: "Digests" },
          ]}
        />
        <Input
          aria-label="Search memory"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leading={<MagnifyingGlassIcon size={13} />}
          sx={styles.search}
        />
      </div>
      <Card>
        {memories.isPending && (
          <div {...stylex.props(settingsStyles.pad)}>
            <Skeleton lines={5} />
          </div>
        )}
        {memories.data?.length === 0 && (
          <EmptyState title="Nothing remembered yet">
            Tell your assistant something worth keeping (“I’m off Fridays”), or
            add it here.
          </EmptyState>
        )}
        <ul {...stylex.props(settingsStyles.list)}>
          {memories.data?.map((m) => (
            <li
              key={m.id}
              {...stylex.props(settingsStyles.listRow, styles.memoryRow)}
            >
              <div {...stylex.props(settingsStyles.main)}>
                <p {...stylex.props(styles.memoryText)}>{m.content}</p>
                <div {...stylex.props(styles.memoryMeta)}>
                  <Badge tone={KINDS[m.kind].tone}>{KINDS[m.kind].label}</Badge>
                  <span>{SOURCES[m.source]}</span>
                  <span title={exactTime(m.updatedAt)}>{ago(m.updatedAt)}</span>
                  {m.visibility === "team" ? (
                    <span {...stylex.props(styles.vis)}>
                      <UsersIcon size={11} /> Teammates’ questions can use it
                    </span>
                  ) : (
                    <span {...stylex.props(styles.vis)}>
                      <LockIcon size={11} /> Only for you
                    </span>
                  )}
                  {m.expiresAt && <span>expires {fromNow(m.expiresAt)}</span>}
                </div>
              </div>
              <Tooltip label="Forget">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Forget"
                  icon={<TrashIcon size={14} />}
                  onClick={() => forget.mutate(m.id)}
                />
              </Tooltip>
            </li>
          ))}
        </ul>
      </Card>
      <AddMemory open={adding} onClose={() => setAdding(false)} />
    </SettingsPage>
  );
}

function AddMemory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<(typeof MEMORY_KINDS)[number]>("fact");
  const [visibility, setVisibility] =
    useState<(typeof VISIBILITIES)[number]>("private");
  const client = useQueryClient();
  const close = () => {
    setContent("");
    onClose();
  };
  const add = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/memories", {
          body: { content: content.trim(), kind, visibility },
        })
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["memories"] });
      toast.success("Remembered");
      close();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          close();
        }
      }}
      title="Add a memory"
      description="Something your assistant should keep in mind from now on."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!content.trim()}
            busy={add.isPending}
            onClick={() => add.mutate()}
          >
            Remember
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.dialogBody)}>
        <Textarea
          autoFocus
          aria-label="Memory"
          placeholder="I'm in clinic every Tuesday morning; don't expect replies."
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <Row label="Kind">
          <Select
            aria-label="Kind"
            value={kind}
            onChange={(e) => {
              const next = oneOf(MEMORY_KINDS, e.target.value);
              if (next) {
                setKind(next);
              }
            }}
          >
            <option value="fact">Fact</option>
            <option value="profile">About me</option>
          </Select>
        </Row>
        <Row
          label="Teammates"
          description="Whether your assistant may use this when teammates ask it things."
        >
          <Select
            aria-label="Visibility"
            value={visibility}
            onChange={(e) => {
              const next = oneOf(VISIBILITIES, e.target.value);
              if (next) {
                setVisibility(next);
              }
            }}
          >
            <option value="private">Only for me</option>
            <option value="team">Can use it</option>
          </Select>
        </Row>
      </div>
    </Dialog>
  );
}

async function exportMemories() {
  const data = await unwrap(api.GET("/v1/memories/export"));
  const blob = new Blob(
    [data.files.map((f) => `# ${f.path}\n\n${f.content}`).join("\n\n---\n\n")],
    { type: "text/markdown" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "worklog-memory.md";
  a.click();
  URL.revokeObjectURL(url);
}

const MEMORY_KINDS = ["fact", "profile"] as const;
const VISIBILITIES = ["private", "team"] as const;

function oneOf<T extends string>(
  values: readonly T[],
  value: string
): T | undefined {
  return values.find((v) => v === value);
}

const styles = stylex.create({
  grow: { flexGrow: 1 },
  voice: { minHeight: 200, fontSize: text.copy, lineHeight: leading.copy },
  note: { marginTop: space.sm, fontSize: text.meta, color: color.fgFaint },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    paddingInline: space.xl,
    paddingBottom: space.lg,
    paddingTop: space.sm,
  },
  stat: { display: "flex", flexDirection: "column", gap: 2 },
  statValue: {
    fontSize: text.titleLg,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
  },
  statLabel: { fontSize: text.meta, color: color.fgMuted },
  history: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    paddingInline: space.xl,
    paddingBottom: space.xl,
    overflowY: "auto",
  },
  version: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.line,
  },
  versionHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: text.meta,
    color: color.fgMuted,
  },
  filters: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    flexWrap: "wrap",
  },
  search: { width: 220 },
  memoryRow: { alignItems: "flex-start" },
  memoryText: {
    fontSize: text.label,
    lineHeight: leading.label,
    color: color.fg,
  },
  memoryMeta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.md,
    marginTop: space.xs,
    fontSize: 11.5,
    color: color.fgFaint,
  },
  vis: { display: "inline-flex", alignItems: "center", gap: 3 },
  dialogBody: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    paddingInline: space.xl,
    paddingBottom: space.lg,
  },
});
