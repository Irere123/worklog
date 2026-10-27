import { z } from "@hono/zod-openapi";

import type { Automation as AutomationRow } from "#db/queries/automations";
import { AUTOMATION_KINDS } from "#db/schema";

import { derived, HH_MM, Timestamp } from "./common";

const HHMM = z.string().regex(HH_MM);

export const Schedule = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("daily"),
      at: HHMM,
      weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    }),
    z.object({
      type: z.literal("weekly"),
      weekday: z.number().int().min(0).max(6),
      at: HHMM,
    }),
    z.object({
      type: z.literal("interval"),
      minutes: z.number().int().min(5),
      activeHoursOnly: z.boolean().optional(),
    }),
  ])
  .openapi("Schedule");

export const Automation = z
  .object({
    id: z.string(),
    kind: z.enum(AUTOMATION_KINDS),
    name: z.string().min(1),
    schedule: Schedule,
    targetIds: z.array(z.string()),
    instructions: z.string().nullable(),
    enabled: z.boolean(),
    nextRunAt: Timestamp.nullable(),
    lastRunAt: Timestamp.nullable(),
    lastStatus: z.string().nullable(),
    lastResult: z
      .object({ status: z.string(), summary: z.string(), at: z.string() })
      .nullable(),
    failureCount: z.number().int(),
  })
  .openapi("Automation");

export const AutomationResponse = derived(Automation, (a: AutomationRow) => ({
  ...a,
  lastResult: a.state.lastResult ?? null,
}));

export const CreateAutomationRequest = z.object({
  kind: z.enum(AUTOMATION_KINDS).default("custom"),
  name: Automation.shape.name,
  schedule: Schedule,
  instructions: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const UpdateAutomationRequest = z.object({
  name: Automation.shape.name.optional(),
  schedule: Schedule.optional(),
  instructions: z.string().nullable().optional(),
  targetIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const AutomationRun = z
  .object({
    id: z.string(),
    status: z.enum(["skipped", "quiet", "delivered", "failed"]),
    summary: z.string().nullable(),
    error: z.string().nullable(),
    startedAt: Timestamp,
    finishedAt: Timestamp,
  })
  .openapi("AutomationRun");

export const RunResultResponse = z.object({
  status: z.string(),
  summary: z.string(),
});
