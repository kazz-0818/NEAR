import type { Db } from "../../db/client.js";
import { getCustomerById } from "../supabase/repositories/customers.js";
import { listCustomerProfiles } from "../supabase/repositories/customerProfiles.js";
import { listCustomerMemoryNotes } from "../supabase/repositories/customerMemoryNotes.js";
import {
  getCustomerAgentContext,
  listAgentContextsForCustomer,
} from "../supabase/repositories/customerAgentContexts.js";
import type { CustomerContextForAgent } from "./types.js";

export async function buildCustomerContextForAgent(
  db: Db,
  customerId: string,
  agentKey: string
): Promise<CustomerContextForAgent | null> {
  const customer = await getCustomerById(db, customerId);
  if (!customer) return null;

  const [profiles, notes, agentCtx, crossAgents] = await Promise.all([
    listCustomerProfiles(db, customerId, { limit: 40 }),
    listCustomerMemoryNotes(db, customerId, { limit: 20 }),
    getCustomerAgentContext(db, customerId, agentKey),
    listAgentContextsForCustomer(db, customerId, agentKey),
  ]);

  const confirmedProfiles = profiles.filter((p) => p.confirmed);
  const unconfirmedProfiles = profiles.filter((p) => !p.confirmed);

  const cautions: string[] = [];
  if (unconfirmedProfiles.length) {
    cautions.push("未確認の推定情報があります。断定せず自然に確認してください。");
  }

  return {
    customerId,
    displayName: customer.display_name,
    preferredName: customer.preferred_name,
    nickname: customer.nickname,
    confirmedProfiles,
    unconfirmedProfiles,
    memoryNotes: notes,
    agentContextSummary: agentCtx?.context_summary ?? null,
    crossAgentSummaries: crossAgents.map((a) => ({
      agentKey: a.agent_key,
      summary: a.context_summary ?? "",
    })),
    cautions,
  };
}

export function formatCustomerContextPrompt(ctx: CustomerContextForAgent): string {
  const parts: string[] = [];
  parts.push("【Veliora 共通顧客情報（他部署と共有・事実ベース）】");

  const name =
    ctx.preferredName?.trim() ||
    ctx.nickname?.trim() ||
    ctx.displayName?.trim();
  if (name) parts.push(`呼び名・表示: ${name}`);

  for (const p of ctx.confirmedProfiles.slice(0, 12)) {
    parts.push(`・（確認済）${p.profile_key}: ${p.profile_value ?? ""}`);
  }
  for (const n of ctx.memoryNotes.filter((m) => m.confirmed).slice(0, 10)) {
    const cat = n.category ? `[${n.category}] ` : "";
    parts.push(`・（確認済メモ）${cat}${n.note}`);
  }
  for (const n of ctx.memoryNotes.filter((m) => !m.confirmed).slice(0, 6)) {
    const cat = n.category ? `[${n.category}] ` : "";
    parts.push(`・（推定・未確認）${cat}${n.note}`);
  }
  for (const p of ctx.unconfirmedProfiles.slice(0, 6)) {
    parts.push(`・（推定）${p.profile_key}: ${p.profile_value ?? ""}`);
  }
  if (ctx.agentContextSummary?.trim()) {
    parts.push(`・この部署での文脈: ${ctx.agentContextSummary.trim().slice(0, 500)}`);
  }
  for (const cross of ctx.crossAgentSummaries.slice(0, 4)) {
    parts.push(`・${cross.agentKey} 部署での要約: ${cross.summary.slice(0, 400)}`);
  }
  if (ctx.cautions.length) parts.push(...ctx.cautions.map((c) => `※ ${c}`));
  parts.push("※ 未確認情報は断定しない。ユーザーに記憶を丸出しにしない。");

  return parts.join("\n");
}

export async function buildCustomerContextPromptForAgent(
  db: Db,
  customerId: string,
  agentKey: string
): Promise<string> {
  const ctx = await buildCustomerContextForAgent(db, customerId, agentKey);
  if (!ctx) return "";
  const has =
    ctx.confirmedProfiles.length ||
    ctx.unconfirmedProfiles.length ||
    ctx.memoryNotes.length ||
    ctx.agentContextSummary ||
    ctx.crossAgentSummaries.length ||
    ctx.preferredName ||
    ctx.displayName;
  if (!has) return "";
  return formatCustomerContextPrompt(ctx);
}
