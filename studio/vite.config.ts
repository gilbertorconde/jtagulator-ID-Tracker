import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // The web version on GitHub Pages lives under /<repo>/app/; the desktop app uses "/".
  base: process.env.STUDIO_BASE ?? "/",
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    // Firmware images stay separate files (never data: URLs), loaded with fetch().
    assetsInlineLimit: (file) => (file.endsWith(".binary") ? false : undefined),
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
