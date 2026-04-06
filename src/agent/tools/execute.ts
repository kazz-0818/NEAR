import { insertAgentToolRun } from "../../db/agent_tool_runs_repo.js";
import { isValidSpreadsheetId } from "../../lib/googleSheetsAuth.js";
import { memoStore } from "../../modules/memo_store.js";
import { reminderManager } from "../../modules/reminder_manager.js";
import { sheetsQuery } from "../../modules/sheets_query.js";
import { summarizer } from "../../modules/summarizer.js";
import { taskManager } from "../../modules/task_manager.js";
import type { ModuleResult } from "../../modules/types.js";
import { listCapabilityLines } from "../../modules/capabilities.js";
import { syntheticAgentIntent } from "../syntheticIntent.js";
import type { NearAgentTurnInput } from "../types.js";
import { toModuleContext } from "./moduleContext.js";

const MAX_DRAFT_CHARS = 14_000;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function moduleResultToToolPayload(mod: ModuleResult): Record<string, unknown> {
  const draft = mod.draft;
  const truncated = draft.length > MAX_DRAFT_CHARS;
  return {
    ok: mod.success,
    situation: mod.situation,
    draft: truncated ? draft.slice(0, MAX_DRAFT_CHARS) : draft,
    draft_truncated: truncated,
    hint:
      mod.situation === "followup"
        ? "draft はユーザーへの返信としてそのまま使ってよい（候補番号の選択など）。"
        : "draft の数値・事実は変えず、必要なら短く要約して返してよい。",
  };
}

async function finishToolExecution(
  input: NearAgentTurnInput,
  toolName: string,
  started: number,
  output: string,
  delegateSituation?: ModuleResult["situation"]
): Promise<{ output: string; delegateSituation?: ModuleResult["situation"] }> {
  let situationForLog: string | null = delegateSituation ?? null;
  let ok = true;
  let errorCode: string | null = null;
  try {
    const j = JSON.parse(output) as { ok?: boolean; situation?: string; error?: string };
    if (typeof j.situation === "string") situationForLog = j.situation;
    if (j.ok === false) ok = false;
    if (typeof j.error === "string") errorCode = j.error;
  } catch {
    ok = false;
    errorCode = "invalid_tool_json";
  }
  try {
    await insertAgentToolRun({
      db: input.db,
      channel: input.channel,
      channelUserId: input.channelUserId,
      inboundMessageId: input.inboundMessageId,
      toolName,
      ok,
      situation: situationForLog,
      durationMs: Math.round(performance.now() - started),
      errorCode,
    });
  } catch {
    /* ログ失敗は本処理に影響させない */
  }
  return { output, delegateSituation };
}

/**
 * モデルが選んだ関数をサーバーで実行し、Responses API 用の JSON 文字列を返す。
 * ユーザー向け本文ではなく、次ターンのモデル入力用。
 */
export async function executeNearAgentFunction(
  name: string,
  argumentsJson: string,
  input: NearAgentTurnInput
): Promise<{ output: string; delegateSituation?: ModuleResult["situation"] }> {
  const started = performance.now();

  let args: unknown = {};
  try {
    args = argumentsJson?.trim() ? JSON.parse(argumentsJson) : {};
  } catch {
    return finishToolExecution(
      input,
      name,
      started,
      JSON.stringify({ ok: false, error: "invalid_arguments_json" })
    );
  }
  const rec = asRecord(args);

  try {
    switch (name) {
      case "near_list_capabilities": {
        const lines = await listCapabilityLines(input.db);
        return finishToolExecution(
          input,
          name,
          started,
          JSON.stringify({ ok: true, capability_lines: lines })
        );
      }
      case "near_get_server_time": {
        return finishToolExecution(
          input,
          name,
          started,
          JSON.stringify({ ok: true, iso_utc: new Date().toISOString() })
        );
      }
      case "near_google_sheets_query": {
        const question = typeof rec.question === "string" ? rec.question.trim() : "";
        if (!question) {
          return finishToolExecution(
            input,
            name,
            started,
            JSON.stringify({ ok: false, error: "question_required" })
          );
        }
        const sidRaw = rec.spreadsheet_id;
        const hintRaw = rec.spreadsheet_name_hint;
        let originalText = question;
        if (typeof hintRaw === "string" && hintRaw.trim()) {
          originalText = `【ファイル名の手がかり】${hintRaw.trim()}\n${question}`;
        }
        const params: Record<string, unknown> = {};
        if (typeof sidRaw === "string" && sidRaw.trim() && isValidSpreadsheetId(sidRaw.trim())) {
          params.spreadsheet_id = sidRaw.trim();
        }
        const intent = syntheticAgentIntent("google_sheets_query", params);
        const mod = await sheetsQuery(toModuleContext(input, intent, originalText));
        return finishToolExecution(
          input,
          name,
          started,
          JSON.stringify({ ok: true, ...moduleResultToToolPayload(mod) }),
          mod.situation
        );
      }
      case "near_save_task": {
        const title = typeof rec.title === "string" ? rec.title.trim() : "";
        if (!title) {
          return finishToolExecution(
            input,
            name,
            started,
            JSON.stringify({ ok: false, error: "title_required" })
          );
        }
        const notesVal = rec.notes;
        const params: Record<string, unknown> = { title };
        if (typeof notesVal === "string" && notesVal.trim()) {
          params.notes = notesVal.trim();
        }
        const intent = syntheticAgentIntent("task_create", params);
        const mod = await taskManager(toModuleContext(input, intent, title));
        return finishToolExecution(
          input,
          name,
          started,
          JSON.stringify({ ok: true, ...moduleResultToToolPayload(mod) }),
          mod.situation
        );
      }
      case "near_save_memo": {
        const body = typeof rec.body === "string" ? rec.body.trim() : "";
        if (!body) {
          return finishToolExecution(
            input,
            name,
            started,
            JSON.stringify({ ok: false, error: "body_required" })
          );
        }
        const intent = syntheticAgentIntent("memo_save", { body });
        const mod = await memoStore(toModuleContext(input, intent, body));
        return finishToolExecution(
          input,
          name,
          started,
          JSON.stringify({ ok: true, ...moduleResultToToolPayload(mod) }),
          mod.situation
        );
      }
      case "near_summarize": {
        const text = typeof rec.text === "string" ? rec.text.trim() : "";
        if (!text) {
          return finishToolExecution(
            input,
            name,
            started,
            JSON.stringify({ ok: false, error: "text_required" })
          );
        }
        const intent = syntheticAgentIntent("summarize", { text });
        const mod = await summarizer(toModuleContext(input, intent, text));
        return finishToolExecution(
          input,
          name,
          started,
          JSON.stringify({ ok: true, ...moduleResultToToolPayload(mod) }),
          mod.situation
        );
      }
      case "near_save_reminder": {
        const msg = typeof rec.reminder_message === "string" ? rec.reminder_message.trim() : "";
        const when = typeof rec.when_description === "string" ? rec.when_description.trim() : "";
        if (!msg || !when) {
          return finishToolExecution(
            input,
            name,
            started,
            JSON.stringify({ ok: false, error: "reminder_message_and_when_required" })
          );
        }
        const originalText = `${when} ${msg}`.trim();
        const intent = syntheticAgentIntent("reminder_request", { message: msg });
        const mod = await reminderManager(toModuleContext(input, intent, originalText));
        return finishToolExecution(
          input,
          name,
          started,
          JSON.stringify({ ok: true, ...moduleResultToToolPayload(mod) }),
          mod.situation
        );
      }
      default:
        return finishToolExecution(
          input,
          name,
          started,
          JSON.stringify({ ok: false, error: "unknown_tool", tool: name })
        );
    }
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "tool_failed";
    return finishToolExecution(
      input,
      name,
      started,
      JSON.stringify({ ok: false, error: "execution_failed", detail: msg.slice(0, 200) })
    );
  }
}
