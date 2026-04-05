import type { ParsedIntent } from "../models/intent.js";

const base = (intent: ParsedIntent["intent"]): ParsedIntent => ({
  intent,
  confidence: 1,
  can_handle: true,
  required_params: {},
  needs_followup: false,
  followup_question: null,
  reason: null,
  suggested_category: null,
});

/** 互換文字・絵文字を弱めてから比較（LINE で絵文字が付くことが多い） */
function normalizeForIntent(text: string): string {
  let s = text.normalize("NFKC").trim();
  // 絵文字・絵記号（簡易。残りは句読点トリムで吸収）
  s = s.replace(/\p{Extended_Pictographic}/gu, "");
  return s.trim();
}

/** 末尾の句読点・空白を除いたコア文 */
function corePhrase(text: string): string {
  return text
    .trim()
    .replace(/[\u3000\s]+/g, "")
    .replace(/[、。！？!?.…〜～]+$/g, "")
    .trim();
}

/**
 * LLM が保守的に can_handle:false にしがちなので、明らかなパターンは先に確定する。
 */
function matchesGreetingCore(core: string): boolean {
  const greetings = [
    "こんにちは",
    "こんばんは",
    "おはよう",
    "おはようございます",
    "おやすみ",
    "おやすみなさい",
    "おつかれ",
    "おつかれさま",
    "お疲れ",
    "お疲れ様",
    "お疲れさま",
    "はじめまして",
    "初めまして",
    "よろしく",
    "よろしくお願いします",
    "お願いします",
    "お願い",
    "失礼します",
    "失礼いたします",
    "久しぶり",
    "ひさしぶり",
    "元気",
    "げんき",
    "hello",
    "hi",
    "hey",
  ];
  if (greetings.includes(core)) return true;
  // 「こんにちは😊」「こんにちはー」など：語頭一致＋末尾は句読点・長音・空白程度のみ
  for (const g of greetings) {
    if (!core.startsWith(g)) continue;
    const tail = core.slice(g.length);
    if (tail.length === 0) return true;
    if (/^[、。！？!?.…〜～ーｰ\-]+$/u.test(tail)) return true;
    if (tail.length <= 8 && /^[\u3000\s、。！？!?.…〜～ーｰ\-]+$/u.test(tail)) return true;
  }
  return false;
}

function matchesHelpCore(core: string): boolean {
  const helps = [
    "何ができる",
    "できること",
    "ヘルプ",
    "help",
    "使い方",
    "なにができる",
    "機能",
  ];
  if (helps.includes(core)) return true;
  for (const h of helps) {
    if (core.startsWith(h) && core.length <= h.length + 12) return true;
  }
  return false;
}

/** Google スプレッドシートの共有 URL が含まれる → Sheets 参照モジュールへ（FAQ の「リンクは開けない」に落とさない） */
function matchGoogleSheetsUrlHeuristic(userText: string): ParsedIntent | null {
  const m = userText.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m?.[1]) return null;
  return {
    intent: "google_sheets_query",
    confidence: 1,
    can_handle: true,
    required_params: { spreadsheet_id: m[1] },
    needs_followup: false,
    followup_question: null,
    reason: "heuristic_sheets_url",
    suggested_category: null,
  };
}

/** 外部ツール連携・NEAR に専用実装を期待する依頼は unknown のまま（成長パイプライン用） */
const INTEGRATION_OR_AUTOMATION = /スプレッドシート(に|へ)(書|記|追|保存|貼|出力)|シートに反映|セルに入れ|([Gg]oogle|Outlook)\s*カレンダー(に|へ)(予定|イベント|登録)|Notion(に)?(ページ|データベース)(を)?(作|保存|追記)|Slack(に)?(投稿|通知|送って)|Webhook|API\s*キー.*(で|を使って).*(連携|取得|書き込)|OAuth.*(連携|認証して).*(実行|取得)/i;

/**
 * 「定型機能っぽい依頼」だけ broad rescue を止める。
 * 単語「予定」「会議」「メモ」単体などは含めない（雑談が未対応に落ちるのを防ぐ）。
 */
const STRUCTURED_FEATURE_HINT =
  /\b(TODO|ToDo)\b|タスク(を|に|の)?(作|追加|登録|記録|お願い|ください|頼)|メモ(に|を)(残|保存|書|取|記録)|メモして|スプレッドシート(に|へ)(書|記|追|保存|貼|出力)|カレンダー(に|へ)|会議のメモ|会議を記録|Notion|Slack(に)?(投稿|通知|送って)|Webhook|決済|請求書|パスワード管理|リマインド/i;

export function matchIntentHeuristic(userText: string): ParsedIntent | null {
  const sheets = matchGoogleSheetsUrlHeuristic(userText);
  if (sheets) return sheets;

  const normalized = normalizeForIntent(userText);
  const core = corePhrase(normalized);
  if (core.length === 0 || core.length > 56) return null;

  if (matchesGreetingCore(core)) {
    return base("greeting");
  }

  if (matchesHelpCore(core)) {
    return base("help_capabilities");
  }

  return null;
}

/**
 * LLM が unknown / can_handle:false にしたあとでも、明らかに雑談なら simple_question に寄せる。
 */
export function rescueCasualShortMessage(userText: string): ParsedIntent | null {
  if (STRUCTURED_FEATURE_HINT.test(userText)) return null;

  const normalized = normalizeForIntent(userText);
  const core = corePhrase(normalized);
  if (core.length === 0 || core.length > 40) return null;

  const thanksLike = [
    "ありがとう",
    "ありがとうございます",
    "ありがとうございました",
    "どうも",
    "サンキュー",
    "thankyou",
    "thanks",
  ];
  for (const t of thanksLike) {
    if (core === t || core.startsWith(t)) {
      const tail = core.slice(t.length);
      if (
        tail.length === 0 ||
        /^[、。！？!?.…〜～ーｰ\s\u3000]+$/u.test(tail) ||
        (tail.length <= 10 && /^[、。！？!?.…〜～ーｰございますました\u3000\s]+$/u.test(tail))
      ) {
        return base("simple_question");
      }
    }
  }

  const ack = ["はい", "いいえ", "うん", "ううん", "ええ", "ない", "OK", "Ok", "ok", "了解", "りょうかい", "わかった", "分かった"];
  if (ack.includes(core)) {
    return base("simple_question");
  }

  // ひらがな・カタカナ・句読点のみの短文（例: よろしくね、どうぞ）→ 雑談
  if (
    core.length <= 28 &&
    /^[\u3040-\u309F\u30A0-\u30FF\u30FC、。！？!?.…〜～ーｰ\s\u3000\-]+$/u.test(core)
  ) {
    return base("simple_question");
  }

  return null;
}

const SUMMARIZE_LIKE = /要約して|要約を|まとめて|箇条書きにして/i;
const REMINDER_ACTION = /リマインド(して|を|に登録|お願い)|通知してくれ|思い出させて/i;

const RESCUE_MAX_CODEPOINTS = 8000;

/**
 * unknown / can_handle:false のあと、**除外に当たらないものはすべて** simple_question へ（GPT が対話で扱える範囲を広く逃がす）。
 */
export function rescueBroadSimpleQuestion(userText: string): ParsedIntent | null {
  if (STRUCTURED_FEATURE_HINT.test(userText)) return null;
  if (SUMMARIZE_LIKE.test(userText)) return null;
  if (REMINDER_ACTION.test(userText)) return null;
  if (INTEGRATION_OR_AUTOMATION.test(userText)) return null;

  const t = userText.normalize("NFKC").trim();
  if (t.length === 0) return null;
  if ([...t].length > RESCUE_MAX_CODEPOINTS) return null;

  return {
    intent: "simple_question",
    confidence: 0.88,
    can_handle: true,
    required_params: {},
    needs_followup: false,
    followup_question: null,
    reason: "heuristic_open_simple_question",
    suggested_category: null,
  };
}
