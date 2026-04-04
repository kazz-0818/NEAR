import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";

export type CodingRunnerMode = "manual" | "auto";

export type CodingRunnerResult = {
  ok: boolean;
  message: string;
};

/**
 * モードA: 手動（Cursor へ貼るだけ）／モードB: 自動（adapter 差し替え）
 * 本体は環境依存の実行をここに閉じ込めない。
 */
export interface CodingRunner {
  readonly mode: CodingRunnerMode;
  onCodingPhaseEntered(input: { db: Db; suggestionId: number; cursorPrompt: string }): Promise<CodingRunnerResult>;
}

class ManualCodingRunner implements CodingRunner {
  readonly mode = "manual" as const;
  async onCodingPhaseEntered(_input: {
    db: Db;
    suggestionId: number;
    cursorPrompt: string;
  }): Promise<CodingRunnerResult> {
    return {
      ok: true,
      message:
        "手動モードです。お送りした実装指示を Cursor に貼り、ローカルで実装・テストを進めてください。完了したら「成長完了」と返信するか、管理 API で状態を進めてください。",
    };
  }
}

/** 将来: Cursor CLI / CI / サンドボックスをここに接続 */
class StubAutoCodingRunner implements CodingRunner {
  readonly mode = "auto" as const;
  async onCodingPhaseEntered(_input: {
    db: Db;
    suggestionId: number;
    cursorPrompt: string;
  }): Promise<CodingRunnerResult> {
    const log = getLogger();
    log.info({ suggestionId: _input.suggestionId }, "auto coding runner: stub (no external executor wired)");
    return {
      ok: false,
      message:
        "自動コーディングは有効ですが、実行アダプタが未接続です。いったん手動で Cursor に貼る運用に切り替えてください（GROWTH_AUTO_CODING_ENABLED をオフにするのが簡単です）。",
    };
  }
}

export function createCodingRunner(): CodingRunner {
  const env = getEnv();
  if (env.GROWTH_AUTO_CODING_ENABLED) {
    return new StubAutoCodingRunner();
  }
  return new ManualCodingRunner();
}
