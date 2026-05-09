import { z } from "zod";

export const SEMANTIC_OPERATION_KINDS = [
  "task.add",
  "task.list.local",
  "task.list.sheet",
  "task.delete",
  "task.update",
  "memo.save",
  "reminder.create",
  "sheet.query",
  "calendar.query",
  "general.chat",
  "clarify",
  "unknown",
] as const;

export const ROUTE_HINTS = [
  "task_line",
  "near_save_task",
  "near_read_task_sheet",
  "near_google_sheets_query",
  "memo_store",
  "reminder_manager",
  "agent",
  "clarify",
] as const;

export const DANGER_LEVELS = ["none", "low", "medium", "high"] as const;

export const semanticOperationSchema = z.object({
  kind: z.enum(SEMANTIC_OPERATION_KINDS),
  confidence: z.number().min(0).max(1),
  extracted_text: z.string().nullable(),
  target_number: z.number().int().positive().nullable(),
  target_label: z.string().nullable(),
  needs_confirmation: z.boolean(),
  danger_level: z.enum(DANGER_LEVELS),
  reason: z.string(),
  route_hint: z.enum(ROUTE_HINTS),
});

export type SemanticOperationKind = (typeof SEMANTIC_OPERATION_KINDS)[number];
export type SemanticOperation = z.infer<typeof semanticOperationSchema>;
