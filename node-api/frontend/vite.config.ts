import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  // During development Vite runs on port 5173.
  // API calls to /api/* are proxied to the Hono server on port 3000.
  // This avoids CORS issues — the browser sees one origin.
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://node-api:3000",
        changeOrigin: true,
      },
    },
  },

  // Production build output goes to dist/ — Hono serves this as static files.
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});