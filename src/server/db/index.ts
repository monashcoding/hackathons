import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

// A single long-lived connection pool for the process. postgres.js manages the
// pool internally; the default of 10 connections is fine for this workload.
const client = postgres(env.databaseUrl);

export const db = drizzle(client, { schema });
export { schema };
