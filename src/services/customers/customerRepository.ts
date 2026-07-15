/**
 * 顧客マスター — 顧客本体（`veriora.customers`）のドメイン窓口。
 * 実装は `src/services/supabase/repositories/customers.ts` を正とする。
 */
import type { Db } from "../../db/client.js";
import type { CustomerRow } from "./types.js";
import {
  createCustomer,
  getCustomerById,
  updateCustomerContactFields,
  updateCustomerDisplayFields,
  listCustomers,
  type CreateCustomerInput,
} from "../supabase/repositories/customers.js";
import { getCustomerProfileBundle } from "./identityRepository.js";

export type { CreateCustomerInput };

export { createCustomer, getCustomerById, updateCustomerContactFields, updateCustomerDisplayFields, listCustomers };

/** 顧客 + profiles / notes の要約バンドル */
export async function getCustomerProfile(db: Db, customerId: string) {
  return getCustomerProfileBundle(db, customerId);
}

export async function getCustomerProfileRow(db: Db, customerId: string): Promise<CustomerRow | null> {
  return getCustomerById(db, customerId);
}
