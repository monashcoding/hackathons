import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../env.ts";

// Standalone migration runner. Invoked on container start (see docker entry)
// before the server boots, and available as `npm run db:migrate` locally.
//
// Uses its own single-connection client with max: 1 — migrations must run
// serially — and closes it when done so the process exits cleanly.
async function main() {
  const client = postgres(env.databaseUrl, { max: 1 });
  const db = drizzle(client);

  console.log("[migrate] applying migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] done.");

  await client.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
