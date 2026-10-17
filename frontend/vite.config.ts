import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const backend = "http://127.0.0.1:8000";

// The output goes to ../static/app (served by FastAPI under /app). Never point outDir at
// ../static itself: emptyOutDir would delete every legacy page.
export default defineConfig({
  base: "/app/",
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  build: { outDir: "../static/app", emptyOutDir: true, assetsDir: "assets" },
  server: {
    proxy: Object.fromEntries(["/api", "/tts", "/files", "/episodes"].map((p) => [p, backend])),
  },
});
