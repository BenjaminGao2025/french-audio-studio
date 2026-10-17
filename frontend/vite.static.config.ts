// Static SPA build: no Nitro server, prerendered shell at dist/client/index.html.
// Used by `npm run build:static`; the output is deployable as plain files under /app.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: false,
  tanstackStart: {
    server: { entry: "server" },
    spa: { enabled: true, prerender: { outputPath: "/index.html" } },
  },
});
