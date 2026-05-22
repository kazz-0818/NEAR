import type { Hono } from "hono";
import { z } from "zod";
import { getPool } from "../db/client.js";
import {
  listCustomers,
  getCustomerById,
  updateCustomerContactFields,
  updateCustomerDisplayFields,
} from "../services/supabase/repositories/customers.js";
import { suggestMergeCandidatesForCustomer } from "../services/customers/mergeSuggestions.js";
import { findCustomerByIdentity, listIdentitiesForCustomer } from "../services/supabase/repositories/customerIdentities.js";
import {
  listCustomerProfiles,
  getCustomerProfileById,
  patchCustomerProfile,
} from "../services/supabase/repositories/customerProfiles.js";
import {
  listCustomerMemoryNotes,
  getCustomerMemoryNoteById,
  patchCustomerMemoryNote,
  deleteCustomerMemoryNote,
} from "../services/supabase/repositories/customerMemoryNotes.js";
import { listAgentContextsForCustomer } from "../services/supabase/repositories/customerAgentContexts.js";
import {
  listMergeCandidates,
  markMergeCandidateStatus,
} from "../services/supabase/repositories/customerMergeCandidates.js";
import { mergeCustomersManual } from "../services/customers/mergeCandidates.js";
import {
  buildCustomerAuditSummary,
  listCustomerConversations,
  listCustomerMessages,
} from "../services/customers/adminAuditSummary.js";

const mergeBody = z.object({
  survivor_customer_id: z.string().uuid(),
  merged_customer_id: z.string().uuid(),
  candidate_id: z.string().uuid().optional(),
});

const patchNoteBody = z
  .object({
    note: z.string().min(1).optional(),
    category: z.string().nullable().optional(),
    confirmed: z.boolean().optional(),
    importance: z.enum(["low", "medium", "high", "critical"]).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "empty patch" });

const patchProfileBody = z
  .object({
    profile_value: z.string().optional(),
    confirmed: z.boolean().optional(),
    is_sensitive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "empty patch" });

const patchCustomerBody = z
  .object({
    email: z.string().email().nullable().optional(),
    phone: z.string().max(32).nullable().optional(),
    preferred_name: z.string().max(80).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "empty patch" });

export function registerCustomerAdminRoutes(app: Hono): void {
  app.get("/customers", async (c) => {
    const pool = getPool();
    const status = c.req.query("status")?.trim() || "active";
    const q = c.req.query("q")?.trim();
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
    const items = await listCustomers(pool, { status, q, limit, offset });
    return c.json({ items, limit, offset });
  });

  app.get("/customers/audit-summary", async (c) => {
    const pool = getPool();
    const summary = await buildCustomerAuditSummary(pool);
    return c.json(summary);
  });

  app.get("/customers/by-identity", async (c) => {
    const provider = c.req.query("provider")?.trim() || "line";
    const channelKey = c.req.query("channel_key")?.trim();
    const externalUserId = c.req.query("external_user_id")?.trim();
    if (!channelKey || !externalUserId) {
      return c.json({ error: "channel_key and external_user_id required" }, 400);
    }
    const pool = getPool();
    const hit = await findCustomerByIdentity(pool, provider, channelKey, externalUserId);
    if (!hit) return c.json({ found: false }, 404);
    const customer = await getCustomerById(pool, hit.customerId);
    return c.json({ found: true, customer, identity: hit.identity });
  });

  app.get("/customers/:id", async (c) => {
    const customerId = c.req.param("id");
    const pool = getPool();
    const customer = await getCustomerById(pool, customerId);
    if (!customer) return c.json({ error: "not found" }, 404);
    const [identities, profiles, notes, agentContexts, conversations] = await Promise.all([
      listIdentitiesForCustomer(pool, customerId),
      listCustomerProfiles(pool, customerId),
      listCustomerMemoryNotes(pool, customerId),
      listAgentContextsForCustomer(pool, customerId),
      listCustomerConversations(pool, customerId),
    ]);
    return c.json({ customer, identities, profiles, notes, agentContexts, conversations });
  });

  app.get("/customers/:id/identities", async (c) => {
    const pool = getPool();
    const items = await listIdentitiesForCustomer(pool, c.req.param("id"));
    return c.json({ items });
  });

  app.get("/customers/:id/memories", async (c) => {
    const pool = getPool();
    const items = await listCustomerMemoryNotes(pool, c.req.param("id"));
    return c.json({ items });
  });

  app.get("/customers/:id/profiles", async (c) => {
    const pool = getPool();
    const items = await listCustomerProfiles(pool, c.req.param("id"));
    return c.json({ items });
  });

  app.get("/customers/:id/conversations", async (c) => {
    const pool = getPool();
    const limit = Math.min(Number(c.req.query("limit") ?? 30), 100);
    const conversations = await listCustomerConversations(pool, c.req.param("id"), limit);
    const messages = await listCustomerMessages(pool, c.req.param("id"), 50);
    return c.json({ conversations, messages });
  });

  app.get("/customer-merge-candidates", async (c) => {
    const status = c.req.query("status")?.trim() || "pending";
    const pool = getPool();
    const items = await listMergeCandidates(pool, status);
    return c.json({ items });
  });

  app.post("/customer-merge", async (c) => {
    const body = mergeBody.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const pool = getPool();
    await mergeCustomersManual(pool, {
      survivorCustomerId: body.data.survivor_customer_id,
      mergedCustomerId: body.data.merged_customer_id,
      candidateId: body.data.candidate_id,
      linkedBy: "admin_api",
    });
    return c.json({ ok: true });
  });

  app.post("/customer-merge-candidates/:id/approve", async (c) => {
    const pool = getPool();
    const id = c.req.param("id");
    const body = z
      .object({ survivor_customer_id: z.string().uuid() })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const rows = await listMergeCandidates(pool, "pending");
    const cand = rows.find((r) => r.id === id);
    if (!cand) return c.json({ error: "candidate not found" }, 404);
    const survivor = body.data.survivor_customer_id;
    const merged =
      cand.customer_id_a === survivor ? cand.customer_id_b : cand.customer_id_a;
    if (survivor !== cand.customer_id_a && survivor !== cand.customer_id_b) {
      return c.json({ error: "survivor must be one of candidate customer ids" }, 400);
    }
    await mergeCustomersManual(pool, {
      survivorCustomerId: survivor,
      mergedCustomerId: merged,
      candidateId: id,
      linkedBy: "admin_ui_approve",
    });
    return c.json({ ok: true, survivor_customer_id: survivor, merged_customer_id: merged });
  });

  app.post("/customer-merge-candidates/:id/reject", async (c) => {
    const pool = getPool();
    await markMergeCandidateStatus(pool, c.req.param("id"), "rejected");
    return c.json({ ok: true });
  });

  app.patch("/customer-memory-notes/:id", async (c) => {
    const body = patchNoteBody.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const pool = getPool();
    const ok = await patchCustomerMemoryNote(pool, c.req.param("id"), {
      note: body.data.note,
      category: body.data.category,
      confirmed: body.data.confirmed,
      importance: body.data.importance,
    });
    if (!ok) return c.json({ error: "not found or no changes" }, 404);
    const row = await getCustomerMemoryNoteById(pool, c.req.param("id"));
    return c.json({ ok: true, note: row });
  });

  app.delete("/customer-memory-notes/:id", async (c) => {
    const pool = getPool();
    const ok = await deleteCustomerMemoryNote(pool, c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });

  app.patch("/customers/:id", async (c) => {
    const body = patchCustomerBody.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const pool = getPool();
    const customerId = c.req.param("id");
    const customer = await getCustomerById(pool, customerId);
    if (!customer) return c.json({ error: "not found" }, 404);
    if (body.data.email !== undefined || body.data.phone !== undefined) {
      await updateCustomerContactFields(pool, customerId, {
        email: body.data.email,
        phone: body.data.phone,
      });
      await suggestMergeCandidatesForCustomer(pool, customerId);
    }
    if (body.data.preferred_name !== undefined) {
      await updateCustomerDisplayFields(pool, customerId, {
        preferredName: body.data.preferred_name,
      });
    }
    const updated = await getCustomerById(pool, customerId);
    return c.json({ ok: true, customer: updated });
  });

  app.patch("/customer-profiles/:id", async (c) => {
    const body = patchProfileBody.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const pool = getPool();
    const ok = await patchCustomerProfile(pool, c.req.param("id"), {
      profileValue: body.data.profile_value,
      confirmed: body.data.confirmed,
      isSensitive: body.data.is_sensitive,
    });
    if (!ok) return c.json({ error: "not found or no changes" }, 404);
    const row = await getCustomerProfileById(pool, c.req.param("id"));
    return c.json({ ok: true, profile: row });
  });
}
