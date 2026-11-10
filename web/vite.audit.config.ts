import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/app/",
  plugins: [
    react(),
    {
      name: "audit-preview-entry",
      transformIndexHtml(html) {
        return html.replace("/src/main.tsx", "/src/preview-main.tsx");
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 8023,
    strictPort: true,
  },
});
