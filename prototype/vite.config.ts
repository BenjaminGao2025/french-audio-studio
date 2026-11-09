import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In Figma Make the preview is served from FIGMA_PUBLIC_URL; allow only that host.
const figmaHost = (() => {
  try {
    return process.env.FIGMA_PUBLIC_URL ? new URL(process.env.FIGMA_PUBLIC_URL).hostname : undefined;
  } catch {
    return undefined;
  }
})();

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 5180,
    strictPort: Boolean(process.env.PORT),
    allowedHosts: figmaHost ? [figmaHost] : undefined,
  },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
