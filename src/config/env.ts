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
  /** true / 1 で、成長 gate 通過時にユーザー返信へ「改善候補として記録」旨を一文追加。既定オフ。 */
  NEAR_GROWTH_USER_ACK_ENABLED: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /**
   * false / 0 でオフ。未設定はオン。
   * エージェント経路のエラー系・ツール未使用などを growth_candidate_signals に残す（unsupported 以外の観測用）。
   */
  NEAR_GROWTH_CANDIDATE_SIGNALS_ENABLED: z
    .string()
    .optional()
    .transform((s) => (s === undefined || s.trim() === "" ? true : !(s === "false" || s === "0"))),
  /**
   * false / 0 でオフ。未設定はオン。
   * 提案レコード作成後に notifyGrowthFirstApproval で管理者へ第一段階案内を送る（宛先は GROWTH_APPROVAL_GROUP_ID または ADMIN_LINE_USER_ID）。
   */
  NEAR_GROWTH_ADMIN_NOTIFY_ON_SUGGESTION: z
    .string()
    .optional()
    .transform((s) => (s === undefined || s.trim() === "" ? true : !(s === "false" || s === "0"))),
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
  /** ユーザー Google OAuth（Web クライアント）。Sheets をユーザー権限で読むときに使用 */
  GOOGLE_OAUTH_CLIENT_ID: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  GOOGLE_OAUTH_CLIENT_SECRET: z
    .string()
    .optional()
    .transform((s) => (s?.trim() ? s.trim() : undefined)),
  /** 例: https://near-xxx.onrender.com/oauth/google/callback（Google Cloud Console に完全一致登録） */
  GOOGLE_OAUTH_REDIRECT_URI: z
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
  /**
   * true / 1 で有効。秘書レイヤー（request_interpreter による直前出力編集短絡等）をオフにし、従来の intent ルートのみにする。
   * 障害時の切り分け・ロールバック用。
   */
  NEAR_SECRETARY_LAYER_DISABLED: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /** refresh_token 暗号化用（16文字以上推奨。漏洩厳禁） */
  GOOGLE_OAUTH_TOKEN_SECRET: z
    .string()
    .optional()
    .transform((s) => {
      const t = s?.trim();
      if (!t || t.length < 16) return undefined;
      return t;
    }),
  /**
   * true / 1 で有効。Responses API ベースのエージェント経路（Web 検索・カスタムツール）。
   * 既定オフ。有効時も NEAR_AGENT_SHADOW でレガシー優先範囲を切り替え。
   */
  NEAR_AGENT_ENABLED: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /**
   * 既定 true（影モード）。true のとき、従来ルートで処理できる発話はレガシーのまま。
   * false のときは「エージェント担当 intent」（simple_question / unknown 等）をエージェントが主担当。
   */
  NEAR_AGENT_SHADOW: z
    .string()
    .optional()
    .transform((s) => {
      if (s === undefined || s.trim() === "") return true;
      return !(s === "false" || s === "0");
    }),
  /** エージェント用モデル（Web 検索ツール対応のものを推奨。例: gpt-4o） */
  OPENAI_AGENT_MODEL: z.string().default("gpt-4o"),
  /** ツール呼び出しループの最大回数（1〜24） */
  NEAR_AGENT_MAX_STEPS: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || s.trim() === "") return 8;
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 1 && n <= 24 ? n : 8;
    }),
  /** false / 0 で Web 検索ツールを渡さない（コスト抑止・オフライン寄りテスト用） */
  NEAR_AGENT_WEB_SEARCH: z
    .string()
    .optional()
    .transform((s) => (s === undefined || s.trim() === "" ? true : !(s === "false" || s === "0"))),
  /**
   * true / 1 で Web 検索付与に優先順位ポリシーを適用（明示キーワード・短文・シート文脈で抑制）。
   * オフ時は従来どおり NEAR_AGENT_WEB_SEARCH のみで付与する。
   */
  NEAR_WEB_SEARCH_POLICY_ENABLED: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /** ポリシー適用時、本文がこの文字数未満なら検索ツールを付けない（1〜200、既定 24） */
  NEAR_WEB_SEARCH_MIN_CHARS: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || s.trim() === "") return 24;
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 1 && n <= 200 ? n : 24;
    }),
  /**
   * agent_search_runs への行挿入。未設定時: NEAR_WEB_SEARCH_POLICY_ENABLED と同じ（ポリシー ON ならログ ON）。
   * false / 0 で明示オフ、true / 1 で明示オン。
   */
  NEAR_AGENT_SEARCH_RUNS_LOG: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || s.trim() === "") return undefined as boolean | undefined;
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
      return undefined;
    }),
  /** true / 1 でエージェント副作用ツール（タスク・メモ・リマインド）の確認フローを有効化。既定オフ。 */
  NEAR_TOOL_CONFIRM_ENABLED: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /** 確認対象ツール名をカンマ区切り。未設定時は near_save_reminder,near_save_task,near_save_memo */
  NEAR_TOOL_CONFIRM_TOOLS: z
    .string()
    .optional()
    .transform((s) => {
      const raw = (s?.trim() || "near_save_reminder,near_save_task,near_save_memo").split(",");
      const names = raw.map((x) => x.trim()).filter(Boolean);
      return names.length ? names : ["near_save_reminder", "near_save_task", "near_save_memo"];
    }),
  /** 保留の有効期限（分）。1〜120、既定 30 */
  NEAR_TOOL_CONFIRM_TTL_MINUTES: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || s.trim() === "") return 30;
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n >= 1 && n <= 120 ? n : 30;
    }),
  /**
   * false / 0 のとき、保留中でも肯定/否定以外の発話は通常ルートへ通す（非ブロッキング）。
   * 未設定時は true（保留中は他処理に進ませない）。
   */
  NEAR_TOOL_CONFIRM_BLOCKING: z
    .string()
    .optional()
    .transform((s) => (s === undefined || s.trim() === "" ? true : !(s === "false" || s === "0"))),
  /** true / 1 でエージェント返信を composeNearReply せずそのまま送る（レイテンシ・トークン削減） */
  NEAR_AGENT_SKIP_COMPOSE: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /**
   * Phase2: true / 1 かつ NEAR_AGENT_ENABLED のとき、task / memo / reminder / summarize を
   * レガシー registry ではなくエージェント経路（ツール実行）に寄せる。
   */
  NEAR_PHASE2_SIDE_EFFECTS_VIA_AGENT: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /**
   * 返信整形モード。auto = skip/light/full をドラフトから判定。full = 事実保護スキップ以外は常にフル整形。
   */
  NEAR_COMPOSE_MODE: z
    .string()
    .optional()
    .transform((s) => (s?.trim() === "full" ? "full" : "auto")),
  /** false / 0 のとき auto モードでの「軽微整形」はスキップ（ドラフトそのまま） */
  NEAR_COMPOSE_LIGHT_ENABLED: z
    .string()
    .optional()
    .transform((s) => (s === undefined || s.trim() === "" ? true : !(s === "false" || s === "0"))),
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
