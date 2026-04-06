import { insertAgentToolRun } from "../../db/agent_tool_runs_repo.js";
import { memoStore } from "../../modules/memo_store.js";
import { reminderManager } from "../../modules/reminder_manager.js";
import { taskManager } from "../../modules/task_manager.js";
import type { ModuleResult } from "../../modules/types.js";
import { syntheticAgentIntent } from "../syntheticIntent.js";
import type { NearAgentTurnInput } from "../types.js";
import { toModuleContext } from "./moduleContext.js";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * DB に保存済みの args のみから副作用ツールを再実行する（ユーザー文言の再パース禁止）。
 */
export async function executeStoredSideEffectTool(
  toolName: string,
  argsJson: Record<string, unknown>,
  input: NearAgentTurnInput
): Promise<{ mod: ModuleResult; toolNameForLog: string }> {
  const started = performance.now();
  const rec = asRecord(argsJson);
  const logTool = toolName;

  const finish = async (mod: ModuleResult, ok: boolean, errorCode: string | null) => {
    try {
      await insertAgentToolRun({
        db: input.db,
        channel: input.channel,
        channelUserId: input.channelUserId,
        inboundMessageId: input.inboundMessageId,
        toolName: `${logTool}_confirmed`,
        ok,
        situation: mod.situation,
        durationMs: Math.round(performance.now() - started),
        errorCode,
      });
    } catch {
      /* ログ失敗は本処理に影響させない */
    }
    return { mod, toolNameForLog: logTool };
  };

  try {
    switch (toolName) {
      case "near_save_task": {
        const title = typeof rec.title === "string" ? rec.title.trim() : "";
        if (!title) {
          const mod: ModuleResult = {
            success: false,
            situation: "error",
            draft: "タスクの保存に必要な情報が足りませんでした。もう一度お願いします。",
          };
          return await finish(mod, false, "title_required");
        }
        const notesVal = rec.notes;
        const params: Record<string, unknown> = { title };
        if (typeof notesVal === "string" && notesVal.trim()) {
          params.notes = notesVal.trim();
        }
        const intent = syntheticAgentIntent("task_create", params);
        const mod = await taskManager(toModuleContext(input, intent, title));
        return await finish(mod, mod.success, mod.success ? null : "task_failed");
      }
      case "near_save_memo": {
        const body = typeof rec.body === "string" ? rec.body.trim() : "";
        if (!body) {
          const mod: ModuleResult = {
            success: false,
            situation: "error",
            draft: "メモの保存に必要な本文がありませんでした。もう一度お願いします。",
          };
          return await finish(mod, false, "body_required");
        }
        const intent = syntheticAgentIntent("memo_save", { body });
        const mod = await memoStore(toModuleContext(input, intent, body));
        return await finish(mod, mod.success, mod.success ? null : "memo_failed");
      }
      case "near_save_reminder": {
        const msg = typeof rec.reminder_message === "string" ? rec.reminder_message.trim() : "";
        const when = typeof rec.when_description === "string" ? rec.when_description.trim() : "";
        if (!msg || !when) {
          const mod: ModuleResult = {
            success: false,
            situation: "error",
            draft: "リマインドの保存に必要な情報が足りませんでした。もう一度お願いします。",
          };
          return await finish(mod, false, "reminder_message_and_when_required");
        }
        const originalText = `${when} ${msg}`.trim();
        const intent = syntheticAgentIntent("reminder_request", { message: msg });
        const mod = await reminderManager(toModuleContext(input, intent, originalText));
        return await finish(mod, mod.success, mod.success ? null : "reminder_failed");
      }
      default: {
        const mod: ModuleResult = {
          success: false,
          situation: "error",
          draft: "この種類の確定実行には対応していません。",
        };
        return await finish(mod, false, "unknown_stored_tool");
      }
    }
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "execution_failed";
    const mod: ModuleResult = {
      success: false,
      situation: "error",
      draft: "処理中にエラーが発生しました。もう一度お試しください。",
    };
    return await finish(mod, false, msg.slice(0, 200));
  }
}
