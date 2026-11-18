import { registerTelemetry } from "ai";
import type { Telemetry } from "ai";

import { runIn, startSpan } from "./trace";
import type { Span } from "./trace";

const MAX_OPEN = 1000;
const operations = new Map<string, Span>();
const modelCalls = new Map<string, Span>();
const tools = new Map<string, Span>();

let registered = false;

/**
 * Model calls and tool runs as spans: model, tokens, timings and outcome. Prompts, messages and
 * outputs are never recorded: they are people's conversations and private work.
 */
export function traceModelCalls() {
  if (registered) {
    return;
  }
  registered = true;
  registerTelemetry(integration());
}

function integration(): Telemetry {
  return {
    onStart: (event) => {
      open(
        operations,
        event.callId,
        startSpan(event.operationId, {
          "ai.function": event.functionId,
          "ai.provider": "provider" in event ? event.provider : undefined,
          "ai.model": "modelId" in event ? event.modelId : undefined,
        })
      );
    },
    onLanguageModelCallStart: (event) => {
      open(
        modelCalls,
        event.callId,
        startSpan(
          "ai.model_call",
          { "ai.provider": event.provider, "ai.model": event.modelId },
          { kind: "client", parent: operations.get(event.callId) }
        )
      );
    },
    onLanguageModelCallEnd: (event) => {
      const span = close(modelCalls, event.callId);
      if (!span) {
        return;
      }
      span.set({
        "ai.model": event.modelId,
        "ai.finish_reason": event.finishReason,
        "ai.tokens.input": event.usage.inputTokens,
        "ai.tokens.cache_read": event.usage.inputTokenDetails.cacheReadTokens,
        "ai.tokens.cache_write": event.usage.inputTokenDetails.cacheWriteTokens,
        "ai.tokens.output": event.usage.outputTokens,
        "ai.tokens.reasoning": event.usage.outputTokenDetails.reasoningTokens,
        "ai.first_output_ms": event.performance.timeToFirstOutputMs,
      });
      span.end();
    },
    onToolExecutionStart: (event) => {
      open(
        tools,
        event.toolCall.toolCallId,
        startSpan(
          "ai.tool",
          { "ai.tool": event.toolCall.toolName },
          { parent: operations.get(event.callId) }
        )
      );
    },
    onToolExecutionEnd: (event) => {
      const span = close(tools, event.toolCall.toolCallId);
      if (!span) {
        return;
      }
      if (event.toolOutput.type === "tool-error") {
        span.fail(event.toolOutput.error);
      }
      span.end();
    },
    onEnd: (event) => {
      if ("callId" in event) {
        close(operations, event.callId)?.end();
      }
    },
    onAbort: (event) => {
      const span = close(operations, event.callId);
      span?.set({ "ai.aborted": true });
      span?.end();
    },
    executeTool: async ({ toolCallId, execute }) => {
      const span = tools.get(toolCallId);
      return span ? await runIn(span, execute) : await execute();
    },
    executeLanguageModelCall: async ({ callId, execute }) => {
      const span = modelCalls.get(callId);
      return span ? await runIn(span, execute) : await execute();
    },
    onError: (event) => {
      if (!isErrorEvent(event)) {
        return;
      }
      const call = close(modelCalls, event.callId);
      call?.fail(event.error);
      call?.end();
      const span = close(operations, event.callId);
      span?.fail(event.error);
      span?.end();
    },
  };
}

function open(spans: Map<string, Span>, id: string, span: Span) {
  spans.set(id, span);
  if (spans.size > MAX_OPEN) {
    const [oldest] = spans.keys();
    if (oldest !== undefined) {
      spans.delete(oldest);
    }
  }
}

function close(spans: Map<string, Span>, id: string) {
  const span = spans.get(id);
  spans.delete(id);
  return span;
}

function isErrorEvent(
  event: unknown
): event is { callId: string; error: unknown } {
  return (
    typeof event === "object" &&
    event !== null &&
    "callId" in event &&
    typeof event.callId === "string"
  );
}
