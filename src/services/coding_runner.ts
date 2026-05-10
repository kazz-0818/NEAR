import { createHmac } from "node:crypto";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";
import { parseGithubRepo } from "../lib/githubRepo.js";
import { ensureGithubIssueForSuggestion } from "./growth_github_issue.js";

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

/** GitHub Issues API で Growth 用 Issue を作成（本文フォーマット・DB 保存は growth_github_issue に集約） */
class GitHubIssueCodingRunner implements CodingRunner {
  readonly mode = "auto" as const;

  async onCodingPhaseEntered(input: {
    db: Db;
    suggestionId: number;
    cursorPrompt: string;
  }): Promise<CodingRunnerResult> {
    const r = await ensureGithubIssueForSuggestion(input.db, input.suggestionId);
    if (r.ok) {
      return {
        ok: true,
        message: r.created
          ? `GitHub Issue を作成しました: ${r.issueUrl}（Cursor で開いて実装を進めてください）`
          : `既に GitHub Issue があります: ${r.issueUrl}（Cursor で開いて実装を進めてください）`,
      };
    }
    return {
      ok: false,
      message: `GitHub Issue の自動作成に失敗しました: ${r.message}。手動で cursor-prompt を取得して Cursor に貼ってください。`,
    };
  }
}

const agentPostTimestamps: number[] = [];

function takeAgentRateSlot(rpm: number): boolean {
  const now = Date.now();
  while (agentPostTimestamps.length > 0 && now - agentPostTimestamps[0]! > 60_000) {
    agentPostTimestamps.shift();
  }
  if (agentPostTimestamps.length >= rpm) return false;
  agentPostTimestamps.push(now);
  return true;
}

/** 社内エージェントへプロンプトを POST（任意で HMAC 署名） */
class AgentWebhookCodingRunner implements CodingRunner {
  readonly mode = "auto" as const;

  constructor(
    private readonly url: string,
    private readonly secret: string | undefined,
    private readonly rpm: number
  ) {}

  async onCodingPhaseEntered(input: {
    db: Db;
    suggestionId: number;
    cursorPrompt: string;
  }): Promise<CodingRunnerResult> {
    const log = getLogger();
    if (!takeAgentRateSlot(this.rpm)) {
      return {
        ok: false,
        message: `エージェントへの送信レート上限（${this.rpm} 回/分）に達しました。しばらく待ってから管理 API で状態を確認するか、手動で cursor-prompt を取得してください。`,
      };
    }
    const payload = {
      source: "near",
      suggestionId: input.suggestionId,
      cursorPrompt: input.cursorPrompt,
    };
    const rawBody = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.secret) {
      const sig = createHmac("sha256", this.secret).update(rawBody).digest("hex");
      headers["X-NEAR-Signature"] = `sha256=${sig}`;
    }
    try {
      const res = await fetch(this.url, { method: "POST", headers, body: rawBody });
      const snippet = (await res.text()).slice(0, 300);
      if (!res.ok) {
        log.warn({ status: res.status, snippet, suggestionId: input.suggestionId }, "coding agent webhook failed");
        return {
          ok: false,
          message: `エージェントが ${res.status} を返しました。手動で cursor-prompt を取得して Cursor に貼ってください。`,
        };
      }
      return {
        ok: true,
        message: "エージェントへ実装指示を送信しました。エージェント側のログと PR を確認してください。",
      };
    } catch (e) {
      log.warn({ err: e, suggestionId: input.suggestionId }, "coding agent webhook exception");
      return {
        ok: false,
        message: "エージェント URL への接続に失敗しました。URL・ファイアウォールを確認するか、手動運用に切り替えてください。",
      };
    }
  }
}

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
        "自動コーディングは有効ですが、GitHub Issue 連携（GITHUB_TOKEN + GROWTH_GITHUB_REPO）もエージェント URL も未設定です。DEPLOY.md を参照するか GROWTH_AUTO_CODING_ENABLED をオフにしてください。",
    };
  }
}

export function createCodingRunner(): CodingRunner {
  const env = getEnv();
  if (!env.GROWTH_AUTO_CODING_ENABLED) {
    return new ManualCodingRunner();
  }
  const gh = parseGithubRepo(env.GROWTH_GITHUB_REPO);
  if (env.GITHUB_TOKEN && gh) {
    return new GitHubIssueCodingRunner();
  }
  if (env.GROWTH_CODING_AGENT_URL) {
    return new AgentWebhookCodingRunner(
      env.GROWTH_CODING_AGENT_URL,
      env.GROWTH_CODING_AGENT_SECRET,
      env.GROWTH_CODING_AGENT_RPM
    );
  }
  return new StubAutoCodingRunner();
}
