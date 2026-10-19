// Bundles the command-line tool into dist-cli/ (run: node dist-cli/jtagulator-cli.mjs).
import fs from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    ssr: "cli/bin.ts",
    outDir: "dist-cli",
    emptyOutDir: true,
    target: "node20",
    rollupOptions: {
      external: ["serialport"],
      output: { entryFileNames: "jtagulator-cli.mjs", inlineDynamicImports: true },
    },
  },
  plugins: [
    {
      name: "cli-firmware-assets",
      // The firmware commands read the bundled images from dist-cli/firmware/.
      closeBundle() {
        fs.mkdirSync("dist-cli/firmware", { recursive: true });
        for (const f of fs.readdirSync("src/lib/firmware/assets")) if (f.endsWith(".binary")) fs.copyFileSync(`src/lib/firmware/assets/${f}`, `dist-cli/firmware/${f}`);
        fs.chmodSync("dist-cli/jtagulator-cli.mjs", 0o755);
      },
    },
  ],
});
