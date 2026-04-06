import type { Response, ResponseOutputItem } from "openai/resources/responses/responses";

function textFromOutputItem(item: ResponseOutputItem): string {
  if (item.type !== "message" || item.role !== "assistant") return "";
  const parts: string[] = [];
  for (const c of item.content) {
    if (c.type === "output_text" && c.text) parts.push(c.text);
    if (c.type === "refusal" && "refusal" in c && c.refusal) parts.push(c.refusal);
  }
  return parts.join("\n").trim();
}

/** SDK の output_text が空でも、output から最終アシスタント文を拾う */
export function extractVisibleAssistantText(resp: Response): string {
  const direct = resp.output_text?.trim() ?? "";
  if (direct) return direct;
  for (let i = resp.output.length - 1; i >= 0; i--) {
    const t = textFromOutputItem(resp.output[i]!);
    if (t) return t;
  }
  return "";
}
