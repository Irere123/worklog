import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";

import { parseTraceparent, traced } from "#telemetry/trace";

import type { Env } from "./router";

// The web app's files and the health check stay out: they'd be most of the traffic and none of
// the questions.
const TRACED = /^\/(?:v1|api|hooks|oauth)\//u;

/**
 * Each request is a span, continuing the caller's trace when it sends a `traceparent`. Its id goes
 * back in `x-worklog-trace`, so a report of a failed request leads straight to its trace.
 */
export function traceRequests() {
  return createMiddleware<Env>(async (c, next) => {
    // A browser's preflight is CORS answering itself, not a request the API served.
    if (!TRACED.test(c.req.path) || c.req.method === "OPTIONS") {
      await next();
      return;
    }
    const { method } = c.req;
    await traced(
      method,
      { "http.method": method },
      async (span) => {
        await next();
        traceHeader(c, span.traceId);
        // The route of the handler that answered, read once it has: the last route matched can
        // be the web app's catch-all, which matches every path.
        const answered = routePath(c);
        const route =
          c.res.status === 404 && answered.endsWith("*")
            ? "unmatched"
            : answered;
        const member = c.get("member") as
          | Env["Variables"]["member"]
          | undefined;
        span.name = `${method} ${route}`;
        span.set({
          "http.route": route,
          "http.status_code": c.res.status,
          "workspace.id": member?.workspaceId,
          "member.id": member?.id,
        });
        // A thrown error has failed the span already (handleError), with its stack.
        if (c.res.status >= 500 && span.status === "ok") {
          span.fail(new Error(`Responded ${c.res.status}`));
        }
      },
      { kind: "server", parent: parseTraceparent(c.req.header("traceparent")) }
    );
  });
}

// Set once the handler has answered: a header set before only reaches responses Hono builds, not
// the `Response` Better Auth or an OAuth page returns. A redirect's headers can't be changed, so
// it's copied.
function traceHeader(c: Context<Env>, traceId: string) {
  try {
    c.res.headers.set("x-worklog-trace", traceId);
  } catch {
    const copy = new Response(c.res.body, c.res);
    copy.headers.set("x-worklog-trace", traceId);
    c.res = copy;
  }
}
