/**
 * 顧客マスター — profiles / memory_notes / agent_contexts のドメイン窓口。
 */
import type { Db } from "../../db/client.js";
import {
  listCustomerProfiles,
  getCustomerProfileById,
  upsertCustomerProfile,
  patchCustomerProfile,
} from "../supabase/repositories/customerProfiles.js";
import {
  listCustomerMemoryNotes,
  createCustomerMemoryNote,
  getCustomerMemoryNoteById,
  patchCustomerMemoryNote,
  deleteCustomerMemoryNote,
} from "../supabase/repositories/customerMemoryNotes.js";
import {
  getCustomerAgentContext,
  upsertCustomerAgentContext,
  listAgentContextsForCustomer,
} from "../supabase/repositories/customerAgentContexts.js";

export {
  listCustomerProfiles,
  getCustomerProfileById,
  upsertCustomerProfile,
  patchCustomerProfile,
  listCustomerMemoryNotes,
  createCustomerMemoryNote,
  getCustomerMemoryNoteById,
  patchCustomerMemoryNote,
  deleteCustomerMemoryNote,
  getCustomerAgentContext,
  upsertCustomerAgentContext,
  listAgentContextsForCustomer,
};
