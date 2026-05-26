import type { VelioraDb } from "../client.js";
import { VERIORA_TABLES } from "../schema.js";

export type VelioraAgentRow = {
  id: string;
  agent_key: string;
  code: string;
  kana: string;
  department: string;
  display_name: string;
  role: string;
  description: string | null;
  enabled: boolean;
};

export async function getAgentByKey(db: VelioraDb, agentKey: string): Promise<VelioraAgentRow | null> {
  const r = await db.query<VelioraAgentRow>(
    `SELECT id, agent_key, code, kana, department, display_name, role, description, enabled
     FROM ${VERIORA_TABLES.aiAgents}
     WHERE agent_key = $1 AND enabled = true
     LIMIT 1`,
    [agentKey.trim().toLowerCase()]
  );
  return r.rows[0] ?? null;
}

export async function listAgents(db: VelioraDb): Promise<VelioraAgentRow[]> {
  const r = await db.query<VelioraAgentRow>(
    `SELECT id, agent_key, code, kana, department, display_name, role, description, enabled
     FROM ${VERIORA_TABLES.aiAgents}
     WHERE enabled = true
     ORDER BY agent_key`
  );
  return r.rows;
}
