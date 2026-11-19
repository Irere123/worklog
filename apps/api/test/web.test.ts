import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import { createApp } from "#app";

import { testEnv } from "./harness";
import type { TestEnv } from "./harness";

let env: TestEnv;
let dist: string;
const script = `export const rows = ${JSON.stringify(
  Array.from({ length: 200 }, (_, i) => ({ id: i, title: `Row ${i}` }))
)};`;

beforeAll(async () => {
  env = await testEnv();
  dist = mkdtempSync(path.join(tmpdir(), "worklog-web-"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(
    path.join(dist, "_shell.html"),
    "<!doctype html><title>Worklog</title>"
  );
  writeFileSync(
    path.join(dist, "index.html"),
    "<!doctype html><title>Worklog · Your team’s logbook</title>"
  );
  mkdirSync(path.join(dist, "pricing"));
  writeFileSync(
    path.join(dist, "pricing", "index.html"),
    "<!doctype html><title>Pricing · Worklog</title>"
  );
  writeFileSync(path.join(dist, "assets", "app-abc123.js"), script);
  writeFileSync(
    path.join(dist, "assets", "inter-abc123.woff2"),
    new Uint8Array(4096).fill(7)
  );
});

const PAGE = { headers: { accept: "text/html,application/xhtml+xml" } };

function webApp() {
  return createApp({
    ...env.ctx,
    config: { ...env.ctx.config, WEB_DIST: dist },
  });
}

describe("serving the web app", () => {
  test("assets go out compressed in the best encoding the browser takes, and cached for good", async () => {
    const app = webApp();
    const br = await app.request("/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    expect(br.status).toBe(200);
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("cache-control")).toContain("immutable");
    expect(br.headers.get("vary")).toContain("accept-encoding");
    const body = new Uint8Array(await br.arrayBuffer());
    expect(body.byteLength).toBeLessThan(script.length / 3);
    expect(brotliDecompressSync(body).toString()).toBe(script);

    const gzip = await app.request("/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip" },
    });
    expect(gzip.headers.get("content-encoding")).toBe("gzip");
    expect(
      gunzipSync(new Uint8Array(await gzip.arrayBuffer())).toString()
    ).toBe(script);

    const refused = await app.request("/assets/app-abc123.js", {
      headers: { "accept-encoding": "br;q=0, gzip" },
    });
    expect(refused.headers.get("content-encoding")).toBe("gzip");

    const plain = await app.request("/assets/app-abc123.js");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.text()).toBe(script);
  });

  test("files that are compressed already are sent as they are", async () => {
    const res = await webApp().request("/assets/inter-abc123.woff2", {
      headers: { "accept-encoding": "br" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(4096);
  });

  test("app routes get the shell, never cached, and API paths keep their own 404s", async () => {
    const app = webApp();
    const page = await app.request("/inbox?item=1", PAGE);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(await page.text()).toContain("<title>Worklog</title>");

    const outside = await app.request("/..%2f..%2f..%2fetc%2fpasswd", PAGE);
    expect(await outside.text()).toContain("<title>Worklog</title>");
    const outsideAssets = await app.request(
      "/assets/..%2f..%2f..%2fetc%2fpasswd",
      PAGE
    );
    expect(outsideAssets.status).toBe(404);
    expect(await outsideAssets.text()).not.toContain("root:");

    const gone = await app.request("/assets/app-old999.js", PAGE);
    expect(gone.status).toBe(404);

    const malformed = await app.request("/%E0%A4%A", PAGE);
    expect(malformed.status).toBe(200);
    expect(await malformed.text()).toContain("<title>Worklog</title>");

    const owner = await env.workspace();
    const missing = await app.request("/v1/nothing-here", {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");
  });

  test("only a browser opening a page gets the shell: agents probing for metadata get a 404", async () => {
    const app = webApp();
    for (const url of [
      "/.well-known/openid-configuration",
      "/.well-known/oauth-authorization-server/nowhere",
      "/inbox",
    ]) {
      const probe = await app.request(url, {
        headers: { accept: "application/json" },
      });
      expect(probe.status).toBe(404);
      expect(await probe.text()).not.toContain("<title>");
    }
    const discovery = await app.request(
      "/.well-known/oauth-protected-resource/mcp",
      PAGE
    );
    expect(discovery.headers.get("content-type")).toContain("application/json");
  });

  test("without a build to serve, a page no route answers is marked for the web server to give the shell", async () => {
    const app = createApp(env.ctx);
    const page = await app.request("/board/12", PAGE);
    expect(page.status).toBe(404);
    expect(page.headers.get("worklog-shell")).toBe("1");

    for (const [method, url, accept] of [
      ["GET", "/board/12", "application/json"],
      ["POST", "/board/12", "text/html"],
      ["GET", "/.well-known/openid-configuration", "*/*"],
    ] as const) {
      const other = await app.request(url, { method, headers: { accept } });
      expect(other.status).toBe(404);
      expect(other.headers.get("worklog-shell")).toBeNull();
    }
  });

  test("prerendered pages are served as the build made them, never cached", async () => {
    const app = webApp();
    const front = await app.request("/");
    expect(front.status).toBe(200);
    expect(front.headers.get("cache-control")).toBe("no-cache");
    expect(await front.text()).toContain("Your team’s logbook");

    for (const url of ["/pricing", "/pricing/"]) {
      const pricing = await app.request(url);
      expect(await pricing.text()).toContain("Pricing · Worklog");
    }

    const home = await app.request("/home", PAGE);
    expect(await home.text()).toContain("<title>Worklog</title>");

    const escaped = await app.request("/..%2f..%2f/", PAGE);
    expect(await escaped.text()).toContain("<title>Worklog</title>");
  });

  test("a path that isn't a file isn't remembered, so asking for many can't fill memory", async () => {
    const app = webApp();
    const before = await app.request("/assets/late-abc123.js");
    expect(before.status).toBe(404);
    writeFileSync(path.join(dist, "assets", "late-abc123.js"), "export {};");
    const after = await app.request("/assets/late-abc123.js");
    expect(await after.text()).toBe("export {};");
  });

  test("JSON from the API is gzipped for clients that take it", async () => {
    const owner = await env.workspace();
    const res = await webApp().request("/v1/members", {
      headers: {
        authorization: `Bearer ${owner.token}`,
        "accept-encoding": "gzip",
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    const members = JSON.parse(
      gunzipSync(new Uint8Array(await res.arrayBuffer())).toString()
    );
    expect(members.length).toBeGreaterThan(0);
  });
});
