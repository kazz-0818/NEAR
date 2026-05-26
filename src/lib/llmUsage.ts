import { getLogger } from "./logger.js";

/** RITS POST /admin/usage 想定（API 未実装の間は記録のみ） */
export type LlmUsagePayload = {
  agent_name: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  source: string;
  metadata?: Record<string, unknown>;
};

type ChatCompletionLike = {
  model?: string | null;
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  } | null;
};

type ResponseLike = {
  model?: string | null;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
  } | null;
};

export function usageFromChatCompletion(
  completion: ChatCompletionLike,
  input: { agentName: string; source: string; model?: string }
): LlmUsagePayload | null {
  const u = completion.usage;
  if (!u) return null;
  const prompt = u.prompt_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? 0;
  if (prompt === 0 && completionTokens === 0) return null;
  return {
    agent_name: input.agentName,
    model: input.model ?? completion.model ?? "unknown",
    prompt_tokens: prompt,
    completion_tokens: completionTokens,
    total_tokens: u.total_tokens ?? prompt + completionTokens,
    source: input.source,
  };
}

/** OpenAI Responses API（input_tokens / output_tokens） */
export function usageFromResponse(
  resp: ResponseLike,
  input: { agentName: string; source: string; model?: string }
): LlmUsagePayload | null {
  const u = resp.usage;
  if (!u) return null;
  const prompt = u.input_tokens ?? 0;
  const completionTokens = u.output_tokens ?? 0;
  if (prompt === 0 && completionTokens === 0) return null;
  return {
    agent_name: input.agentName,
    model: input.model ?? resp.model ?? "unknown",
    prompt_tokens: prompt,
    completion_tokens: completionTokens,
    total_tokens: u.total_tokens ?? prompt + completionTokens,
    source: input.source,
  };
}

/**
 * LLM usage を捨てずに保持。RITS API 準備後はここから POST するだけ。
 */
export function recordLlmUsage(payload: LlmUsagePayload): void {
  getLogger().debug(
    {
      agent_name: payload.agent_name,
      model: payload.model,
      prompt_tokens: payload.prompt_tokens,
      completion_tokens: payload.completion_tokens,
      total_tokens: payload.total_tokens,
      source: payload.source,
    },
    "llm_usage_recorded"
  );
  void sendLlmUsageToRits(payload).catch(() => undefined);
}

/** VELIORA_RITS_BASE_URL + VELIORA_RITS_ADMIN_API_KEY があるときのみ送信（未設定は no-op） */
export async function sendLlmUsageToRits(payload: LlmUsagePayload): Promise<void> {
  const base = process.env.VELIORA_RITS_BASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.VELIORA_RITS_ADMIN_API_KEY?.trim();
  if (!base || !key || key.length < 12) return;

  const url = `${base}/admin/usage`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-api-key": key,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    getLogger().warn(
      { status: res.status, body: body.slice(0, 200), url },
      "sendLlmUsageToRits failed (non-fatal)"
    );
  }
}
