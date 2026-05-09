import { resolveUserOperation } from "./utteranceResolver.js";

export type TaskUtteranceKind =
  | "add_task"
  | "local_task_list"
  | "read_task_sheet"
  | "delete_task"
  | "update_task"
  | "ambiguous_task"
  | "not_task";

export type TaskUtteranceClassification = {
  kind: TaskUtteranceKind;
  confidence: number;
  extractedText?: string;
  targetNumber?: number;
  reason: string;
};

export function classifyTaskUtterance(text: string): TaskUtteranceClassification {
  const r = resolveUserOperation({ text });
  const kind: TaskUtteranceKind =
    r.kind === "task.add"
      ? "add_task"
      : r.kind === "task.list.local"
        ? "local_task_list"
        : r.kind === "task.list.sheet"
          ? "read_task_sheet"
          : r.kind === "task.delete"
            ? "delete_task"
            : r.kind === "task.update"
              ? "update_task"
              : r.kind === "task.clarify"
                ? "ambiguous_task"
                : "not_task";
  return {
    kind,
    confidence: r.confidence,
    extractedText: r.extractedText,
    targetNumber: r.targetNumber,
    reason: r.reason,
  };
}
