import {
  ArrowUpIcon,
  LockSimpleIcon,
  MicrophoneIcon,
  StopIcon,
} from "@phosphor-icons/react";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode, RefObject } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useCardRefs } from "#features/cards/card-refs";
import { Kbd } from "#ui/chip";
import { Tooltip } from "#ui/overlay";
import {
  color,
  leading,
  media,
  motion,
  radius,
  shadow,
  space,
  text,
} from "#ui/tokens.stylex";

import { useDictation } from "./dictation";

/**
 * Where a question to the assistant is written: it grows with the text, sends on Enter, and while
 * a reply is being written the send button becomes Stop and a new message steers the reply.
 */
export function Composer({
  busy = false,
  label,
  placeholder,
  context,
  autoFocus = true,
  onSend,
  onStop,
  onStartTyping,
  onDrafting,
  inputRef,
  recall,
}: {
  busy?: boolean;
  label: string;
  placeholder: string;
  /** What the assistant can see, shown under the text so nobody has to guess. */
  context?: ReactNode;
  autoFocus?: boolean;
  onSend: (text: string) => void;
  onStop?: () => void;
  /** The first keystroke in an empty box: a message is on its way. */
  onStartTyping?: () => void;
  /** Whether there's something in the box, typed or being dictated, for a face that listens. */
  onDrafting?: (drafting: boolean) => void;
  /** For a page that focuses the box from a shortcut. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** The last thing sent, for ↑ in an empty box: ask it again, or fix it first. */
  recall?: () => string | undefined;
}) {
  const [value, setValue] = useState("");
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  // On a phone, focusing on arrival would throw up the keyboard over the conversation.
  const focusOnArrival = useEffectEvent(() => {
    if (autoFocus && matchMedia("(hover: hover)").matches) {
      ref.current?.focus();
    }
  });
  useEffect(() => {
    focusOnArrival();
  }, []);
  // What was in the box when dictation started; what's heard is written after it.
  const before = useRef("");
  const dictation = useDictation((heard) => {
    setValue(before.current ? `${before.current} ${heard}` : heard);
  });
  // "#" picks a card, as in comments; the reply's "#8" then opens it.
  const refs = useCardRefs({ value, onChange: setValue });
  const trimmed = value.trim();
  const send = () => {
    dictation.cancel();
    if (trimmed) {
      onSend(trimmed);
      setValue("");
    }
  };
  const drafting = trimmed !== "" || dictation.listening;
  const tellDrafting = useEffectEvent((now: boolean) => onDrafting?.(now));
  useEffect(() => {
    tellDrafting(drafting);
  }, [drafting]);
  const stopping = busy && !trimmed && onStop !== undefined;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      {...stylex.props(styles.box)}
    >
      <textarea
        ref={ref}
        rows={1}
        aria-label={label}
        placeholder={placeholderFor(dictation.listening, busy, placeholder)}
        value={value}
        enterKeyHint="send"
        onChange={(e) => {
          if (!value && e.target.value) {
            onStartTyping?.();
          }
          setValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (refs.onKeyDown(e)) {
            return;
          }
          const previous =
            e.key === "ArrowUp" && !value ? recall?.() : undefined;
          if (previous) {
            e.preventDefault();
            setValue(previous);
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape" && busy && onStop) {
            e.preventDefault();
            onStop();
          }
        }}
        {...stylex.props(styles.input)}
      />
      {refs.list && <div {...stylex.props(styles.refs)}>{refs.list}</div>}
      <div {...stylex.props(styles.bar)}>
        <div {...stylex.props(styles.context)}>{context}</div>
        {dictation.supported && (
          <Tooltip label={dictation.listening ? "Stop dictating" : "Dictate"}>
            <button
              type="button"
              aria-label={dictation.listening ? "Stop dictating" : "Dictate"}
              aria-pressed={dictation.listening}
              onClick={() => {
                if (dictation.listening) {
                  dictation.stop();
                } else {
                  before.current = value.trim();
                  dictation.start();
                  ref.current?.focus();
                }
              }}
              {...stylex.props(styles.mic, dictation.listening && styles.micOn)}
            >
              <MicrophoneIcon
                size={15}
                weight={dictation.listening ? "fill" : "regular"}
              />
            </button>
          </Tooltip>
        )}
        {stopping ? (
          <Tooltip label="Stop" shortcut="Esc">
            <button
              type="button"
              aria-label="Stop the reply"
              onClick={onStop}
              {...stylex.props(styles.send)}
            >
              <StopIcon size={11} weight="fill" />
            </button>
          </Tooltip>
        ) : (
          <Tooltip label={busy ? "Steer the reply" : "Send"} shortcut="↵">
            <button
              type="submit"
              aria-label={busy ? "Steer the reply" : "Send"}
              disabled={!trimmed}
              {...stylex.props(styles.send)}
            >
              <ArrowUpIcon size={15} weight="bold" />
            </button>
          </Tooltip>
        )}
      </div>
    </form>
  );
}

function placeholderFor(listening: boolean, busy: boolean, idle: string) {
  if (listening) {
    return "Listening…";
  }
  return busy ? "Send to steer the reply…" : idle;
}

/** The line under a teammate's assistant composer: what it can and can't see. */
export function TeamVisibleOnly() {
  return (
    <span {...stylex.props(styles.chip)}>
      <LockSimpleIcon size={12} /> Team-visible work only
    </span>
  );
}

export function ComposerHint({ busy }: { busy: boolean }) {
  return (
    <p {...stylex.props(styles.hint)}>
      <Kbd>↵</Kbd> send <span aria-hidden>·</span> <Kbd>⇧ ↵</Kbd> new line{" "}
      <span aria-hidden>·</span> <Kbd>#</Kbd> links a card
      {busy && (
        <>
          {" "}
          <span aria-hidden>·</span> <Kbd>Esc</Kbd> stop
        </>
      )}
    </p>
  );
}

const styles = stylex.create({
  box: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    paddingTop: space.md,
    paddingBottom: space.sm,
    paddingInline: space.sm,
    borderRadius: radius.lg,
    backgroundColor: color.raised,
    boxShadow: {
      default: shadow.card,
      ":focus-within": `${shadow.card}, 0 0 0 3px ${color.accentSubtle}`,
    },
    transitionProperty: "box-shadow",
    transitionDuration: motion.fast,
  },
  refs: {
    position: "absolute",
    insetInline: 0,
    bottom: "calc(100% + 6px)",
    zIndex: 2,
  },
  input: {
    // Grows with what's written, up to about ten lines, then scrolls.
    fieldSizing: "content",
    minHeight: leading.copy,
    maxHeight: 240,
    paddingInline: space.sm,
    borderWidth: 0,
    outline: "none",
    resize: "none",
    fontFamily: "inherit",
    fontSize: { default: text.copy, "@media (max-width: 640px)": "16px" },
    lineHeight: leading.copy,
    color: color.fg,
    backgroundColor: "transparent",
    "::placeholder": { color: color.fgFaint },
  },
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  context: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    minWidth: 0,
    paddingInlineStart: space.sm,
    fontSize: text.meta,
    lineHeight: leading.meta,
    color: color.fgFaint,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    color: color.violetFg,
  },
  mic: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 30,
    height: 30,
    marginInlineStart: "auto",
    borderRadius: radius.full,
    borderWidth: 0,
    color: {
      default: color.fgMuted,
      ":hover": { default: null, [media.hover]: color.fg },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, [media.hover]: color.ui },
    },
    cursor: "pointer",
    transform: { default: null, ":active": "scale(0.95)" },
    transitionProperty: "transform",
    transitionDuration: motion.fast,
  },
  micOn: {
    color: color.redFg,
    backgroundColor: color.redSubtle,
  },
  send: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 30,
    height: 30,
    borderRadius: radius.full,
    borderWidth: 0,
    // The page's own colour on its ink: the button reads in both themes without a new token.
    color: { default: color.bg, ":disabled": color.fgFaint },
    backgroundColor: {
      default: color.fg,
      ":disabled": color.ui,
      ":hover:not(:disabled)": { default: null, [media.hover]: color.fgMuted },
    },
    cursor: { default: "pointer", ":disabled": "default" },
    transform: { default: null, ":active:not(:disabled)": "scale(0.96)" },
    transitionProperty: "background-color, transform",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.out,
  },
  hint: {
    display: { default: "flex", "@media (max-width: 640px)": "none" },
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    margin: 0,
    fontSize: text.caption,
    lineHeight: leading.caption,
    color: color.fgFaint,
  },
});
