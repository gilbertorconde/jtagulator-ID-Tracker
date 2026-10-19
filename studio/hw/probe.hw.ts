import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JTAGulator } from "../src/lib/core/jtagulator";
import { Session } from "../src/lib/core/session";
import { TtyTransport } from "./tty-transport";

const PORT = process.env.JTAGULATOR_PORT ?? "/dev/ttyUSB0";
let dev: JTAGulator;
let session: Session;
let log = "";

beforeAll(async () => {
  session = new Session(new TtyTransport(PORT));
  session.rx.on((t) => (log += t));
  await session.connect();
  await new Promise((r) => setTimeout(r, 600));
  dev = new JTAGulator(session);
});
afterAll(async () => {
  await dev.setTargetVoltage(0).catch(() => {});
  await session.disconnect();
  const fsm = await import("node:fs");
  fsm.writeFileSync("/tmp/jtagulator-hw.log", log);
});

describe("real JTAGulator (nothing connected)", () => {
  it("syncs to the prompt", async () => {
    expect(await dev.sync()).toBe("normal");
  });
  it("reads version info", async () => {
    const info = await dev.info();
    console.log("INFO", info);
    expect(info.firmware).toMatch(/JTAGulator/);
  });
  it("reads and sets voltage", async () => {
    console.log("V before", await dev.getVoltage());
    expect(await dev.setTargetVoltage(3.3)).toBe(3.3);
    expect(await dev.getVoltage()).toBe(3.3);
  });
  it("help in every menu", async () => {
    for (const m of ["main", "jtag", "uart", "gpio", "swd"] as const) expect((await dev.help(m)).length).toBeGreaterThan(20);
  });
  it("reads GPIO", async () => {
    const s = await dev.gpioRead();
    console.log("GPIO", s.value.toString(16));
    expect(s.bits).toHaveLength(24);
  });
  it("IDCODE scan finds nothing on open channels", async () => {
    const r = await dev.idcodeScan({ start: 0, end: 3 }, { onEvent: (e) => e.type === "progress" && 0 });
    console.log("IDCODE", r.messages, r.durationMs, "ms");
    expect(r.findings).toHaveLength(0);
  });
  it("combined scan, small range", async () => {
    let ticks = 0;
    const r = await dev.jtagScan({ start: 0, end: 4 }, { onEvent: (e) => e.type === "progress" && (ticks = e.ticks) });
    console.log("JTAG", r.messages, r.permutations, "ticks", ticks, r.durationMs, "ms");
    expect(r.permutations).toBe(120);
  });
  it("aborts a BYPASS scan", async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 1500);
    const r = await dev.bypassScan({ start: 0, end: 15 }, { signal: ctl.signal });
    console.log("BYPASS abort", r.aborted, r.messages);
    expect(r.aborted).toBe(true);
    expect((await dev.info()).firmware).toMatch(/JTAGulator/);
  });
  it("SWD scan, small range", async () => {
    const r = await dev.swdScan({ start: 0, end: 3 });
    console.log("SWD", r.messages, r.durationMs);
    expect(r.findings).toHaveLength(0);
  });
  it("RTCK scan", async () => {
    const r = await dev.rtckScan({ start: 0, end: 3 });
    console.log("RTCK", r.messages, r.findings);
  });
  it("UART TXD scan for 2 s", async () => {
    const r = await dev.uartTxdScan({ start: 0, end: 7, durationMs: 2000 });
    console.log("TXD", r.findings, r.messages);
  });
  it("UART active scan, 2 channels", async () => {
    const r = await dev.uartScan({ start: 0, end: 1, printableOnly: true });
    console.log("UART", r.findings.length, r.messages, r.durationMs);
  });
  it("device IDs / test bypass with a made-up pinout", async () => {
    const f = await dev.getDeviceIds({ tdo: 1, tck: 2, tms: 3 });
    console.log("IDs", f.devices.length);
    const b = await dev.testBypass({ tdi: 0, tdo: 1, tck: 2, tms: 3 }).catch((e) => String(e));
    console.log("BYPASS", b);
    const s = await dev.swdDeviceId({ swdio: 0, swclk: 1 });
    console.log("SWD id", s);
  });
  it("monitors and drives GPIO", async () => {
    const st = await dev.gpioMonitor({ durationMs: 800 });
    console.log("monitor states", st.length);
    const h = await dev.gpioWrite(0x0000ff);
    await new Promise((r) => setTimeout(r, 300));
    await h.release();
    expect(dev.menu).toBe("gpio");
  });
  it("UART passthrough opens and closes", async () => {
    const h = await dev.uartPassthrough({ txd: 0, rxd: 1, baud: 115200 });
    await h.write("hello\r");
    await new Promise((r) => setTimeout(r, 300));
    await h.close();
    expect(dev.menu).toBe("uart");
  });
});
