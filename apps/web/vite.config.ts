import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `HEARTH_API_PROXY_PORT` lets Playwright e2e point the SPA's `/api`
// proxy at a sibling Worker on a different port — keeping dev (5173 →
// 8787) and e2e (5174 → 8788) independent so they can run on the
// same machine without colliding. `HEARTH_SPA_PORT` lets e2e move
// Vite itself off 5173 for the same reason.
const apiProxyPort = Number(process.env["HEARTH_API_PROXY_PORT"] ?? 8787);
const spaPort = Number(process.env["HEARTH_SPA_PORT"] ?? 5173);

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: spaPort,
    proxy: {
      "/api": { target: `http://localhost:${apiProxyPort}`, changeOrigin: true },
    },
  },
});
