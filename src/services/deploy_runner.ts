import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import type { Db } from "../db/client.js";

export type DeployRunnerMode = "manual" | "auto";

export type DeployRunnerResult = {
  ok: boolean;
  message: string;
};

export interface DeployRunner {
  readonly mode: DeployRunnerMode;
  runDeploy(input: {
    db: Db;
    suggestionId: number;
    deploySafetyConfirmed: boolean;
  }): Promise<DeployRunnerResult>;
}

class ManualDeployRunner implements DeployRunner {
  readonly mode = "manual" as const;
  async runDeploy(_input: {
    db: Db;
    suggestionId: number;
    deploySafetyConfirmed: boolean;
  }): Promise<DeployRunnerResult> {
    return {
      ok: true,
      message:
        "手動デプロイモードです。Git に push して Render 等のパイプラインで反映してください。反映後「成長完了」で完了扱いにできます。",
    };
  }
}

class StubAutoDeployRunner implements DeployRunner {
  readonly mode = "auto" as const;
  async runDeploy(input: {
    db: Db;
    suggestionId: number;
    deploySafetyConfirmed: boolean;
  }): Promise<DeployRunnerResult> {
    const log = getLogger();
    if (!input.deploySafetyConfirmed) {
      return {
        ok: false,
        message: "デプロイ前に deploy_safety_confirmed を true にしてください。",
      };
    }
    log.info({ suggestionId: input.suggestionId }, "auto deploy runner: stub (no pipeline wired)");
    return {
      ok: false,
      message:
        "自動デプロイは有効ですが、デプロイアダプタが未接続です。手動でデプロイするか GROWTH_AUTO_DEPLOY_ENABLED をオフにしてください。",
    };
  }
}

export function createDeployRunner(): DeployRunner {
  const env = getEnv();
  if (env.GROWTH_AUTO_DEPLOY_ENABLED) {
    return new StubAutoDeployRunner();
  }
  return new ManualDeployRunner();
}
