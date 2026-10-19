// Logic analyzer on real hardware, running ID Tracker 1.3 from RAM (the board's
// installed firmware is untouched). Nothing needs to be connected: the inputs
// idle at a fixed level, which is enough to check triggers and sample formatting.
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JTAGulator } from "../src/lib/core/jtagulator";
import { Session } from "../src/lib/core/session";
import { loadPropeller } from "../src/lib/firmware/loader";
import { resetBoard } from "../src/lib/firmware/manager";
import { SumpClient } from "../src/lib/logic/sump";
import { TtyTransport } from "./tty-transport";

const PORT = process.env.JTAGULATOR_PORT ?? "/dev/ttyUSB0";
let t: TtyTransport;
let s: Session;
let dev: JTAGulator;

beforeAll(async () => {
  t = new TtyTransport(PORT);
  await t.open();
  await loadPropeller(t, new Uint8Array(fs.readFileSync(new URL("../src/lib/firmware/assets/jtagulator.binary", import.meta.url))), "ram");
  s = new Session(t);
  await s.connect();
  dev = new JTAGulator(s);
  expect(await dev.sync()).toBe("normal");
  expect((await dev.info()).version).toBe("1.3");
  await dev.setTargetVoltage(3.3);
});

afterAll(async () => {
  // Always leave logic analyzer mode: it is stored in EEPROM.
  if (dev.mode === "sump") await dev.exitSpecialMode().catch(() => {});
  await resetBoard(t);
  await s.disconnect();
});

describe("SUMP on hardware (ID Tracker 1.3 in RAM)", () => {
  it("enters logic analyzer mode and identifies", async () => {
    await dev.enterLogicAnalyzer();
    const sump = new SumpClient(s, { fullTriggers: true });
    expect(await sump.identify()).toBe("1ALS");
    console.log("metadata", await sump.metadata());
  });

  it("captures 1024 samples on all groups", async () => {
    const sump = new SumpClient(s, { fullTriggers: true });
    const cap = await sump.capture({ sampleRateHz: 100_000, samples: 1024, channels: [] });
    expect(cap.samples.length).toBe(1024);
    console.log("first samples", [...cap.samples.slice(0, 4)].map((v) => v.toString(16)));
  });

  it("triggers on CH16 (needs the 1.3 trigger fix)", async () => {
    const sump = new SumpClient(s, { fullTriggers: true });
    const snap = await sump.snapshot();
    const level = (snap >>> 16) & 1;
    console.log("snapshot", snap.toString(16), "CH16 =", level);
    // Trigger on CH16's current level: fires at once.
    const cap = await sump.capture({ sampleRateHz: 100_000, samples: 64, channels: [], trigger: { mask: 1 << 16, value: level << 16 }, timeoutMs: 4000 });
    expect(cap.triggerIndex).toBe(0);
    // The opposite level never comes on an idle input, so this must time out.
    // Old firmware dropped the upper mask bytes (empty mask) and fired at once.
    await expect(
      sump.capture({ sampleRateHz: 100_000, samples: 64, channels: [], trigger: { mask: 1 << 16, value: (level ^ 1) << 16 }, timeoutMs: 2000 }),
    ).rejects.toThrow();
  });

  it("pre-trigger capture completes at every rate (ring buffer + software trigger)", async () => {
    const sump = new SumpClient(s, { fullTriggers: true, preTrigger: true });
    const level = ((await sump.snapshot()) >>> 16) & 1;
    for (const rate of [909_090, 500_000, 100_000, 10_000]) {
      for (const pre of [4, 512, 1020]) {
        const cap = await sump.capture({
          sampleRateHz: rate,
          samples: 1024,
          channels: [],
          trigger: { mask: 1 << 16, value: level << 16 },
          preTriggerSamples: pre,
          timeoutMs: 6000,
        });
        expect(cap.samples.length).toBe(1024);
        expect(cap.triggerIndex).toBe(pre);
        expect(cap.samples.every((v) => v === cap.samples[0])).toBe(true);
      }
    }
    // A trigger that never comes must still be cancellable.
    await expect(
      sump.capture({ sampleRateHz: 909_090, samples: 1024, channels: [], trigger: { mask: 1 << 16, value: (level ^ 1) << 16 }, preTriggerSamples: 512, timeoutMs: 1500 }),
    ).rejects.toThrow();
    // ...and normal captures still work afterwards.
    expect((await sump.capture({ sampleRateHz: 1_200_000, samples: 64, channels: [] })).samples.length).toBe(64);
  });

  it("exits back to the menu", async () => {
    await dev.exitSpecialMode();
    expect(dev.mode).toBe("normal");
  });
});
