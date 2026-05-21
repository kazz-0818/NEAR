import type { Db } from "./client.js";
import type { UserMemoryFact, UserMemoryRow } from "../models/userMemory.js";

function parseFacts(raw: unknown): UserMemoryFact[] {
  if (!Array.isArray(raw)) return [];
  const out: UserMemoryFact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const fact = typeof o.fact === "string" ? o.fact.trim() : "";
    if (!fact) continue;
    out.push({
      fact: fact.slice(0, 400),
      category:
        o.category === "preference" ||
        o.category === "role" ||
        o.category === "workflow" ||
        o.category === "constraint" ||
        o.category === "relationship" ||
        o.category === "other"
          ? o.category
          : "other",
      confidence:
        typeof o.confidence === "number" && o.confidence >= 0 && o.confidence <= 1 ? o.confidence : 0.7,
      learned_at: typeof o.learned_at === "string" ? o.learned_at : undefined,
    });
  }
  return out;
}

export async function getUserMemory(db: Db, lineUserId: string): Promise<UserMemoryRow | null> {
  const r = await db.query<{
    line_user_id: string;
    memory_summary: string;
    memory_facts: unknown;
    call_preference: string | null;
    last_consolidated_inbound_id: string | null;
    consolidation_count: number;
    updated_at: Date;
  }>(
    `SELECT line_user_id, memory_summary, memory_facts, call_preference,
            last_consolidated_inbound_id, consolidation_count, updated_at
     FROM near.near_user_memory WHERE line_user_id = $1`,
    [lineUserId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    line_user_id: row.line_user_id,
    memory_summary: row.memory_summary ?? "",
    memory_facts: parseFacts(row.memory_facts),
    call_preference: row.call_preference,
    last_consolidated_inbound_id:
      row.last_consolidated_inbound_id != null ? Number(row.last_consolidated_inbound_id) : null,
    consolidation_count: row.consolidation_count,
    updated_at: row.updated_at.toISOString(),
  };
}

export async function upsertUserMemory(
  db: Db,
  input: {
    lineUserId: string;
    memorySummary: string;
    memoryFacts: UserMemoryFact[];
    callPreference: string | null;
    lastConsolidatedInboundId: number;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO near.near_user_memory (
       line_user_id, memory_summary, memory_facts, call_preference,
       last_consolidated_inbound_id, consolidation_count, updated_at
     ) VALUES ($1, $2, $3::jsonb, $4, $5, 1, now())
     ON CONFLICT (line_user_id) DO UPDATE SET
       memory_summary = EXCLUDED.memory_summary,
       memory_facts = EXCLUDED.memory_facts,
       call_preference = COALESCE(EXCLUDED.call_preference, near.near_user_memory.call_preference),
       last_consolidated_inbound_id = EXCLUDED.last_consolidated_inbound_id,
       consolidation_count = near.near_user_memory.consolidation_count + 1,
       updated_at = now()`,
    [
      input.lineUserId,
      input.memorySummary.slice(0, 4000),
      JSON.stringify(input.memoryFacts.slice(0, 32)),
      input.callPreference?.trim() || null,
      input.lastConsolidatedInboundId,
    ]
  );
}
