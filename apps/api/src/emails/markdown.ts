import { Marked } from "marked";

import { escapeHtml } from "#automations/sanitize";

import { palette } from "./layout";

const markdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
  },
});

const text = `margin:0 0 16px;color:${palette.fg};font-size:15px;line-height:24px`;
const mono = `font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px`;

const STYLES: Record<string, string> = {
  p: text,
  h1: `margin:24px 0 8px;color:${palette.fg};font-size:17px;font-weight:600;line-height:24px`,
  h2: `margin:24px 0 8px;color:${palette.fg};font-size:16px;font-weight:600;line-height:24px`,
  h3: `margin:20px 0 8px;color:${palette.fg};font-size:15px;font-weight:600;line-height:24px`,
  ul: "margin:0 0 16px;padding-left:22px",
  ol: "margin:0 0 16px;padding-left:22px",
  li: `margin:0 0 6px;color:${palette.fg};font-size:15px;line-height:24px`,
  a: `color:${palette.link};text-decoration:underline`,
  code: `${mono};padding:1px 4px;border-radius:4px;background-color:#f2f1ee`,
  pre: `${mono};margin:0 0 16px;padding:12px;border-radius:8px;background-color:#f2f1ee;white-space:pre-wrap`,
  blockquote: `margin:0 0 16px;padding-left:12px;border-left:3px solid ${palette.line};color:${palette.muted}`,
  hr: `margin:24px 0;border:none;border-top:1px solid ${palette.line}`,
};

const TAG = new RegExp(
  `<(?<tag>${Object.keys(STYLES).join("|")})(?=[\\s>/])`,
  "gu"
);

/** A brief's markdown as email HTML. Raw HTML is escaped, so every tag left is marked's own. */
export function emailHtml(source: string): string {
  const html = markdown.parse(source, { async: false });
  return html.replaceAll(
    TAG,
    (_, tag: string) => `<${tag} style="${STYLES[tag]}"`
  );
}
