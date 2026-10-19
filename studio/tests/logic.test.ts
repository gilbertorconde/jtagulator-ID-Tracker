import { beforeEach, describe, expect, it } from "vitest";
import { JTAGulator } from "../src/lib/core/jtagulator";
import { AbortedError, Session } from "../src/lib/core/session";
import { SimTransport } from "../src/lib/core/transports/sim";
import {
  SUMP_LIMITS,
  SumpClient,
  clampSamples,
  flagsForGroups,
  parseMetadata,
  planSampleRate,
  unpackSamples,
} from "../src/lib/logic/sump";
import { SIM_I2C_BYTES, SIM_SIGNALS, SIM_UART_BAUD, SIM_UART_PERIOD, SIM_UART_TEXT, SimSump, installSimSump } from "../src/lib/logic/sim-sump";
import { SimFirmware } from "../src/lib/sim/firmware";
import { decodeI2c, decodeSpi, decodeUart, measure, transitions } from "../src/lib/logic/decode";
import { toCSV, toVCD } from "../src/lib/logic/export";

let dev: JTAGulator;
let sim: SimTransport;
let session: Session;
let simSump: SimSump;
let sump: SumpClient;

beforeEach(async () => {
  sim = new SimTransport();
  sim.fw.scanSeconds = 0.05;
  simSump = installSimSump(sim.fw, { maxCaptureMs: 50 });
  session = new Session(sim);
  await session.connect();
  dev = new JTAGulator(session);
  expect(await dev.sync()).toBe("normal");
  await dev.setTargetVoltage(3.3);
  await dev.enterLogicAnalyzer();
  expect(dev.mode).toBe("sump");
  sump = new SumpClient(session);
});

describe("SUMP helpers", () => {
  it("quantizes sample rates like the firmware", () => {
    const max = planSampleRate(10e6);
    expect(max.clocksWait).toBe(66);
    expect(max.actualHz).toBeCloseTo(80e6 / 66);
    const r = planSampleRate(100_000);
    expect(r.clocksWait).toBe(800);
    expect(Math.floor(((r.divider + 1) * 4) / 5)).toBe(800);
    expect(r.actualHz).toBe(100_000);
    expect(planSampleRate(0.001).actualHz).toBeCloseTo(SUMP_LIMITS.minSampleRateHz);
  });

  it("clamps sample counts to multiples of 4 up to 1024", () => {
    expect(clampSamples(5000)).toBe(1024);
    expect(clampSamples(5000, 1364)).toBe(1364);
    expect(clampSamples(1)).toBe(4);
    expect(clampSamples(102)).toBe(104);
  });

  it("builds group-disable flags", () => {
    expect(flagsForGroups(0b111)).toBe(0x20);
    expect(flagsForGroups(0b001)).toBe(0x20 | 0x08 | 0x10);
  });

  it("unpacks newest-first samples", () => {
    // Two groups (0 and 2), samples sent newest first.
    const s = unpackSamples([0x02, 0xb2, 0x01, 0xb1], 2, 0b101);
    expect([...s]).toEqual([0xb10001, 0xb20002]);
  });

  it("parses the JTAGulator metadata block", () => {
    const meta = parseMetadata([0x01, 0x41, 0x00, 0x21, 0, 0, 0x0c, 0, 0x40, 24, 0x00]);
    expect(meta?.meta).toEqual({ deviceName: "A", sampleMemory: 3072, numProbes: 24 });
    expect(parseMetadata([0x01, 0x41])).toBeNull();
  });
});

describe("SumpClient against the simulator", () => {
  it("identifies and reads metadata", async () => {
    expect(await sump.identify()).toBe("1ALS");
    const meta = await sump.metadata();
    expect(meta).toMatchObject({
      deviceName: "JTAGulator",
      sampleMemory: 3072,
      maxSampleRate: 1_200_000,
      numProbes: 24,
      protocolVersion: 2,
    });
  });

  it("dev.sync() still detects SUMP mode", async () => {
    expect(await dev.sync()).toBe("sump");
  });

  it("reads a live snapshot", async () => {
    const v = await sump.snapshot();
    // Static channels come from the target's GPIO base level.
    const gpio = sim.fw.target.gpio!;
    const staticMask = (1 << 5) | (1 << 7) | (0xf << 8) | (0x7 << 17);
    expect(v & staticMask).toBe(gpio & staticMask);
  });

  it("captures the requested sample count, oldest first", async () => {
    const cap = await sump.capture({ sampleRateHz: 1_000_000, samples: 512, channels: [] });
    expect(cap.samples.length).toBe(512);
    expect(cap.channelMask).toBe(0xffffff);
    expect(cap.triggerIndex).toBeNull();
    expect(cap.sampleRateHz).toBeCloseTo(1_000_000);
    // CH2-4 form a counter stepping every 100 µs (100 samples at 1 MHz): it must
    // only ever count up (mod 8) in an oldest-first capture.
    const counter = (v: number) => (v >> 2) & 7;
    let changes = 0;
    for (let i = 1; i < cap.samples.length; i++) {
      const a = counter(cap.samples[i - 1]);
      const b = counter(cap.samples[i]);
      if (a !== b) {
        changes++;
        expect(b).toBe((a + 1) & 7);
      }
    }
    expect(changes).toBeGreaterThanOrEqual(4);
  });

  it("clamps to 1024 samples and honours disabled groups", async () => {
    const cap = await sump.capture({ sampleRateHz: 500_000, samples: 4096, channels: [0, 3] });
    expect(cap.samples.length).toBe(1024);
    expect(cap.channelMask).toBe(0xff);
    expect(cap.samples.every((v) => v >>> 8 === 0)).toBe(true);
    // A 1 kHz clock on CH0 at 500 kS/s.
    const m = measure(cap, SIM_SIGNALS.clock);
    expect(m.frequencyHz).toBeCloseTo(1000, -1);
    expect(m.duty).toBeCloseTo(0.5, 1);
  });

  it("starts sampling at the trigger", async () => {
    const mask = 0b11100; // counter on CH2-4
    for (const value of [0b10100, 0b01000]) {
      const cap = await sump.capture({ sampleRateHz: 1_000_000, samples: 64, channels: [], trigger: { mask, value } });
      expect(cap.triggerIndex).toBe(0);
      expect(cap.samples[0] & mask).toBe(value);
    }
  });

  it("triggers on any channel with fixed firmware (ID Tracker 1.3)", async () => {
    const full = new SumpClient(session, { fullTriggers: true });
    const uart = 1 << 16; // sim UART TX idles high; trigger on a start bit
    const cap = await full.capture({ sampleRateHz: 100_000, samples: 64, channels: [], trigger: { mask: uart, value: 0 } });
    expect(cap.triggerIndex).toBe(0);
    expect(cap.samples[0] & uart).toBe(0);
  });

  it("rejects triggers outside CH0-7 on old firmware", () => {
    expect(() => sump.capture({ sampleRateHz: 1e6, samples: 64, channels: [], trigger: { mask: 1 << 16, value: 0 } })).toThrow(
      /CH0-7/,
    );
  });

  it("aborts a capture whose trigger never fires", async () => {
    // CH7 is static low in the simulated target: wait for it to go high forever.
    const ac = new AbortController();
    const p = sump.capture({ sampleRateHz: 1e6, samples: 64, channels: [], trigger: { mask: 0x80, value: 0x80 }, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 50));
    expect(simSump.capturing).toBe(true);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(AbortedError);
    expect(simSump.capturing).toBe(false);
    // The link still works afterwards.
    expect(await sump.identify()).toBe("1ALS");
  });

  it("treats 0x18 inside a long command as data, not Ctrl-X", async () => {
    // 0x18 as the divider's low byte: (0x18 + 1) * 4 / 5 = 20 -> clamped to 66.
    await session.write(new Uint8Array([0x80, 0x18, 0x00, 0x00, 0x00]));
    expect(await sump.identify()).toBe("1ALS");
    expect(simSump.clocksWait).toBe(66);
  });

  it("decodes the synthesized UART stream", async () => {
    const txd = sim.fw.target.uart!.txd;
    // Start 2 ms before the message: 9600 baud at 100 kS/s is ~10.4 samples per
    // bit and 1024 samples = 10.24 ms, so the first 7 characters fit.
    simSump.opts.clock = () => SIM_UART_PERIOD * 10 - 0.002;
    const cap = await sump.capture({ sampleRateHz: 100_000, samples: 1024, channels: [txd] });
    expect(cap.channelMask).toBe(0xff0000);
    const frames = decodeUart(cap, { channel: txd, baud: SIM_UART_BAUD });
    expect(frames.every((f) => !f.framingError)).toBe(true);
    expect(String.fromCharCode(...frames.map((f) => f.byte))).toBe(SIM_UART_TEXT.slice(0, 7));
    expect(frames[0].startSample).toBeCloseTo(200, -1);
  });

  it("resynchronizes when the capture starts mid-stream", async () => {
    const txd = sim.fw.target.uart!.txd;
    // Start in the middle of character 3, with no idle time in the window.
    simSump.opts.clock = () => SIM_UART_PERIOD * 10 + (3.45 * 10) / SIM_UART_BAUD;
    const cap = await sump.capture({ sampleRateHz: 100_000, samples: 1024, channels: [txd] });
    const text = String.fromCharCode(...decodeUart(cap, { channel: txd, baud: SIM_UART_BAUD }).map((f) => f.byte));
    expect(text.length).toBeGreaterThanOrEqual(4);
    // After resync everything decoded is the real text.
    expect(SIM_UART_TEXT).toContain(text.slice(-4));
  });

  it("exits back to the menu", async () => {
    await dev.exitSpecialMode();
    expect(dev.mode).toBe("normal");
    expect(await dev.sync()).toBe("normal");
  });
});

describe("UART decoder", () => {
  it("never misaligns on the synthesized stream, at any capture phase", () => {
    const s = new SimSump(new SimFirmware());
    for (const rate of [100_000, 40_000]) {
      for (let k = 0; k < 120; k++) {
        const t0 = 10 * SIM_UART_PERIOD + (k / 120) * SIM_UART_PERIOD;
        const samples = Uint32Array.from({ length: 1024 }, (_, i) => s.levels(t0 + i / rate));
        const cap = { sampleRateHz: rate, samples, channelMask: 0xffffff, triggerIndex: null, capturedAt: 0 };
        const text = String.fromCharCode(...decodeUart(cap, { channel: 16, baud: SIM_UART_BAUD }).map((f) => f.byte));
        expect(SIM_UART_TEXT + SIM_UART_TEXT).toContain(text);
      }
    }
  });

  it("refuses sample rates too low for the baud rate", () => {
    const cap = { sampleRateHz: 9600 * 2, samples: new Uint32Array(64), channelMask: 0xff, triggerIndex: null, capturedAt: 0 };
    expect(decodeUart(cap, { channel: 0, baud: 9600 })).toEqual([]);
  });
});

describe("export", () => {
  const cap = {
    sampleRateHz: 1_000_000,
    samples: Uint32Array.from([0b00, 0b01, 0b01, 0b11, 0b10]),
    channelMask: 0xff,
    triggerIndex: 0,
    capturedAt: Date.UTC(2026, 0, 1),
  };

  it("writes a structurally valid VCD", () => {
    const vcd = toVCD(cap, { channels: [0, 1], names: ["clk", "data bit"] });
    const lines = vcd.trim().split("\n");
    expect(lines).toContain("$timescale 1 ns $end");
    expect(lines).toContain("$var wire 1 ! clk $end");
    expect(lines).toContain('$var wire 1 " data_bit $end');
    expect(lines.indexOf("$enddefinitions $end")).toBeGreaterThan(lines.indexOf("$upscope $end"));
    const body = lines.slice(lines.indexOf("$enddefinitions $end") + 1);
    expect(body).toEqual(["#0", "$dumpvars", "0!", '0"', "$end", "#1000", "1!", "#3000", '1"', "#4000", "0!", "#5000"]);
  });

  it("writes CSV", () => {
    const csv = toCSV(cap, { channels: [0, 1] }).trim().split("\n");
    expect(csv[0]).toBe("sample,time_s,CH0,CH1");
    expect(csv[4]).toBe("3,0.000003,1,1");
    expect(csv).toHaveLength(6);
  });

  it("lists transitions", () => {
    expect([...transitions(cap, 0)]).toEqual([1, 4]);
  });
});

describe("SPI and I2C decoders", () => {
  it("decodes the simulated SPI burst (mode 0, CS# active low)", async () => {
    simSump.opts.clock = () => 1 + 1e-7; // just before a burst starts
    const cap = await sump.capture({ sampleRateHz: 1_200_000, samples: 1024, channels: [20, 21, 22, 23] });
    const { cs, sck, mosi, miso } = SIM_SIGNALS.spi;
    const words = decodeSpi(cap, { sck, mosi, miso, cs, mode: 0 });
    expect(words.map((w) => w.mosi)).toEqual([0x9f, 0x00, 0x00, 0x00]);
    expect(words.map((w) => w.miso)).toEqual([0xff, 0xef, 0x40, 0x18]);
  });

  it("decodes the simulated I2C write", async () => {
    simSump.opts.clock = () => 1 + 1e-7;
    const cap = await sump.capture({ sampleRateHz: 1_200_000, samples: 1024, channels: [10, 11] });
    const ev = decodeI2c(cap, SIM_SIGNALS.i2c);
    expect(ev.map((e) => e.kind)).toEqual(["start", "byte", "byte", "byte", "stop"]);
    const bytes = ev.filter((e) => e.kind === "byte");
    expect(bytes.map((b) => b.kind === "byte" && b.value)).toEqual(SIM_I2C_BYTES);
    expect(bytes.every((b) => b.kind === "byte" && b.ack)).toBe(true);
    expect(bytes[0].kind === "byte" && bytes[0].address).toEqual({ addr: 0x50, read: false });
  });

  it("decodes I2C when the capture is triggered on SDA going low", async () => {
    const full = new SumpClient(session, { fullTriggers: true });
    simSump.opts.clock = () => 1 + 1e-7;
    const sda = 1 << SIM_SIGNALS.i2c.sda;
    const cap = await full.capture({ sampleRateHz: 1_200_000, samples: 1024, channels: [10, 11], trigger: { mask: sda, value: 0 } });
    const ev = decodeI2c(cap, SIM_SIGNALS.i2c);
    expect(ev.filter((e) => e.kind === "byte").map((b) => b.kind === "byte" && b.value)).toEqual(SIM_I2C_BYTES);
  });
});

describe("pre-trigger capture (ID Tracker 1.3)", () => {
  it("keeps samples from before the trigger", async () => {
    const client = new SumpClient(session, { fullTriggers: true, preTrigger: true });
    const cs = 1 << SIM_SIGNALS.spi.cs;
    simSump.opts.clock = () => 1 - 0.0004; // the SPI burst (CS# low) is 0.4 ms away
    const cap = await client.capture({ sampleRateHz: 1_200_000, samples: 512, channels: [20, 21, 22, 23], trigger: { mask: cs, value: 0 }, preTriggerSamples: 128 });
    expect(cap.triggerIndex).toBe(128);
    expect(cap.sampleRateHz).toBeLessThanOrEqual(80e6 / 88);
    // CS# is high before the trigger and low from the trigger on.
    expect(cap.samples[127] & cs).toBe(cs);
    expect(cap.samples[128] & cs).toBe(0);
    const words = decodeSpi(cap, { ...SIM_SIGNALS.spi, mode: 0 });
    expect(words[0].mosi).toBe(0x9f);
  });

  it("is ignored without the capability (older firmware)", async () => {
    const client = new SumpClient(session, { fullTriggers: true });
    simSump.opts.clock = () => 1 - 0.0004;
    const cap = await client.capture({ sampleRateHz: 1_200_000, samples: 256, channels: [20], trigger: { mask: 1 << 20, value: 0 }, preTriggerSamples: 128 });
    expect(cap.triggerIndex).toBe(0);
  });
});

describe("longer captures (ID Tracker 1.4)", () => {
  it("takes 1364 samples when the firmware packs them, 1024 otherwise", async () => {
    const long = new SumpClient(session, { longCaptures: true });
    expect((await long.capture({ sampleRateHz: 100_000, samples: 5000, channels: [] })).samples.length).toBe(1364);
    const old = new SumpClient(session);
    expect((await old.capture({ sampleRateHz: 100_000, samples: 5000, channels: [] })).samples.length).toBe(1024);
  });

  it("keeps pre-trigger captures at 1024", async () => {
    const c = new SumpClient(session, { fullTriggers: true, preTrigger: true, longCaptures: true });
    simSump.opts.clock = () => 1 - 0.0004;
    const cap = await c.capture({ sampleRateHz: 500_000, samples: 1364, channels: [20], trigger: { mask: 1 << 20, value: 0 }, preTriggerSamples: 256 });
    expect(cap.samples.length).toBe(1024);
    expect(cap.triggerIndex).toBe(256);
  });
});
