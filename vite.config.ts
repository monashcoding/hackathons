import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The React SPA lives in `web/` and builds to `dist/web`, which Express serves
// same-origin in production. In dev, this dev server proxies /api to Express so
// there is no CORS anywhere.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
