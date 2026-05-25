import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Mobile Translator",
        short_name: "MTrans",
        description: "Realtime mobile translator and summarizer",
        theme_color: "#1e3a8a",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        // do not cache API responses for privacy
        globIgnores: ["**/config.js"],
        runtimeCaching: [],
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: { port: 5173 },
  build: { outDir: "dist" },
});
