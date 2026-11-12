import { LockIcon, MicrophoneIcon, UsersIcon } from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { api, unwrap } from "#api/client";
import { useDictation } from "#features/assistant/dictation";
import { useMembers } from "#features/cards/card-bits";
import { Avatar } from "#ui/avatar";
import { Button } from "#ui/button";
import { Kbd } from "#ui/chip";
import { Input, Segmented, Textarea } from "#ui/field";
import { Dialog } from "#ui/overlay";
import { color, leading, media, radius, space, text } from "#ui/tokens.stylex";

type Kind = "entry" | "decision" | "blocker" | "win";

const PROMPTS: Record<Kind, string> = {
  entry: "What did you work on?",
  decision: "What was decided, and why?",
  blocker: "What’s in your way? Mention @someone and it lands in their inbox.",
  win: "What shipped or went well?",
};

/** Work that happened off the connected tools: calls, decisions, a blocker worth raising. */
// An @ being typed at the end of the text, with what follows it so far.
const MENTION = /(?:^|\s)@(?<handle>[\w-]*)$/u;

function withMention(value: string, handle: string) {
  return `${value.replace(MENTION, (match) => match.slice(0, match.indexOf("@")))}@${handle} `;
}

export function QuickLog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const { list: members } = useMembers();
  const partial = MENTION.exec(draft)?.groups?.handle;
  const mentions =
    partial === undefined
      ? []
      : members
          .filter(
            (m) =>
              m.handle.startsWith(partial.toLowerCase()) ||
              m.name.toLowerCase().startsWith(partial.toLowerCase())
          )
          .slice(0, 5);
  const [kind, setKind] = useState<Kind>("entry");
  const [card, setCard] = useState("");
  const [visibility, setVisibility] = useState<"team" | "private">("team");
  const client = useQueryClient();
  // Spoken entries are marked as such, so their wording is read as dictation, not typing.
  const [spoken, setSpoken] = useState(false);
  const before = useRef("");
  const dictation = useDictation((heard) => {
    setSpoken(true);
    setDraft(before.current ? `${before.current} ${heard}` : heard);
  });

  const reset = () => {
    setDraft("");
    setKind("entry");
    setCard("");
    setVisibility("team");
    setSpoken(false);
    dictation.cancel();
  };

  const log = useMutation({
    mutationFn: async () =>
      await unwrap(
        api.POST("/v1/logs", {
          body: {
            text: draft.trim(),
            kind,
            visibility,
            via: spoken ? "voice" : "text",
            cardNumber: card ? Number(card.replace("#", "")) : undefined,
          },
        })
      ),
    onSuccess: () => {
      toast.success(kind === "blocker" ? "Blocker logged" : "Logged");
      void client.invalidateQueries({ queryKey: ["activities"] });
      void client.invalidateQueries({ queryKey: ["now"] });
      reset();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = () => {
    if (draft.trim() && !log.isPending) {
      log.mutate();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
        }
      }}
      title="Log work"
      description="It joins your activity, and your assistant learns from it."
      footer={
        <>
          <span {...stylex.props(styles.hint)}>
            <Kbd>⌘ ↵</Kbd> to log
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            busy={log.isPending}
            disabled={!draft.trim()}
          >
            Log it
          </Button>
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <Segmented<Kind>
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "entry", label: "Update" },
            { value: "decision", label: "Decision" },
            { value: "blocker", label: "Blocker" },
            { value: "win", label: "Win" },
          ]}
        />
        <Textarea
          autoFocus
          aria-label="What happened"
          placeholder={PROMPTS[kind]}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
            const [first] = mentions;
            if (e.key === "Tab" && first) {
              e.preventDefault();
              setDraft(withMention(draft, first.handle));
            }
          }}
          sx={styles.textarea}
        />
        {mentions.length > 0 && (
          <div {...stylex.props(styles.mentions)} aria-label="Mention someone">
            {mentions.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setDraft(withMention(draft, m.handle))}
                {...stylex.props(
                  styles.mention,
                  i === 0 && styles.mentionFirst
                )}
              >
                <Avatar person={m} size={16} />
                {m.name}
                <span {...stylex.props(styles.handle)}>@{m.handle}</span>
              </button>
            ))}
            <span {...stylex.props(styles.tabHint)}>Tab picks the first</span>
          </div>
        )}
        <div {...stylex.props(styles.row)}>
          <Input
            aria-label="Card number"
            placeholder="Card # (optional)"
            inputMode="numeric"
            value={card}
            onChange={(e) => setCard(e.target.value.replaceAll(/[^\d#]/gu, ""))}
            sx={styles.card}
          />
          {dictation.supported && (
            <Button
              size="sm"
              variant={dictation.listening ? "secondary" : "ghost"}
              aria-pressed={dictation.listening}
              icon={
                <MicrophoneIcon
                  size={14}
                  weight={dictation.listening ? "fill" : "regular"}
                />
              }
              onClick={() => {
                if (dictation.listening) {
                  dictation.stop();
                } else {
                  before.current = draft.trim();
                  dictation.start();
                }
              }}
            >
              {dictation.listening ? "Stop" : "Dictate"}
            </Button>
          )}
          <span {...stylex.props(styles.spacer)} />
          <Segmented<"team" | "private">
            label="Who can see it"
            value={visibility}
            onChange={setVisibility}
            options={[
              {
                value: "team",
                label: (
                  <>
                    <UsersIcon size={12} /> Team
                  </>
                ),
              },
              {
                value: "private",
                label: (
                  <>
                    <LockIcon size={12} /> Only me
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>
    </Dialog>
  );
}

const styles = stylex.create({
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
    paddingInline: space.xl,
    paddingBottom: space.xl,
  },
  mentions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.xs,
    marginTop: -4,
  },
  mention: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    height: 28,
    paddingInline: space.md,
    borderRadius: radius.full,
    fontSize: text.meta,
    fontWeight: 500,
    color: color.fg,
    backgroundColor: {
      default: color.ui,
      ":hover": { default: null, [media.hover]: color.uiHover },
    },
  },
  mentionFirst: { boxShadow: `inset 0 0 0 1px ${color.accentLine}` },
  handle: { color: color.fgMuted, fontWeight: 400 },
  tabHint: {
    fontSize: 11.5,
    color: color.fgFaint,
    marginInlineStart: space.xs,
  },
  textarea: { minHeight: 110, fontSize: text.copy, lineHeight: leading.copy },
  // On a phone the card field, Dictate and who-sees-it don't fit one line; wrapping keeps
  // "Only me" on screen.
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.md,
    rowGap: space.sm,
    justifyContent: "space-between",
  },
  card: { width: 160 },
  spacer: { flexGrow: 1 },
  // Keyboard hints mean nothing on a touch screen; hidden rather than removed, it still pushes
  // the buttons to the end.
  hint: {
    marginInlineEnd: "auto",
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: text.meta,
    color: color.fgFaint,
    visibility: {
      default: null,
      [media.touch]: "hidden",
    },
  },
});
