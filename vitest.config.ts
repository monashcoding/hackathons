import { defineConfig } from "vitest/config";

// Integration tests run against a DEDICATED test database (never the dev DB).
// Override with TEST_DATABASE_URL; the default targets the compose Postgres on
// host port 5433 (see docker-compose.yml) with a separate `_test` database.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://mac_hackathon:mac_hackathon@localhost:5433/mac_hackathon_test";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    // Integration tests share one database; run files serially so they don't
    // race on shared tables. Each test still scopes its data to its own event.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 60_000,
    testTimeout: 60_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: "test",
      // Deterministic organiser gating + safety threshold for tests.
      ORGANISER_ROLES: "committee,exec,admin",
      TICKET_SYNC_REVOKE_THRESHOLD: "0.20",
    },
  },
});
