import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { MouseEvent } from "react";
import { useMemo } from "react";

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
  const navigate = useNavigate();
  const html = useMemo(
    () =>
      linkCards(
        DOMPurify.sanitize(marked.parse(children, { async: false }), {
          RETURN_DOM_FRAGMENT: true,
        })
      ),
    [children]
  );
  const openCard = (event: MouseEvent<HTMLDivElement>) => {
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
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- delegates clicks on the card links inside, which are real anchors and keyboard reachable
    <div
      onClick={openCard}
      // oxlint-disable-next-line react/no-danger -- sanitized by DOMPurify above
      dangerouslySetInnerHTML={{ __html: html }}
      {...stylex.props(styles.prose, size === "label" && styles.small, sx)}
    />
  );
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
      padding: space.lg,
      borderRadius: radius.md,
      backgroundColor: color.surface,
      overflowX: "auto",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: color.line,
    },
    ":is(*) pre code": { padding: 0, backgroundColor: "transparent" },
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
    ":is(*) table": { borderCollapse: "collapse", fontSize: text.label },
    ":is(*) :is(th, td)": {
      paddingBlock: space.xs,
      paddingInline: space.md,
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: color.line,
      textAlign: "left",
    },
  },
  small: { fontSize: text.label, lineHeight: leading.label },
});
