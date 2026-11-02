import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { MouseEvent } from "react";
import { memo, useMemo } from "react";

import { color, font, leading, radius, space, text } from "./tokens.stylex";

marked.setOptions({ gfm: true, breaks: true });

// Briefs, card bodies and replies quote text from Slack, GitHub and teammates: sanitize before
// it reaches the DOM, and open links outside the app.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function Markdown({
  children,
  size = "copy",
  sx,
}: {
  children: string;
  size?: "copy" | "label";
  sx?: StyleXStyles;
}) {
  const openCard = useOpenCard();
  const html = useMemo(() => render(children), [children]);
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegates clicks on the card links inside, which are real anchors and keyboard reachable
    <div
      onClick={openCard}
      // oxlint-disable-next-line react/no-danger -- sanitized by DOMPurify in render()
      dangerouslySetInnerHTML={{ __html: html }}
      {...stylex.props(styles.prose, size === "label" && styles.small, sx)}
    />
  );
}

/**
 * Markdown that's still being written. Settled blocks keep their parsed HTML, so each new word
 * re-parses only the last paragraph, and an unfinished **bold** or `code` shows closed rather than
 * as raw marks until the closing ones arrive.
 */
export function StreamingMarkdown({
  children,
  streaming,
}: {
  children: string;
  streaming: boolean;
}) {
  const openCard = useOpenCard();
  const blocks = splitBlocks(children);
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegates clicks on the card links inside, which are real anchors and keyboard reachable
    <div onClick={openCard} {...stylex.props(styles.prose)}>
      {blocks.map((block, i) => (
        <Block
          // Blocks only ever grow at the end, so their positions are stable keys.
          // oxlint-disable-next-line react/no-array-index-key -- see above
          key={i}
          source={
            streaming && i === blocks.length - 1 ? closeOpenMarks(block) : block
          }
        />
      ))}
    </div>
  );
}

function BlockHtml({ source }: { source: string }) {
  const html = useMemo(() => render(source), [source]);
  return (
    <div
      // oxlint-disable-next-line react/no-danger -- sanitized by DOMPurify in render()
      dangerouslySetInnerHTML={{ __html: html }}
      {...stylex.props(styles.block)}
    />
  );
}

// A settled block's text never changes, so it never renders again.
const Block = memo(BlockHtml);

// Recently rendered sources, newest last: moving back and forth through an inbox or a thread
// shows the same bodies again, and parsing and sanitizing is the slow part of drawing them.
const rendered = new Map<string, string>();
const RENDERED_KEPT = 200;

function render(source: string) {
  const cached = rendered.get(source);
  if (cached !== undefined) {
    rendered.delete(source);
    rendered.set(source, cached);
    return cached;
  }
  const html = linkCards(
    DOMPurify.sanitize(marked.parse(source, { async: false }), {
      RETURN_DOM_FRAGMENT: true,
    })
  );
  rendered.set(source, html);
  if (rendered.size > RENDERED_KEPT) {
    const [oldest] = rendered.keys();
    if (oldest !== undefined) {
      rendered.delete(oldest);
    }
  }
  return html;
}

// Top-level blocks are separated by a blank line outside a code fence.
function splitBlocks(source: string) {
  const blocks: string[] = [];
  let current: string[] = [];
  let fenced = false;
  for (const line of source.split("\n")) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
    }
    if (!fenced && line.trim() === "" && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    } else if (fenced || line.trim() !== "") {
      current.push(line);
    }
  }
  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }
  return blocks;
}

function closeOpenMarks(block: string) {
  let closed = block;
  if ((closed.match(/```/gu)?.length ?? 0) % 2 === 1) {
    return `${closed}\n\`\`\``;
  }
  if ((closed.match(/\*\*/gu)?.length ?? 0) % 2 === 1) {
    closed += "**";
  }
  if ((closed.replaceAll("```", "").match(/`/gu)?.length ?? 0) % 2 === 1) {
    closed += "`";
  }
  return closed;
}

function useOpenCard() {
  const navigate = useNavigate();
  return (event: MouseEvent<HTMLDivElement>) => {
    const copy =
      event.target instanceof Element
        ? event.target.closest("button[data-copy]")
        : null;
    if (copy instanceof HTMLButtonElement) {
      const code =
        copy.parentElement?.querySelector("code") ?? copy.parentElement;
      void (async () => {
        await navigator.clipboard.writeText(code?.textContent ?? "");
        copy.textContent = "Copied";
        setTimeout(() => {
          copy.textContent = "Copy";
        }, 1600);
      })();
      return;
    }
    const link =
      event.target instanceof Element
        ? event.target.closest("a[data-card]")
        : null;
    const card =
      link instanceof HTMLElement ? Number(link.dataset.card) : Number.NaN;
    if (card > 0) {
      event.preventDefault();
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, card }),
      });
    }
  };
}

// "#8" where a brief or reply names a card, but not "PR #31" or "issue #4": those are the
// source's numbers, not Worklog's.
const CARD_REF =
  /(?<!\b(?:PR|MR|pr|mr|[Ii]ssue|[Pp]ull)\s)(?<![\w/#&])#(?<number>\d+)\b/gu;

/** Card references become in-app links; text inside code and existing links is left alone. */
function linkCards(fragment: DocumentFragment) {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text && !node.parentElement?.closest("a, code, pre")) {
      texts.push(node);
    }
  }
  for (const node of texts) {
    const value = node.data;
    // matchAll, not test(): test() on a global regex moves lastIndex, and matchAll copies it,
    // which would skip the first reference.
    const matches = [...value.matchAll(CARD_REF)];
    if (matches.length === 0) {
      continue;
    }
    const parts = document.createDocumentFragment();
    let last = 0;
    for (const match of matches) {
      const [whole] = match;
      const number = match.groups?.number ?? "";
      parts.append(value.slice(last, match.index));
      const link = document.createElement("a");
      link.href = `?card=${number}`;
      link.dataset.card = number;
      link.textContent = whole;
      parts.append(link);
      last = match.index + whole.length;
    }
    parts.append(value.slice(last));
    node.replaceWith(parts);
  }
  // A command or snippet is copied whole, without selecting around the box.
  for (const pre of fragment.querySelectorAll("pre")) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.dataset.copy = "";
    copy.textContent = "Copy";
    pre.prepend(copy);
  }
  const holder = document.createElement("div");
  holder.append(fragment);
  return holder.innerHTML;
}

const styles = stylex.create({
  // Keys here are descendant selectors. StyleX scopes only the first part of a selector list, so
  // each key is one selector with :is() inside it.
  prose: {
    fontSize: text.copy,
    lineHeight: leading.copy,
    color: color.fg,
    overflowWrap: "anywhere",
    ":is(*) > * + *": { marginTop: space.md },
    ":is(*) :is(h1, h2, h3)": {
      fontWeight: 600,
      marginTop: space.xl,
    },
    ":is(*) h1": { fontSize: text.title, lineHeight: leading.title },
    ":is(*) h2": { fontSize: text.titleSm, lineHeight: leading.titleSm },
    ":is(*) h3": { fontSize: text.copy },
    ":is(*) :is(ul, ol)": { paddingInlineStart: space.xxl },
    ":is(*) ul": { listStyleType: "disc" },
    ":is(*) ol": { listStyleType: "decimal" },
    ":is(*) li + li": { marginTop: space.xs },
    ":is(*) li::marker": { color: color.fgFaint },
    ":is(*) a": {
      color: color.accentFg,
      textDecoration: "underline",
      textDecorationColor: color.accentLine,
      textUnderlineOffset: 2,
    },
    ":is(*) code": {
      fontFamily: font.mono,
      fontSize: "0.88em",
      paddingInline: 4,
      paddingBlock: 1,
      borderRadius: radius.xs,
      backgroundColor: color.ui,
    },
    ":is(*) pre": {
      position: "relative",
      padding: space.lg,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      overflowX: "auto",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: color.line,
    },
    ":is(*) pre code": { padding: 0, backgroundColor: "transparent" },
    ":is(*) [data-copy]": {
      position: "absolute",
      top: space.sm,
      right: space.sm,
      height: 24,
      paddingInline: space.sm,
      borderRadius: radius.sm,
      borderWidth: 0,
      fontFamily: font.sans,
      fontSize: text.caption,
      color: color.fgMuted,
      backgroundColor: color.raised,
      boxShadow: `inset 0 0 0 1px ${color.line}`,
      cursor: "pointer",
    },
    ":is(*) blockquote": {
      paddingInlineStart: space.lg,
      borderInlineStartWidth: 2,
      borderInlineStartStyle: "solid",
      borderInlineStartColor: color.lineStrong,
      color: color.fgMuted,
    },
    ":is(*) hr": {
      borderWidth: 0,
      height: 1,
      backgroundColor: color.line,
      marginBlock: space.xl,
    },
    ":is(*) strong": { fontWeight: 600 },
    // Wide tables scroll inside their own box rather than widening the page.
    ":is(*) table": {
      display: "block",
      maxWidth: "100%",
      width: "fit-content",
      overflowX: "auto",
      borderCollapse: "separate",
      borderSpacing: 0,
      borderRadius: radius.md,
      boxShadow: `inset 0 0 0 1px ${color.line}`,
      fontSize: text.label,
      lineHeight: leading.label,
      fontVariantNumeric: "tabular-nums",
    },
    ":is(*) :is(th, td)": {
      paddingBlock: space.sm,
      paddingInline: space.lg,
      borderBottomWidth: 1,
      borderBottomStyle: "solid",
      borderBottomColor: color.line,
      textAlign: "left",
      verticalAlign: "top",
      // The prose may break anywhere; cells wrap at words, and the table scrolls instead.
      overflowWrap: "normal",
      minWidth: 72,
    },
    ":is(*) tr:last-child td": { borderBottomWidth: 0 },
    ":is(*) th": {
      whiteSpace: "nowrap",
      fontWeight: 500,
      color: color.fgMuted,
      backgroundColor: color.surface,
    },
    ":is(*) th:first-child": { borderTopLeftRadius: radius.md },
    ":is(*) th:last-child": { borderTopRightRadius: radius.md },
  },
  small: { fontSize: text.label, lineHeight: leading.label },
  block: { ":is(*) > * + *": { marginTop: space.md } },
});
