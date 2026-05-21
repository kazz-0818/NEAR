import type { Db } from "./client.js";

export type SchemaDiagnostics = {
  near_inbound_count: number;
  near_outbound_count: number;
  veliora_near_line_events_count: number;
  /** public に残ったレガシー実テーブル（統合漏れ・誤参照の目安） */
  public_legacy_base_tables: string[];
};

export async function getSchemaDiagnostics(db: Db): Promise<SchemaDiagnostics | null> {
  try {
    const legacyNames = [
      "inbound_messages",
      "near_inbound_messages",
      "outbound_messages",
      "near_outbound_messages",
      "user_google_oauth_accounts",
      "near_user_google_oauth_accounts",
    ];

    const [inbound, outbound, veliora, legacy] = await Promise.all([
      db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM near.near_inbound_messages`),
      db.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM near.near_outbound_messages`),
      db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM veliora.line_message_events WHERE agent_code = 'near'`
      ),
      db.query<{ relname: string }>(
        `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relname = ANY($1::text[])`,
        [legacyNames]
      ),
    ]);

    return {
      near_inbound_count: Number(inbound.rows[0]?.c ?? 0),
      near_outbound_count: Number(outbound.rows[0]?.c ?? 0),
      veliora_near_line_events_count: Number(veliora.rows[0]?.c ?? 0),
      public_legacy_base_tables: legacy.rows.map((r) => r.relname),
    };
  } catch {
    return null;
  }
}
