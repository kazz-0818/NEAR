/**
 * Phase 3: 読み取り時 env alias（canonical ← legacy）。
 * 本番 Render の一斉リネームなしで新規キーを使えるようにする。
 */

export type EnvAliasRule = {
  /** Zod / getEnv が参照するキー */
  canonical: string;
  /** 古いキー（優先順: 先に列挙したものを先に試す） */
  legacy: readonly string[];
  /** true のとき legacy 使用を warn */
  deprecatedLegacy?: boolean;
};

function pickFirstSet(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function applyEnvAliases(
  rules: readonly EnvAliasRule[],
  opts?: { service?: string }
): void {
  const service = opts?.service ?? "app";
  for (const rule of rules) {
    if (pickFirstSet(process.env, [rule.canonical])) continue;
    for (const leg of rule.legacy) {
      const v = pickFirstSet(process.env, [leg]);
      if (!v) continue;
      process.env[rule.canonical] = v;
      if (rule.deprecatedLegacy) {
        console.warn(
          `[veriora-env:${service}] deprecated env "${leg}" → use "${rule.canonical}"`
        );
      }
      break;
    }
  }
}

/** NEAR: 新規 `NEAR_*` を既存スキーマキーへマップ */
export const NEAR_ENV_ALIASES: readonly EnvAliasRule[] = [
  {
    canonical: "LINE_CHANNEL_SECRET",
    legacy: ["NEAR_LINE_CHANNEL_SECRET"],
  },
  {
    canonical: "LINE_CHANNEL_ACCESS_TOKEN",
    legacy: ["NEAR_LINE_CHANNEL_ACCESS_TOKEN"],
  },
  {
    canonical: "LINE_BOT_USER_ID",
    legacy: ["NEAR_LINE_BOT_USER_ID"],
    deprecatedLegacy: true,
  },
  {
    canonical: "OPENAI_API_KEY",
    legacy: ["NEAR_OPENAI_API_KEY", "VERIORA_OPENAI_API_KEY"],
    deprecatedLegacy: true,
  },
  {
    canonical: "DATABASE_URL",
    legacy: ["VERIORA_DATABASE_URL", "NEAR_DATABASE_URL"],
    deprecatedLegacy: true,
  },
  {
    canonical: "PUBLIC_BASE_URL",
    legacy: ["VERIORA_PUBLIC_BASE_URL", "NEAR_PUBLIC_BASE_URL"],
    deprecatedLegacy: true,
  },
  {
    canonical: "CRON_SECRET",
    legacy: ["VERIORA_CRON_SECRET", "NEAR_CRON_SECRET"],
    deprecatedLegacy: true,
  },
  {
    canonical: "GITHUB_TOKEN",
    legacy: ["VERIORA_GITHUB_TOKEN"],
    deprecatedLegacy: true,
  },
  {
    canonical: "NEAR_LRAM_BASE_URL",
    legacy: ["LRAM_BASE_URL", "LRAM_PUBLIC_BASE_URL"],
    deprecatedLegacy: true,
  },
  {
    canonical: "VERIORA_HANDOFF_SECRET",
    legacy: ["NEAR_HANDOFF_SECRET", "LRAM_HANDOFF_SECRET"],
    deprecatedLegacy: true,
  },
  {
    canonical: "VERIORA_RITS_BASE_URL",
    legacy: ["RITS_BASE_URL", "RITS_URL", "NEAR_RITS_BASE_URL"],
    deprecatedLegacy: true,
  },
  {
    canonical: "VERIORA_RITS_ADMIN_API_KEY",
    legacy: ["RITS_ADMIN_API_KEY", "NEAR_RITS_ADMIN_API_KEY"],
    deprecatedLegacy: true,
  },
];
