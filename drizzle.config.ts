import { defineConfig } from "drizzle-kit";

// DATABASE_URL is read from the environment. drizzle-kit generate does not need
// a live DB; migrate does. Keep the two concerns separate.
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mac_hackathon:mac_hackathon@localhost:5432/mac_hackathon",
  },
});
