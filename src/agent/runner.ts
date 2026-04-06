import OpenAI from "openai";
import type {
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
  Tool,
} from "openai/resources/responses/responses";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import { mergeModuleSituations, type AgentComposeSituation } from "./composeSituation.js";
import { extractVisibleAssistantText } from "./responseText.js";
import { loadNearAgentInstructions } from "./loadInstructions.js";
import type { NearAgentTurnInput, NearAgentTurnResult } from "./types.js";
import { executeNearAgentFunction } from "./tools/execute.js";
import { NEAR_AGENT_FUNCTION_TOOLS } from "./tools/definitions.js";

function isFunctionCall(item: { type?: string }): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

function collectFunctionCalls(output: Response["output"]): ResponseFunctionToolCall[] {
  return output.filter(isFunctionCall);
}

function buildAgentUserContent(input: NearAgentTurnInput): string {
  const prevU = input.recentUserMessages
    .filter((s) => s.trim())
    .slice(-6)
    .map((s, i) => `${i + 1}. ${s.trim()}`)
    .join("\n");
  const prevA = input.recentAssistantMessages
    .filter((s) => s.trim())
    .slice(-4)
    .map((s, i) => `${i + 1}. ${s.trim()}`)
    .join("\n\n");

  const blocks: string[] = [];
  if (prevU) blocks.push(`【このトークで先のユーザー発言（古い順・抜粋）】\n${prevU}`);
  if (prevA) blocks.push(`【NEAR の直近の返答（古い順・抜粋）】\n${prevA}`);
  blocks.push(`【今回のユーザー発言】\n${input.userText.trim()}`);
  return blocks.join("\n\n");
}

function buildTools(env: ReturnType<typeof getEnv>): Tool[] {
  const tools: Tool[] = [...NEAR_AGENT_FUNCTION_TOOLS];
  if (env.NEAR_AGENT_WEB_SEARCH) {
    tools.unshift({ type: "web_search_preview" });
  }
  return tools;
}

function softFailureMessage(): string {
  return "申し訳ないです、外部の情報を取りに行く処理で一時的にうまくいきませんでした。言い換えて聞いてもらえると助かります。";
}

function done(
  text: string,
  log: NearAgentTurnResult["log"],
  composeSituation: AgentComposeSituation
): NearAgentTurnResult {
  return { text, log, composeSituation };
}

/**
 * OpenAI Responses API でツールループ（Web 検索はホスト側、関数は自前実行）。
 */
export async function runNearAgentTurn(input: NearAgentTurnInput): Promise<NearAgentTurnResult> {
  const env = getEnv();
  const log = getLogger();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const instructions = await loadNearAgentInstructions();
  const tools = buildTools(env);
  const toolsInvoked: string[] = [];
  const maxSteps = env.NEAR_AGENT_MAX_STEPS;

  let composeSituation: AgentComposeSituation = "success";

  let previousResponseId: string | undefined;
  let nextInput: ResponseInputItem[] = [
    {
      role: "user",
      content: buildAgentUserContent(input),
      type: "message",
    },
  ];

  let step = 0;
  while (step < maxSteps) {
    step++;
    let resp: Response;
    try {
      resp = (await client.responses.create({
        model: env.OPENAI_AGENT_MODEL,
        instructions,
        tools,
        tool_choice: "auto",
        parallel_tool_calls: true,
        max_output_tokens: 1600,
        truncation: "auto",
        metadata: { near_inbound: String(input.inboundMessageId) },
        user: input.channelUserId,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        input: nextInput,
      })) as Response;
    } catch (e) {
      log.error({ err: e, step }, "near agent responses.create failed");
      throw e;
    }

    previousResponseId = resp.id;

    if (resp.error) {
      log.warn({ error: resp.error, step }, "near agent response error object");
      return done(softFailureMessage(), {
        steps: step,
        toolsInvoked,
        model: env.OPENAI_AGENT_MODEL,
        webSearchEnabled: env.NEAR_AGENT_WEB_SEARCH,
      }, "error");
    }

    const calls = collectFunctionCalls(resp.output);
    for (const c of calls) {
      toolsInvoked.push(c.name);
    }

    if (calls.length === 0) {
      const text = extractVisibleAssistantText(resp);
      log.info(
        {
          inboundMessageId: input.inboundMessageId,
          step,
          toolsInvoked,
          status: resp.status,
          model: env.OPENAI_AGENT_MODEL,
        },
        "near agent turn completed"
      );
      return done(
        text ||
          "すみません、うまく言葉にできませんでした。もう少しだけ具体的に聞いてもらえますか？",
        {
          steps: step,
          toolsInvoked,
          model: env.OPENAI_AGENT_MODEL,
          webSearchEnabled: env.NEAR_AGENT_WEB_SEARCH,
        },
        composeSituation
      );
    }

    if (step >= maxSteps) {
      log.warn({ inboundMessageId: input.inboundMessageId, step }, "near agent stopped at tool round (step budget)");
      return done(
        "処理が長引いたので、いったんここまでにします。続きは分けて聞いてもらえると助かります。",
        {
          steps: step,
          toolsInvoked,
          model: env.OPENAI_AGENT_MODEL,
          webSearchEnabled: env.NEAR_AGENT_WEB_SEARCH,
        },
        mergeModuleSituations(composeSituation, "error")
      );
    }

    nextInput = [];
    for (const call of calls) {
      const r = await executeNearAgentFunction(call.name, call.arguments, input);
      composeSituation = mergeModuleSituations(composeSituation, r.delegateSituation);
      nextInput.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: r.output,
      });
    }
  }

  return done(
    "いったんここまでにします。また続きを聞かれたら、改めてお手伝いします。",
    {
      steps: maxSteps,
      toolsInvoked,
      model: env.OPENAI_AGENT_MODEL,
      webSearchEnabled: env.NEAR_AGENT_WEB_SEARCH,
    },
    mergeModuleSituations(composeSituation, "error")
  );
}
