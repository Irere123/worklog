import { Marked } from "marked";

// Model-written text from untrusted inputs is an exfiltration channel (EchoLeak pattern: image or link URLs carrying secrets).
// Drop images, keep a link only if its exact URL appeared in the source data (or is ours), escape raw HTML.
export function sanitizeMarkdown(
  markdown: string,
  allowedUrls: Iterable<string>,
  publicUrl?: string
): string {
  const allowed = new Set([...allowedUrls].filter(Boolean));
  const ok = (url: string) =>
    allowed.has(url) || (publicUrl ? url.startsWith(publicUrl) : false);
  return markdown
    .replaceAll(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replaceAll(/!\[[^\]]*\]\[[^\]]*\]/gu, "")
    .replaceAll(/^\s*\[[^\]]+\]:\s*\S+.*$/gmu, "")
    .replaceAll(
      /\[(?<text>[^\]]*)\]\(\s*<?(?<url>[^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu,
      (_, text: string, url: string) => (ok(url) ? `[${text}](${url})` : text)
    )
    .replaceAll(/<(?<url>https?:\/\/[^>\s]+)>/gu, (_, url: string) =>
      ok(url) ? `<${url}>` : "(link removed)"
    )
    .replaceAll(
      /(?<pre>^|[^(<\w])(?<url>https?:\/\/[^\s)>\]]+)/gu,
      (m, pre: string, url: string) => (ok(url) ? m : `${pre}(link removed)`)
    );
}

export function urlsIn(data: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/https?:\/\/[^\s)>\]"]+/gu)) {
        out.push(m[0]);
      }
    } else if (Array.isArray(v)) {
      for (const item of v) {
        walk(item);
      }
    } else if (typeof v === "object" && v !== null) {
      for (const item of Object.values(v)) {
        walk(item);
      }
    }
  };
  walk(data);
  return out;
}

export const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const emailMarkdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
  },
});

export async function toEmailHtml(markdown: string): Promise<string> {
  return await emailMarkdown.parse(markdown);
}
