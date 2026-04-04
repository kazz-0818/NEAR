import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

/** Render / .env 貼り付けで末尾改行が混ざると LINE 署名が一致しない */
const trimSecret = z.string().min(1).transform((s) => s.trim());

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  LINE_CHANNEL_SECRET: trimSecret,
  LINE_CHANNEL_ACCESS_TOKEN: trimSecret,
  OPENAI_API_KEY: trimSecret,
  OPENAI_INTENT_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_SUGGESTION_MODEL: z.string().default("gpt-4o-mini"),
  ADMIN_API_KEY: trimSecret,
  CRON_SECRET: z.string().optional(),
  /** 実装提案作成時にプッシュ通知する管理者の LINE ユーザーID（任意） */
  ADMIN_LINE_USER_ID: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  /** 管理APIのベースURL表示用（末尾スラッシュなし推奨、任意） */
  PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim().replace(/\/$/, "") : undefined)),
  /** 任意: デプロイ／アップロード時刻を手動で固定（ISO8601）。未設定時は build-info.json */
  NEAR_BUILT_AT: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      if (!t) return undefined;
      const ms = Date.parse(t);
      return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
    }),
  /**
   * グループ／ルームでメンション必須にするときのボット自身の userId。
   * GET https://api.line.me/v2/bot/info の userId。未設定時はグループでも従来どおり全メッセージに返信。
   */
  LINE_BOT_USER_ID: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  /** 「何ができるようになったか」用の短文（改行可）。デプロイごとに手で更新する想定 */
  NEAR_WHATS_NEW: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(msg)}`);
  }
  cached = parsed.data;
  return cached;
}
