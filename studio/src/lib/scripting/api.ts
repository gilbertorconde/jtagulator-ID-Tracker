// The one list of device operations. The UI, scripts and the macro recorder all
// go through it, so anything you can click you can also script (and record).
import type { GpioWriteHandle, JTAGulator, PassthroughHandle } from "../core/jtagulator";
import type { OpContext } from "../core/types";

export interface CallSpec {
  /** Shown in the activity list and the run banner. */
  label: string;
  /** One-line description for the script reference. */
  doc: string;
  /** Example argument for the script reference / autocomplete. */
  example?: string;
  /** Long-running scan with progress (shows the progress banner). */
  scan?: boolean;
  /** Changes persistent device state; the UI asks before running it. */
  risky?: string;
  run: (dev: JTAGulator, ctx: OpContext, ...args: any[]) => Promise<unknown>;
}

export const CALLS = {
  "device.info": {
    label: "Read version",
    doc: "Firmware version information.",
    run: (d, c) => d.info(c),
  },
  "device.getVoltage": {
    label: "Read target voltage",
    doc: "Current target I/O voltage in volts, or null when off.",
    run: (d, c) => d.getVoltage(c),
  },
  "device.setVoltage": {
    label: "Set target voltage",
    doc: "Set target I/O voltage (1.4 - 3.3 V, 0 = off). Scans need it set.",
    example: "3.3",
    run: (d, c, v: number) => d.setTargetVoltage(v, c),
  },
  "device.sync": {
    label: "Sync",
    doc: "Find the command prompt and detect the operating mode.",
    run: (d) => d.sync(),
  },
  "device.help": {
    label: "Help",
    doc: "Firmware help text for a menu ('main' | 'jtag' | 'uart' | 'gpio' | 'swd').",
    example: '"jtag"',
    run: (d, c, menu = "main") => d.help(menu, c),
  },

  "jtag.scan": {
    label: "JTAG combined scan",
    doc: "Combined IDCODE + BYPASS scan. Finds TDI, TDO, TCK, TMS and TRST#.",
    example: "{ start: 0, end: 7 }",
    scan: true,
    run: (d, c, o) => d.jtagScan(o, c),
  },
  "jtag.idcodeScan": {
    label: "JTAG IDCODE scan",
    doc: "Finds TDO, TCK, TMS on targets whose devices reset to IDCODE. Fast.",
    example: "{ start: 0, end: 7 }",
    scan: true,
    run: (d, c, o) => d.idcodeScan(o, c),
  },
  "jtag.bypassScan": {
    label: "JTAG BYPASS scan",
    doc: "Finds TDI, TDO, TCK, TMS by shifting data through BYPASS. Slow; pass known pins to speed it up.",
    example: "{ start: 0, end: 7, known: { tck: 2 } }",
    scan: true,
    run: (d, c, o) => d.bypassScan(o, c),
  },
  "jtag.rtckScan": {
    label: "RTCK scan",
    doc: "Finds the adaptive-clocking RTCK return pin.",
    example: "{ start: 0, end: 7, tck: 2 }",
    scan: true,
    run: (d, c, o) => d.rtckScan(o, c),
  },
  "jtag.deviceIds": {
    label: "Get JTAG device IDs",
    doc: "Read every IDCODE in the chain with a known pinout.",
    example: "{ tdo: 5, tck: 2, tms: 4 }",
    run: (d, c, p) => d.getDeviceIds(p, c),
  },
  "jtag.testBypass": {
    label: "Test BYPASS",
    doc: "Shift a random pattern TDI → TDO through BYPASS and compare.",
    example: "{ tdi: 3, tdo: 5, tck: 2, tms: 4 }",
    run: (d, c, p) => d.testBypass(p, c),
  },
  "jtag.irdr": {
    label: "IR/DR discovery",
    doc: "DR length behind every instruction. Single device in chain.",
    example: "{ pins: { tdi: 3, tdo: 5, tck: 2, tms: 4 }, ignoreSingleBit: true }",
    scan: true,
    run: (d, c, o) => d.irdrDiscovery(o, c),
  },
  "jtag.pinMapper": {
    label: "Pin mapper (EXTEST)",
    doc: "Map Boundary Scan Register bits to JTAGulator channels. Stops after `passes` or `durationMs`.",
    example: "{ pins: { tdi: 3, tdo: 5, tck: 2, tms: 4 }, instruction: 0x0, passes: 2 }",
    scan: true,
    run: (d, c, o) => d.pinMapper(o, c),
  },
  "jtag.openocd": {
    label: "Enter OpenOCD mode",
    doc: "Switch to OpenOCD (Bus Pirate protocol) mode. Persists across resets until exited.",
    example: "{ tdi: 3, tdo: 5, tck: 2, tms: 4 }",
    risky: "OpenOCD mode persists through resets and power cycles until you exit it.",
    run: (d, c, p) => d.enterOpenOcd(p, c),
  },

  "swd.scan": {
    label: "SWD scan",
    doc: "Finds SWDIO and SWCLK by reading the DPIDR on every pin pair.",
    example: "{ start: 0, end: 7 }",
    scan: true,
    run: (d, c, o) => d.swdScan(o, c),
  },
  "swd.deviceId": {
    label: "Get SWD device ID",
    doc: "Read the DPIDR with a known SWD pinout. Returns null if nothing answers.",
    example: "{ swdio: 9, swclk: 8 }",
    run: (d, c, p) => d.swdDeviceId(p, c),
  },

  "uart.scan": {
    label: "UART scan",
    doc: "Send text on every TXD/RXD pair at every standard baud rate and watch for a reply.",
    example: '{ start: 0, end: 7, text: "\\r", printableOnly: true }',
    scan: true,
    run: (d, c, o) => d.uartScan(o, c),
  },
  "uart.txdScan": {
    label: "UART TXD scan",
    doc: "Passively watch channels for UART traffic and measure the baud rate.",
    example: "{ start: 0, end: 7, durationMs: 10000 }",
    scan: true,
    run: (d, c, o) => d.uartTxdScan(o, c),
  },

  "gpio.read": {
    label: "Read channels",
    doc: "Read all 24 channels once. Returns { value, bits }.",
    run: (d, c) => d.gpioRead(c),
  },
  "gpio.monitor": {
    label: "Monitor channels",
    doc: "Record channel changes for `durationMs`. Returns the list of states.",
    example: "{ durationMs: 2000 }",
    scan: true,
    run: (d, c, o = {}) => d.gpioMonitor(o, c),
  },
  "gpio.pulse": {
    label: "Drive channels",
    doc: "Drive all channels with a 24-bit value for `holdMs`, then release.",
    example: "0x000001, { holdMs: 500 }",
    run: async (d, c, value: number, o: { holdMs?: number } = {}) => {
      const h = await d.gpioWrite(value, { holdMs: o.holdMs ?? 500 }, c);
      await h.released;
      return { value };
    },
  },
  "gpio.logicAnalyzer": {
    label: "Enter logic analyzer mode",
    doc: "Switch to OLS/SUMP logic analyzer mode. Persists across resets until exited.",
    risky: "Logic analyzer mode persists through resets and power cycles until you exit it.",
    run: (d, c) => d.enterLogicAnalyzer(c),
  },
  "device.exitMode": {
    label: "Exit special mode",
    doc: "Leave logic analyzer / OpenOCD mode (sends Ctrl-X).",
    run: (d) => d.exitSpecialMode(),
  },
} satisfies Record<string, CallSpec>;

export type CallName = keyof typeof CALLS;

/** Live handles (passthrough sessions, driven outputs) that scripts refer to by id. */
export class HandleTable {
  private next = 1;
  readonly passthrough = new Map<number, { h: PassthroughHandle; buf: string; waiters: (() => void)[] }>();
  readonly outputs = new Map<number, GpioWriteHandle>();

  addPassthrough(h: PassthroughHandle) {
    const id = this.next++;
    const entry = { h, buf: "", waiters: [] as (() => void)[] };
    h.onData((t) => {
      entry.buf += t;
      if (entry.buf.length > 256 * 1024) entry.buf = entry.buf.slice(-128 * 1024);
      entry.waiters.splice(0).forEach((w) => w());
    });
    this.passthrough.set(id, entry);
    void h.closed.then(() => this.passthrough.delete(id));
    return id;
  }

  addOutput(h: GpioWriteHandle) {
    const id = this.next++;
    this.outputs.set(id, h);
    void h.released.then(() => this.outputs.delete(id));
    return id;
  }

  async closeAll() {
    await Promise.allSettled([...this.passthrough.values()].map((p) => p.h.close()));
    await Promise.allSettled([...this.outputs.values()].map((o) => o.release()));
  }
}

/** Format a call as a line of script (used by the macro recorder). */
export function callToCode(name: string, args: unknown[]): string {
  const fmt = (v: unknown): string => {
    if (v instanceof Uint8Array) return `bytes(${JSON.stringify([...v])})`;
    if (typeof v === "string") return JSON.stringify(v);
    if (v === undefined) return "undefined";
    if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
    if (v && typeof v === "object") {
      const entries = Object.entries(v).filter(([, x]) => x !== undefined);
      if (!entries.length) return "{}";
      return `{ ${entries.map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${fmt(x)}`).join(", ")} }`;
    }
    return String(v);
  };
  while (args.length && args[args.length - 1] === undefined) args = args.slice(0, -1);
  return `await ${name}(${args.map(fmt).join(", ")});`;
}

/** The registry seen as plain specs (for listing docs/examples). */
export const CALL_SPECS: Record<string, CallSpec> = CALLS;
