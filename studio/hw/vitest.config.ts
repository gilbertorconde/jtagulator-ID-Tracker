import { defineConfig } from "vitest/config";
// Hardware tests: `npx vitest run --config hw/vitest.config.ts` with a JTAGulator
// on JTAGULATOR_PORT (default /dev/ttyUSB0). Nothing needs to be wired to the channels.
export default defineConfig({ test: { include: ["hw/**/*.hw.ts"], testTimeout: 120_000, hookTimeout: 30_000, fileParallelism: false } });
