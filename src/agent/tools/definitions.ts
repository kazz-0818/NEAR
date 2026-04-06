import type { FunctionTool } from "openai/resources/responses/responses";

/** OpenAI Responses API に渡すカスタム関数ツール（名前は near_ で統一） */
export const NEAR_AGENT_FUNCTION_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "near_list_capabilities",
    strict: true,
    description:
      "NEAR がユーザーに案内できる機能の一覧を取得する。「何ができる？」「機能は？」のときに使う。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "near_get_server_time",
    strict: true,
    description:
      "サーバー上の現在時刻（UTC・ISO8601）を返す。締切・日付のずれ確認など、時刻が必要なときだけ使う。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "near_google_sheets_query",
    strict: true,
    description:
      "Google スプレッドシートを読み取り、質問に答える。ユーザーが表・売上・在庫など**スプレッドシート上のデータ**を知りたいときに使う。Google 連携またはサービスアカウント共有が必要。結果の draft はユーザー向け文案としてそのまま使える。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: {
          type: "string",
          description: "ユーザーが知りたい内容（自然文）。列名・条件・期間など。",
        },
        spreadsheet_id: {
          type: ["string", "null"],
          description:
            "スプレッドシート ID（URL の /d/ と /edit の間）。分からなければ null。",
        },
        spreadsheet_name_hint: {
          type: ["string", "null"],
          description: "Drive 上のファイル名に含まれそうな語。不明なら null。",
        },
      },
      required: ["question", "spreadsheet_id", "spreadsheet_name_hint"],
    },
  },
  {
    type: "function",
    name: "near_save_task",
    strict: true,
    description: "ユーザーが**やること・タスク**を記録してほしいとき。短いタイトルで保存する。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "タスクの要約タイトル（短く）" },
        notes: { type: ["string", "null"], description: "補足。なければ null" },
      },
      required: ["title", "notes"],
    },
  },
  {
    type: "function",
    name: "near_save_memo",
    strict: true,
    description: "ユーザーが**メモとして残してほしい**内容を保存するとき。長めのメモ可。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        body: { type: "string", description: "保存する本文" },
      },
      required: ["body"],
    },
  },
  {
    type: "function",
    name: "near_summarize",
    strict: true,
    description:
      "ユーザーが長文の**要約・整理**を依頼しているとき。本文を渡して要点にまとめる（箇条書き＋短いまとめ）。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
          description: "要約対象の全文（ユーザー発話から抜粋してよい）",
        },
      },
      required: ["text"],
    },
  },
  {
    type: "function",
    name: "near_save_reminder",
    strict: true,
    description:
      "指定した日時に LINE で通知する**リマインド**を登録するとき。日時は日本語（明日10時）または ISO8601 で渡す。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        reminder_message: { type: "string", description: "通知時に伝える内容の要約" },
        when_description: {
          type: "string",
          description:
            "いつ通知するか。例: 「4月8日10時」「明日9時」「2026-04-10T10:00:00+09:00」",
        },
      },
      required: ["reminder_message", "when_description"],
    },
  },
];
