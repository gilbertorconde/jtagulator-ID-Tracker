import { beforeEach, describe, expect, it } from "vitest";
import { JTAGulator } from "../src/lib/core/jtagulator";
import { Session } from "../src/lib/core/session";
import { SimTransport } from "../src/lib/core/transports/sim";
import { decodeDpidr, decodeJtag } from "../src/lib/core/idcode";
import type { OpEvent } from "../src/lib/core/types";

let dev: JTAGulator;
let sim: SimTransport;

beforeEach(async () => {
  sim = new SimTransport();
  sim.fw.scanSeconds = 0.05;
  const s = new Session(sim);
  await s.connect();
  dev = new JTAGulator(s);
  expect(await dev.sync()).toBe("normal");
});

describe("idcode", () => {
  it("decodes JEP106 manufacturers across banks", () => {
    expect(decodeJtag(0x4ba00477).manufacturer).toBe("ARM Ltd");
    expect(decodeJtag(0x06413041).manufacturer).toBe("STMicroelectronics");
    expect(decodeDpidr(0x2ba01477).designer).toBe("ARM Ltd");
    expect(decodeDpidr(0x2ba01477).part).toMatch(/ARM debug port \(seen on/);
  });
});

describe("general", () => {
  it("reads version info", async () => {
    const info = await dev.info();
    expect(info.idTracker).toBe(true);
    expect(info.version).toBe("1.3");
  });

  it("requires target voltage for scans", async () => {
    await expect(dev.idcodeScan({ start: 0, end: 7 })).rejects.toThrow(/voltage must be defined/);
  });

  it("sets and reads voltage", async () => {
    expect(await dev.setTargetVoltage(3.3)).toBe(3.3);
    expect(await dev.getVoltage()).toBe(3.3);
    expect(await dev.setTargetVoltage(1.8)).toBe(1.8);
    expect(await dev.setTargetVoltage(0)).toBe(null);
  });
});

describe("JTAG", () => {
  beforeEach(async () => {
    await dev.setTargetVoltage(3.3);
  });

  it("combined scan finds the full pinout", async () => {
    const events: OpEvent[] = [];
    const r = await dev.jtagScan({ start: 0, end: 8 }, { onEvent: (e) => events.push(e) });
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect([f.tdi, f.tdo, f.tck, f.tms]).toEqual([3, 5, 2, 4]);
    expect(f.trst).toEqual([7]);
    expect(f.devices.map((d) => d.idcode.hex)).toEqual(["0x4BA00477", "0x06413041"]);
    expect(events.some((e) => e.type === "progress")).toBe(true);
    expect(events.some((e) => e.type === "result")).toBe(true);
    expect(r.permutations).toBe(9 * 8 * 7 * 6);
  });

  it("IDCODE scan finds TDO/TCK/TMS", async () => {
    const r = await dev.idcodeScan({ start: 0, end: 7, pinsLow: { lowMs: 5, highMs: 5 } });
    expect(r.findings[0]).toMatchObject({ tdi: null, tdo: 5, tck: 2, tms: 4 });
  });

  it("reports no device outside the range", async () => {
    const r = await dev.idcodeScan({ start: 10, end: 15 });
    expect(r.findings).toHaveLength(0);
    expect(r.messages).toContain("No target device(s) found!");
  });

  it("BYPASS scan with partially known pins", async () => {
    const r = await dev.bypassScan({ start: 0, end: 7, known: { tck: 2, tms: 4 } });
    expect(r.findings[0]).toMatchObject({ tdi: 3, tdo: 5, tck: 2, tms: 4, deviceCount: 2 });
    expect(r.permutations).toBe(6 * 5);
  });

  it("RTCK scan", async () => {
    const r = await dev.rtckScan({ start: 0, end: 7, tck: 2 });
    expect(r.findings).toEqual([{ kind: "rtck", tck: 2, rtck: 6 }]);
  });

  it("gets device IDs with firmware manufacturer names", async () => {
    const f = await dev.getDeviceIds({ tdo: 5, tck: 2, tms: 4 });
    expect(f.devices).toHaveLength(2);
    expect(f.devices[0].firmwareManufacturer).toBe("ARM Ltd");
  });

  it("tests BYPASS", async () => {
    const r = await dev.testBypass({ tdi: 3, tdo: 5, tck: 2, tms: 4 });
    expect(r.devices).toBe(2);
    expect(r.match).toBe(true);
  });

  it("rejects pin collisions before talking to the device", async () => {
    await expect(dev.testBypass({ tdi: 3, tdo: 3, tck: 2, tms: 4 })).rejects.toThrow(/unique/);
    // Session is still usable afterwards.
    expect((await dev.info()).idTracker).toBe(true);
  });

  it("IR/DR discovery needs a single device", async () => {
    await expect(dev.irdrDiscovery({ pins: { tdi: 3, tdo: 5, tck: 2, tms: 4 } })).rejects.toThrow(/More than one device/);
    sim.fw.target.jtag!.idcodes = [0x4ba00477];
    const r = await dev.irdrDiscovery({ pins: { tdi: 3, tdo: 5, tck: 2, tms: 4 } });
    expect(r.irLength).toBe(4);
    expect(r.instructions).toBe(16);
    expect(r.findings.map((f) => [f.ir, f.dr])).toContainEqual([8, 35]);
  });

  it("pin mapper stops after N passes", async () => {
    sim.fw.target.jtag!.idcodes = [0x4ba00477];
    const r = await dev.pinMapper({ pins: { tdi: 3, tdo: 5, tck: 2, tms: 4 }, instruction: 0, passes: 1 });
    expect(r.bsrLength).toBe(64);
    expect(r.findings.map((f) => [f.channel, f.bit])).toEqual([
      [12, 10],
      [13, 23],
      [14, 40],
    ]);
  });

  it("aborts a running scan and recovers", async () => {
    sim.fw.scanSeconds = 5;
    const ctl = new AbortController();
    const p = dev.bypassScan({ start: 0, end: 23 }, {
      signal: ctl.signal,
      onEvent: (e) => e.type === "progress" && ctl.abort(),
    });
    const r = await p;
    expect(r.aborted).toBe(true);
    sim.fw.scanSeconds = 0.05;
    expect((await dev.info()).idTracker).toBe(true);
  });
});

describe("SWD", () => {
  beforeEach(async () => {
    await dev.setTargetVoltage(1.8);
  });

  it("scan finds SWDIO/SWCLK and DPIDR", async () => {
    const r = await dev.swdScan({ start: 6, end: 11 });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ swdio: 9, swclk: 8 });
    expect(r.findings[0].dpidr?.hex).toBe("0x2BA01477");
  });

  it("device ID with known pins", async () => {
    const f = await dev.swdDeviceId({ swdio: 9, swclk: 8 });
    expect(f?.dpidr?.designer).toBe("ARM Ltd");
    expect(f?.firmwareManufacturer).toBe("ARM Ltd");
    expect(await dev.swdDeviceId({ swdio: 1, swclk: 0 })).toBeNull();
  });
});

describe("UART", () => {
  beforeEach(async () => {
    await dev.setTargetVoltage(3.3);
  });

  it("scan finds TXD/RXD/baud", async () => {
    const r = await dev.uartScan({ start: 15, end: 18, text: "help" });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ txd: 16, rxd: 17, baud: 115200 });
    expect(r.findings[0].hex?.length).toBeGreaterThan(0);
  });

  it("TXD scan runs for a fixed duration", async () => {
    const r = await dev.uartTxdScan({ start: 0, end: 23, durationMs: 2000 });
    expect(r.findings[0]).toMatchObject({ txd: 16, bestFit: 115200 });
  });

  it("passthrough", async () => {
    const h = await dev.uartPassthrough({ txd: 16, rxd: 17, baud: 115200 });
    let got = "";
    h.onData((t) => (got += t));
    await h.write("version\r");
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toMatch(/U-Boot 2016/);
    await h.close();
    expect(dev.menu).toBe("uart");
  });
});

describe("GPIO", () => {
  beforeEach(async () => {
    await dev.setTargetVoltage(3.3);
  });

  it("reads all channels", async () => {
    const s = await dev.gpioRead();
    expect(s.bits).toHaveLength(24);
  });

  it("writes and releases", async () => {
    const h = await dev.gpioWrite(0x00a5a5);
    expect(sim.fw.channels()).toBe(0x00a5a5);
    await h.release();
    expect(dev.menu).toBe("gpio");
  });

  it("monitors for a while", async () => {
    const states = await dev.gpioMonitor({ durationMs: 1200 });
    expect(states.length).toBeGreaterThan(0);
  });

  it("enters and exits logic analyzer mode", async () => {
    await dev.enterLogicAnalyzer();
    expect(dev.mode).toBe("sump");
    expect(await dev.sync()).toBe("sump");
    await dev.exitSpecialMode();
    expect(dev.mode).toBe("normal");
    expect(dev.menu).toBe("gpio");
  });
});
