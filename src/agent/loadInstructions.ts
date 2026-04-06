import { loadPrompt } from "../lib/promptLoader.js";

const PERSONA_MAX_CHARS = 2800;

/**
 * 人格（冒頭）＋エージェント専用ルール。モデル変更時もプロンプトファイルだけ差し替えやすくする。
 */
export async function loadNearAgentInstructions(): Promise<string> {
  const [persona, agent] = await Promise.all([
    loadPrompt("prompts/near.persona.md"),
    loadPrompt("prompts/agent/instructions.md"),
  ]);
  const head = persona.length <= PERSONA_MAX_CHARS ? persona : `${persona.slice(0, PERSONA_MAX_CHARS)}\n…（略）`;
  return `${head}\n\n---\n\n${agent}`;
}
