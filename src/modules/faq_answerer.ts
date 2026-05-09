import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { getLogger } from "../lib/logger.js";
import { loadPrompt } from "../lib/promptLoader.js";
import { loadLastQueriedSpreadsheet } from "../db/user_sheet_defaults_repo.js";
import { SHEET_READ_SUCCESS_HEADER_REGEX } from "../lib/sheetReplyMarker.js";
import type { ModuleContext, ModuleResult } from "./types.js";

const SHEET_URL_REQUEST_RE =
  /URLリンク|url\s*リンク|スプレッド.{0,8}URL|URL.{0,8}スプレッド|シート.{0,8}URL|URL.{0,8}シート|リンク.{0,8}出|リンク.{0,8}教|リンク.{0,8}貼/iu;

/** ペルソナは prompts/near.persona.md（system）、禁止・シートルールは prompts/near.faq_constraints.md（system）で分割している。【動作確認】temperature は意図ブレ抑制のため 0.65。 */
let personaCache: string | null = null;
let faqConstraintsCache: string | null = null;

async function getFaqPersonaPrompt(): Promise<string> {
  if (!personaCache) personaCache = await loadPrompt("prompts/near.persona.md");
  return personaCache;
}

async function getFaqConstraintsPrompt(): Promise<string> {
  if (!faqConstraintsCache) faqConstraintsCache = await loadPrompt("prompts/near.faq_constraints.md");
  return faqConstraintsCache;
}

/** 前回のシート回答URLを要求しているかを判定 */
function isAskingForSheetUrl(ctx: ModuleContext): boolean {
  if (!SHEET_URL_REQUEST_RE.test(ctx.originalText)) return false;
  const asst = ctx.recentAssistantMessages ?? [];
  return asst.some((m) => SHEET_READ_SUCCESS_HEADER_REGEX.test(m));
}

function buildFaqUserContent(ctx: ModuleContext): string {
  const prev = ctx.recentUserMessages?.filter((s) => s.trim().length > 0) ?? [];
  const asst = ctx.recentAssistantMessages?.filter((s) => s.trim().length > 0) ?? [];

  if (prev.length === 0 && asst.length === 0) return ctx.originalText;

  const lines: string[] = [];
  if (prev.length > 0) {
    lines.push("【このトークで先にユーザーが送った内容（古い順・参考）】", ...prev.map((m, i) => `${i + 1}. ${m}`), "");
  }
  if (asst.length > 0) {
    lines.push(
      "【このトークで NEAR（あなた）が既に返した内容（古い順・参考）】",
      "※ 直近の返答に数値・箇条書き・集計があるとき、続きの一言は多くの場合「その内容の見せ方を変えて」と依頼されている。",
      ...asst.map((m, i) => `${i + 1}. ${m}`),
      ""
    );
  }
  lines.push("【今回のユーザー発言】", ctx.originalText);
  return lines.join("\n");
}

export async function faqAnswerer(ctx: ModuleContext): Promise<ModuleResult> {
  const env = getEnv();
  const log = getLogger();

  // 直前のシート回答の URL を求めているケースを先に処理
  if (isAskingForSheetUrl(ctx)) {
    try {
      const sheetId = await loadLastQueriedSpreadsheet(ctx.db, ctx.channelUserId);
      if (sheetId) {
        const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
        return {
          success: true,
          draft: `さっき参照したスプレッドシートのリンクです：\n${url}`,
          situation: "success",
        };
      }
    } catch (e) {
      log.warn({ err: e }, "loadLastQueriedSpreadsheet failed in faqAnswerer");
    }
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const hasAssistantContext = (ctx.recentAssistantMessages?.filter((s) => s.trim()).length ?? 0) > 0;
  const maxTokens = hasAssistantContext ? 900 : 520;

  try {
    const [personaSystem, constraintsSystem] = await Promise.all([
      getFaqPersonaPrompt(),
      getFaqConstraintsPrompt(),
    ]);

    const completion = await client.chat.completions.create({
      model: env.OPENAI_INTENT_MODEL,
      messages: [
        { role: "system", content: personaSystem },
        { role: "system", content: constraintsSystem },
        { role: "user", content: buildFaqUserContent(ctx) },
      ],
      max_tokens: maxTokens,
      // 【動作確認】以前は 0.78。intent／文体ブレ抑制のため 0.65 に変更。
      temperature: 0.65,
      frequency_penalty: 0.45,
      presence_penalty: 0.25,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (text) {
      return { success: true, draft: text, situation: "success" };
    }
  } catch (e) {
    log.warn({ err: e }, "faqAnswerer failed");
  }
  return {
    success: false,
    draft:
      "いまのところうまく言語化できませんでした。もう一度短く送ってもらえると助かります。",
    situation: "error",
  };
}
