import type { Db } from "../../db/client.js";
import { redactSensitiveForMemory } from "../user_memory_prompt.js";
import { upsertCustomerProfile } from "../supabase/repositories/customerProfiles.js";
import { createCustomerMemoryNote } from "../supabase/repositories/customerMemoryNotes.js";
import type { UpsertProfileInput } from "./types.js";

const SENSITIVE_PATTERN =
  /健康|病気|宗教|政治|性的|犯罪|人種|民族|労働組合|住所|マンション番地|丁目|番地\d/i;

const EXPLICIT_REMEMBER = /覚えて|記憶して|忘れないで|メモしておいて|保存しておいて/i;

const PREFERRED_NAME = /(?:呼んで|呼び方|名前は)(.+?)(?:で|と|にして|ください|お願い)/i;
const TONE_PREF = /(?:短く|簡潔|丁寧|カジュアル|実務的).{0,20}(?:回答|返信|説明).{0,10}(?:好む|希望|がいい|して)/i;

export type ExtractMemoryInput = {
  customerId: string;
  agentKey: string;
  userText: string;
  assistantText?: string;
  conversationId?: string;
  messageId?: string;
};

export type ExtractedMemoryItem = {
  kind: "profile" | "note";
  profile?: UpsertProfileInput;
  note?: string;
  category?: string;
  confirmed: boolean;
};

export function extractCustomerMemoryFromMessage(input: ExtractMemoryInput): ExtractedMemoryItem[] {
  const text = redactSensitiveForMemory(input.userText.trim());
  if (text.length < 6) return [];
  if (SENSITIVE_PATTERN.test(text)) return [];
  if (/^(はい|いいえ|ok|了解|ありがとう|お疲れ)$/i.test(text)) return [];

  const explicit = EXPLICIT_REMEMBER.test(text);
  const items: ExtractedMemoryItem[] = [];

  const nameM = text.match(PREFERRED_NAME);
  if (nameM?.[1]) {
    const name = nameM[1].trim().slice(0, 40);
    if (name.length >= 1 && name.length <= 30) {
      items.push({
        kind: "profile",
        confirmed: explicit,
        profile: {
          customerId: input.customerId,
          profileType: "nickname",
          profileKey: "preferred_name",
          profileValue: name,
          confidence: explicit ? 0.95 : 0.6,
          sourceAgentKey: input.agentKey,
          sourceConversationId: input.conversationId,
          sourceMessageId: input.messageId,
          confirmed: explicit,
        },
      });
    }
  }

  if (TONE_PREF.test(text)) {
    items.push({
      kind: "note",
      confirmed: explicit,
      note: `回答スタイルの希望: ${text.slice(0, 200)}`,
      category: "連絡方針",
    });
  }

  if (
    explicit &&
    text.length >= 12 &&
    text.length <= 400 &&
    !items.length
  ) {
    items.push({
      kind: "note",
      confirmed: true,
      note: text.slice(0, 400),
      category: "注意事項",
    });
  }

  return items;
}

export async function persistExtractedMemory(
  db: Db,
  input: ExtractMemoryInput
): Promise<number> {
  const items = extractCustomerMemoryFromMessage(input);
  let saved = 0;
  for (const item of items) {
    if (item.kind === "profile" && item.profile) {
      if (SENSITIVE_PATTERN.test(item.profile.profileValue)) continue;
      await upsertCustomerProfile(db, item.profile);
      saved++;
    } else if (item.kind === "note" && item.note) {
      await createCustomerMemoryNote(db, {
        customerId: input.customerId,
        note: item.note,
        category: item.category,
        sourceAgentKey: input.agentKey,
        sourceConversationId: input.conversationId,
        sourceMessageId: input.messageId,
        confirmed: item.confirmed,
        confidence: item.confirmed ? 0.9 : 0.5,
        importance: item.confirmed ? "high" : "medium",
      });
      saved++;
    }
  }
  return saved;
}
