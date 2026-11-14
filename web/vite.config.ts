import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const backend = process.env.API_TARGET ?? "http://127.0.0.1:8000";

// Served by FastAPI under /app/ (routers/app_shell.py); the Docker build copies dist/ to static/app.
export default defineConfig({
  base: "/app/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(root, "./src") } },
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "assets" },
  server: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 5180,
    strictPort: Boolean(process.env.PORT),
    // `npm run dev` against a local backend: API calls go to it.
    proxy: Object.fromEntries(["/api", "/tts", "/files", "/static", "/manifest.webmanifest", "/sw.js"].map(path => [path, backend])),
  },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
