import pg from "pg";
import { getEnv } from "../config/env.js";
import { pgPoolConfig } from "./poolConfig.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const env = getEnv();
  pool = new Pool(pgPoolConfig(env.DATABASE_URL));
  return pool;
}

export type Db = pg.Pool;
