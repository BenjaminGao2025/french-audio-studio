import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by FastAPI under /app/ (routers/app_shell.py); the Docker build copies dist/ to static/app.
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "assets" },
  server: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 5180,
    strictPort: Boolean(process.env.PORT),
    // `npm run dev` against a local backend: API calls go to it.
    proxy: { "/api": process.env.API_TARGET ?? "http://127.0.0.1:8000" },
  },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
