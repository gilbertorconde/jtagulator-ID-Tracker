// Verifies the logic analyzer's sample packing and pre-trigger ordering on the real
// chip. The self-test program (RAM only) drives a counter on CH0-23 with the same
// 8-bit count in each byte group, then runs the normal SUMP firmware.
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Session } from "../src/lib/core/session";
import { loadPropeller } from "../src/lib/firmware/loader";
import { resetBoard } from "../src/lib/firmware/manager";
import { SumpClient } from "../src/lib/logic/sump";
import { TtyTransport } from "./tty-transport";

const PORT = process.env.JTAGULATOR_PORT ?? "/dev/ttyUSB0";
let t: TtyTransport;
let s: Session;
let sump: SumpClient;

/** Every sample has three equal bytes, and the count never goes backwards. */
function checkCounter(samples: Uint32Array) {
  let prev = -1;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const b0 = v & 0xff;
    expect([(v >>> 8) & 0xff, (v >>> 16) & 0xff], `sample ${i} = 0x${v.toString(16)}`).toEqual([b0, b0]);
    if (prev >= 0) expect((b0 - prev + 256) % 256, `step at sample ${i}`).toBeLessThan(128);
    prev = b0;
  }
}

beforeAll(async () => {
  t = new TtyTransport(PORT);
  await t.open();
  await loadPropeller(t, new Uint8Array(fs.readFileSync(new URL("../src/lib/firmware/assets/sump-selftest.binary", import.meta.url))), "ram");
  await new Promise((r) => setTimeout(r, 300));
  s = new Session(t);
  await s.connect();
  sump = new SumpClient(s, { fullTriggers: true, preTrigger: true, longCaptures: true });
  expect(await sump.identify()).toBe("1ALS");
});

afterAll(async () => {
  await resetBoard(t);
  await s.disconnect();
});

describe("packed captures (ID Tracker 1.4)", () => {
  for (const rate of [1_200_000, 100_000, 10_000]) {
    for (const n of [1364, 1024, 64]) {
      it(`${n} samples at ${rate / 1000} kHz`, async () => {
        const cap = await sump.capture({ sampleRateHz: rate, samples: n, channels: [], timeoutMs: 8000 });
        expect(cap.samples.length).toBe(n);
        checkCounter(cap.samples);
        // The counter must actually move during longer captures.
        if (n * (1 / rate) > 0.005) expect(new Set(cap.samples).size).toBeGreaterThan(1);
      });
    }
  }

  it("captures with one channel group", async () => {
    const cap = await sump.capture({ sampleRateHz: 100_000, samples: 1364, channels: [3], timeoutMs: 8000 });
    expect(cap.samples.length).toBe(1364);
    expect(cap.samples.every((v) => v <= 0xff)).toBe(true);
  });
});

describe("pre-trigger ring ordering", () => {
  for (const rate of [909_090, 100_000]) {
    it(`trigger on CH7 high with 512 samples before it at ${rate / 1000} kHz`, async () => {
      const cap = await sump.capture({
        sampleRateHz: rate,
        samples: 1024,
        channels: [],
        trigger: { mask: 1 << 7, value: 1 << 7 },
        preTriggerSamples: 512,
        timeoutMs: 8000,
      });
      expect(cap.triggerIndex).toBe(512);
      checkCounter(cap.samples);
      expect(cap.samples[512] & 0x80).toBe(0x80);
    });
  }
});

describe("multi-stage trigger chain", () => {
  it("waits for CH7 high, then CH7 low, then starts", async () => {
    const cap = await sump.capture({
      sampleRateHz: 1_200_000,
      samples: 256,
      channels: [],
      stages: [
        { mask: 1 << 7, value: 1 << 7 },
        { mask: 1 << 7, value: 0, start: true },
      ],
      timeoutMs: 8000,
    });
    checkCounter(cap.samples);
    // CH7 falls when the count wraps 255 -> 0, so the capture starts near 0.
    expect(cap.samples[0] & 0xff).toBeLessThan(16);
  });

  it("the 4th stage always starts", async () => {
    const cap = await sump.capture({
      sampleRateHz: 1_200_000,
      samples: 64,
      channels: [],
      stages: [{ mask: 1 << 7, value: 1 << 7 }, { mask: 1 << 7, value: 0 }, { mask: 1 << 6, value: 1 << 6 }, { mask: 1 << 5, value: 1 << 5 }],
      timeoutMs: 8000,
    });
    checkCounter(cap.samples);
    expect(cap.samples[0] & 0x20).toBe(0x20);
  });
});
