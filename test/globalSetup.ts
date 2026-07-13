import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Runs ONCE before the whole suite: ensure the dedicated test database exists
// and is fully migrated. Kept independent of the app's env module so it works
// regardless of how vitest injects env into workers.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://mac_hackathon:mac_hackathon@localhost:5433/mac_hackathon_test";

export default async function setup() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);

  // Connect to the maintenance `postgres` database to create the test DB.
  const maintUrl = new URL(TEST_DATABASE_URL);
  maintUrl.pathname = "/postgres";
  const admin = postgres(maintUrl.toString(), { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`[test] created database ${dbName}`);
  } catch (err) {
    // 42P04 = database already exists — fine.
    if ((err as { code?: string }).code !== "42P04") throw err;
  } finally {
    await admin.end();
  }

  // Apply migrations to the test database.
  const client = postgres(TEST_DATABASE_URL, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await client.end();
  console.log(`[test] migrations applied to ${dbName}`);
}
