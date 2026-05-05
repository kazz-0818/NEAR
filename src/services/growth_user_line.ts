import type { Db } from "../db/client.js";
import { appendGrowthStallMemo } from "./growth_stall_memo.js";
import {
  handleUserBatchHearingReply,
  handleUserConsentAffirmative,
  handleUserConsentNegative,
  handleUserHearingCancel,
  resolveSuggestionIdForRequestingUser,
} from "./growth_orchestrator.js";

function norm(s: string): string {
  return s.normalize("NFKC").trim();
}

function parseExplicitSuggestionId(text: string): number | null {
  const m = text.match(/#?\s*(\d{1,12})\s*$/);
  if (m?.[1]) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  const lead = text.match(/^\s*#(\d{1,12})\b/);
  if (lead?.[1]) return Number(lead[1]);
  return null;
}

function isAffirmative(text: string): boolean {
  const t = norm(text).toLowerCase();
  return /^(はい|イエス|yes|ok|okay|お願いします|進めて|お願い|👍)([、。！？!.…〜～\s]*)$/i.test(t);
}

function isNegative(text: string): boolean {
  const t = norm(text).toLowerCase();
  return /^(いいえ|イイエ|no|だめ|ダメ|見送り|やめ|キャンセル|結構です|けっこうです)([、。！？!.…〜～\s]*)$/i.test(
    t
  );
}

/** 同意確認を後回しにしている可能性 */
function looksLikeConsentDeferred(text: string): boolean {
  const t = norm(text).toLowerCase();
  return /後で|あとで|今は|まだ|考え|わからない|未定|保留|今度|明日|忙しい|時間|スルー|無視|返事|あとで返|ちょっと待|様子/i.test(
    t
  );
}

/** ヒアリング回答を先延ばし／未準備っぽい */
function looksLikeHearingDeferred(text: string): boolean {
  const t = norm(text).toLowerCase();
  return /後で|あとで|今は|まだ|考え中|考えます|わからない|未定|保留|スルー|無視|今度|明日|時間が|忙しい|あとで返|返事|準備|できない|できません|様子|見る/i.test(
    t
  );
}

function isTriviallyShortForHearing(text: string): boolean {
  const t = norm(text);
  if (t.length === 0) return true;
  const n = [...t].length;
  if (n >= 2) return false;
  return !/^[はいいえなしOKok👍]+$/i.test(t);
}

/**
 * 同意待ち/ヒアリング待ちの最中でも、明らかに別件の新規依頼は通常ルートへ通す。
 * （成長フローが会話全体を占有してしまうのを防ぐ）
 */
function looksLikeIndependentNewRequest(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (isAffirmative(t) || isNegative(t)) return false;
  if (looksLikeConsentDeferred(t) || looksLikeHearingDeferred(t)) return false;

  const chars = [...t].length;
  const hasQuestionCue = /[?？]|教えて|どう|なぜ|何|いつ|どこ|できますか|して|作って|確認|調べて|お願い|頼む/.test(t);
  const hasConversationCue = /です|ます|ください|かな|たい|について|を/.test(t);

  return chars >= 12 && (hasQuestionCue || hasConversationCue);
}

/**
 * 依頼ユーザー（管理者以外）の LINE を成長フローが処理すべきか判定する。
 */
export async function tryHandleGrowthRequestingUserLine(input: {
  db: Db;
  channelUserId: string;
  text: string;
}): Promise<{ handled: boolean; reply: string }> {
  const raw = input.text;
  const text = norm(raw);
  if (!text) return { handled: false, reply: "" };

  const explicitId = parseExplicitSuggestionId(text);
  const suggestionId = await resolveSuggestionIdForRequestingUser(
    input.db,
    input.channelUserId,
    explicitId
  );
  if (suggestionId == null) {
    return { handled: false, reply: "" };
  }

  const row = await input.db.query<{
    implementation_state: string;
    approval_status: string;
  }>(`SELECT implementation_state, approval_status FROM implementation_suggestions WHERE id = $1`, [suggestionId]);

  if (row.rows.length === 0) return { handled: false, reply: "" };
  const { implementation_state: st, approval_status: ap } = row.rows[0]!;

  if (st === "awaiting_user_consent" && ap === "pending") {
    if (isNegative(text)) {
      const reply = await handleUserConsentNegative(input.db, suggestionId);
      return { handled: true, reply };
    }
    if (isAffirmative(text)) {
      const reply = await handleUserConsentAffirmative(input.db, suggestionId);
      return { handled: true, reply };
    }
    if (looksLikeIndependentNewRequest(text)) {
      return { handled: false, reply: "" };
    }
    const kind = looksLikeConsentDeferred(text) ? "consent_deferred" : "consent_unclear";
    await appendGrowthStallMemo(input.db, suggestionId, kind, raw);
    return {
      handled: true,
      reply:
        "いま、**成長候補として進めてよいか**の確認待ちです。この件はここで**ステイ**のままにしておきますね。\n" +
        "進めてよければ **「はい」**、見送るなら **「いいえ」** とだけ送ってください。\n" +
        "別の用件は、そのあとでも大丈夫です。",
    };
  }

  if (st === "hearing_required") {
    if (norm(text) === "ヒアリングキャンセル") {
      const reply = await handleUserHearingCancel(input.db, suggestionId);
      return { handled: true, reply };
    }
    if (looksLikeIndependentNewRequest(text)) {
      return { handled: false, reply: "" };
    }
    if (looksLikeHearingDeferred(text) || isTriviallyShortForHearing(text)) {
      const kind = isTriviallyShortForHearing(text) && !looksLikeHearingDeferred(text)
        ? "hearing_too_short"
        : "hearing_deferred";
      await appendGrowthStallMemo(input.db, suggestionId, kind, raw);
      return {
        handled: true,
        reply:
          "ヒアリングへのご回答は、**この段階で待機**しています（まだ先には進めません）。\n" +
          "まとまったら、前にお送りした質問に**1通で**答えてください。「ヒアリングキャンセル」で中断もできます。",
      };
    }
    const reply = await handleUserBatchHearingReply(input.db, suggestionId, raw);
    return { handled: true, reply };
  }

  return { handled: false, reply: "" };
}
