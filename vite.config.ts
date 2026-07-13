import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The React SPA lives in `web/` and builds to `dist/web`, which Express serves
// same-origin in production. In dev, this dev server proxies /api to Express so
// there is no CORS anywhere.
//
// The proxy target follows PORT from .env, so if you move the API off 3000
// (e.g. a local mac-auth already owns 3000), set PORT in .env and both the API
// and this proxy stay in sync.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.PORT || "3000";
  return {
    root: "web",
    plugins: [react(), tailwindcss()],
    build: {
      outDir: "../dist/web",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
  };
});
