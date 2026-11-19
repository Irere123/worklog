import type { CallToolResult } from "@modelcontextprotocol/server";

import { ApiError } from "#lib/errors";
import { log } from "#telemetry/log";

const ISO = /^(?<minute>\d{4}-\d\d-\d\dT\d\d:\d\d):\d\d(?:\.\d+)?Z$/u;

export async function reply(run: () => Promise<unknown>) {
  try {
    const value = await run();
    return {
      content: [
        {
          type: "text",
          text: typeof value === "string" ? value : JSON.stringify(value, lean),
        },
      ],
    } satisfies CallToolResult;
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message }],
      } satisfies CallToolResult;
    }
    log.error("mcp: tool failed", { error });
    return {
      isError: true,
      content: [{ type: "text", text: "Something went wrong in Worklog." }],
    } satisfies CallToolResult;
  }
}

function lean(_key: string, value: unknown) {
  if (typeof value === "string") {
    const time = ISO.exec(value);
    return time?.groups ? `${time.groups.minute}Z` : value;
  }
  const empty = value === null || (Array.isArray(value) && value.length === 0);
  return empty ? undefined : value;
}
