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
  /**
   * 成長フローの**管理者向け**通知・承認のやりとりを行う LINE グループID または トークルームID（任意）。
   * 例: 「ニア進化カプセル」グループを作り、ボットを招待したうえで Webhook の groupId / roomId を設定。
   * 設定時は承認系プッシュがここへ届き、そのグループ内では ADMIN_LINE_USER_ID の送信者は @メンションなしで承認コマンド可。
   */
  GROWTH_APPROVAL_GROUP_ID: z
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
   * グループ／ルームで @メンションを検出するときのボット自身の userId。
   * GET https://api.line.me/v2/bot/info の userId。
   * 未設定でもグループでは本文に「NEAR」「ニア」があれば応答する（メンション検出には必須）。
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
  /** true / 1 で有効。未設定はオフ。自動コーディング runner（GitHub／エージェント未設定時はスタブ） */
  GROWTH_AUTO_CODING_ENABLED: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /** GitHub Issue 作成用（`GROWTH_GITHUB_REPO` とセット） */
  GITHUB_TOKEN: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  /** `owner/repo`。第二承認後に Issue を作るとき `GITHUB_TOKEN` とセット */
  GROWTH_GITHUB_REPO: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  /** 社内コーディングエージェントの Webhook URL（GitHub 未設定時のフォールバック） */
  GROWTH_CODING_AGENT_URL: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      if (!t) return undefined;
      try {
        new URL(t);
        return t;
      } catch {
        return undefined;
      }
    }),
  /** 設定時、POST 本文に対する HMAC-SHA256 を `X-NEAR-Signature: sha256=<hex>` で付与 */
  GROWTH_CODING_AGENT_SECRET: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  /** エージェント POST のレート上限（1 分あたり、既定 10） */
  GROWTH_CODING_AGENT_RPM: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || s.trim() === "") return 10;
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 1 ? n : 10;
    }),
  /** true / 1 で有効。未設定はオフ。自動デプロイ runner（アダプタ未接続時はスタブ） */
  GROWTH_AUTO_DEPLOY_ENABLED: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /**
   * false / 0 で無効。未設定は有効。無効時は従来どおり未対応のたびに suggestion をスケジュール。
   */
  GROWTH_SUGGESTION_GATE_ENABLED: z
    .string()
    .optional()
    .transform((s) => !(s === "false" || s === "0")),
  /** out_of_scope のとき suggestion を作らない（既定 true）。false で許可。 */
  GROWTH_SKIP_OUT_OF_SCOPE: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? true : !(s === "false" || s === "0"))),
  /** needs_followup のとき suggestion を保留（既定 true）。false でフォロー中でも提案。 */
  GROWTH_SKIP_WHEN_FOLLOWUP: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? true : !(s === "false" || s === "0"))),
  /** これ未満の文字数（Unicode コードポイント）では suggestion しない。0 で無効。既定 12。 */
  GROWTH_MIN_MESSAGE_CHARS: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || s.trim() === "") return 12;
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 ? n : 12;
    }),
  /**
   * 同一 message_fingerprint の unsupported がこの件数に達したら suggestion 可（INSERT 後の COUNT）。
   * 1 で初回から成長候補化。スパム抑制で 2 にしたい場合は環境変数で指定。
   */
  GROWTH_MIN_FINGERPRINT_COUNT: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || s.trim() === "") return 1;
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 1 ? n : 1;
    }),
  /**
   * unknown_custom_request かつ confidence がこの値未満（かつ confidence>0）のときスキップ。0 で無効。既定 0.35。
   */
  GROWTH_MIN_CONFIDENCE_UNKNOWN: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || s.trim() === "") return 0.35;
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.35;
    }),
  /** Google Sheets API 用サービスアカウント鍵（JSON 文字列。改行を含む場合は B64 推奨） */
  GOOGLE_SERVICE_ACCOUNT_JSON: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  /** 上記 JSON を base64（Render 等での設定向け） */
  GOOGLE_SERVICE_ACCOUNT_JSON_B64: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  /** 全ユーザー共通の既定スプレッドシート ID（任意） */
  GOOGLE_SHEETS_DEFAULT_SPREADSHEET_ID: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  /** 1シートあたり読み取る最大行数（既定 400、20〜2000） */
  GOOGLE_SHEETS_MAX_ROWS: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || s.trim() === "") return 400;
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 20 && n <= 2000 ? n : 400;
    }),
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
