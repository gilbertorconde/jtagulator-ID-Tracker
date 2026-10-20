// jtagulator-cli: the JTAGulator from a terminal, on the same core as the app.
import fs from "node:fs";
import { parseArgs } from "node:util";
import { JTAGulator } from "../src/lib/core/jtagulator";
import { Session } from "../src/lib/core/session";
import type { Transport } from "../src/lib/core/transport";
import { SimTransport } from "../src/lib/core/transports/sim";
import type { Finding, OpContext, ScanResult } from "../src/lib/core/types";
import { canLoad, type DtrTransport, type LoadProgress } from "../src/lib/firmware/loader";
import { BUNDLED_VERSION, installFirmware, probeDatabase, resetBoard, writeDatabase } from "../src/lib/firmware/manager";
import { describeFinding } from "../src/lib/report";
import { CALLS, HandleTable, type CallName } from "../src/lib/scripting/api";
import { HOST_CALLS, serveScriptCall } from "../src/lib/scripting/host";
import { DEFAULT_TARGET } from "../src/lib/sim/firmware";

export const CLI_VERSION = "0.1.2";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  /** True when stderr is a terminal (progress lines). */
  tty?: boolean;
  /** Overrides for tests. */
  transport?: () => Transport;
  assets?: string;
  signal?: AbortSignal;
}

const HELP = `jtagulator-cli ${CLI_VERSION}: control a JTAGulator (ID Tracker firmware) from a terminal.

Usage: jtagulator-cli [options] <command> [arguments]

Commands
  ports                          List serial ports (JTAGulators first)
  info                           Firmware version and target voltage
  voltage [volts|off]            Read or set the target I/O voltage (1.4-3.3 V)
  scan jtag|idcode|bypass|rtck|swd|uart|txd
                                 Run a discovery scan over --start..--end
  ids jtag --tdo N --tck N --tms N
  ids swd --swdio N --swclk N    Read device IDs with a known pinout
  bypass --tdi N --tdo N --tck N --tms N
                                 Check TDI/TDO with a BYPASS shift
  gpio read | monitor | write VALUE
                                 Read, watch (--duration ms) or drive channels (--hold ms)
  run SCRIPT.js                  Run a JavaScript file with the app's script API
  firmware install [FILE]        Program firmware into EEPROM (bundled ID Tracker ${BUNDLED_VERSION} by default; --yes)
  firmware test [FILE]           Load firmware into RAM only, until the next reset
  firmware probe                 Check the manufacturer database (reads only)
  firmware db                    Write the manufacturer database (~20 min; --yes)
  exit-mode                      Leave logic analyzer / OpenOCD mode

Opening the port restarts the JTAGulator, so the target voltage is cleared on every
run: pass -v with each command that drives the target.

Options
  -p, --port PATH     Serial port (default: the first FTDI FT232R port)
      --sim           Use the built-in simulator instead of hardware
  -v, --voltage V     Set the target voltage before the command
      --start N       First channel of a scan (default 0)
      --end N         Last channel of a scan (default 7)
      --pins-low      Pulse channels LOW before each permutation
      --known K=N,..  Known pins for bypass/uart scans, e.g. tck=2,tms=4
      --duration MS   Duration of txd scans and gpio monitor
      --text TEXT     Text the uart scan sends (default: carriage return)
      --json          Machine-readable output on stdout
  -y, --yes           Confirm commands that write the EEPROM
  -h, --help          This help
      --version       Print the version

Examples
  jtagulator-cli -v 3.3 scan jtag --start 0 --end 7
  jtagulator-cli --json ids jtag --tdo 5 --tck 2 --tms 4
  jtagulator-cli --sim run examples/find-everything.js
`;

class UsageError extends Error {}

const OPTIONS = {
  port: { type: "string", short: "p" },
  sim: { type: "boolean" },
  voltage: { type: "string", short: "v" },
  start: { type: "string" },
  end: { type: "string" },
  "pins-low": { type: "boolean" },
  known: { type: "string" },
  duration: { type: "string" },
  hold: { type: "string" },
  text: { type: "string" },
  tdi: { type: "string" },
  tdo: { type: "string" },
  tck: { type: "string" },
  tms: { type: "string" },
  swdio: { type: "string" },
  swclk: { type: "string" },
  json: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
} as const;

type Opts = ReturnType<typeof parse>["values"];
const parse = (argv: string[]) => parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });

function int(v: string | undefined, name: string, dflt?: number): number {
  if (v === undefined) {
    if (dflt === undefined) throw new UsageError(`--${name} is required`);
    return dflt;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`--${name} must be a whole number, got "${v}"`);
  return n;
}
const channel = (v: string | undefined, name: string, dflt?: number) => {
  const n = int(v, name, dflt);
  if (n > 23) throw new UsageError(`--${name} must be a channel from 0 to 23`);
  return n;
};
const knownPins = (s: string | undefined) =>
  Object.fromEntries(
    (s ?? "")
      .split(",")
      .filter(Boolean)
      .map((kv) => {
        const [k, v] = kv.split("=");
        if (!k || v === undefined) throw new UsageError(`--known takes key=channel pairs, e.g. tck=2,tms=4`);
        return [k.trim().toLowerCase(), channel(v.trim(), `known ${k}`)];
      }),
  );

/** Folder with the bundled firmware images (next to the bundle, or in the source tree). */
function assetDir(io: Io): string {
  if (io.assets) return io.assets;
  for (const rel of ["./firmware/", "../src/lib/firmware/assets/"]) {
    const dir = new URL(rel, import.meta.url);
    if (fs.existsSync(new URL("jtagulator.binary", dir))) return dir.pathname;
  }
  throw new Error("Bundled firmware images not found");
}
const asset = (io: Io, name: string) => new Uint8Array(fs.readFileSync(assetDir(io) + name));

async function defaultPort(): Promise<string> {
  const { listPorts } = await import("./serial");
  const ports = await listPorts();
  const p = ports.find((x) => x.likely);
  if (!p) throw new UsageError(`No JTAGulator found. Plug it in, or pick a port with --port (ports: ${ports.map((x) => x.path).join(", ") || "none"})`);
  return p.path;
}

async function openTransport(o: Opts, io: Io): Promise<Transport> {
  if (io.transport) return io.transport();
  if (o.sim) {
    const sim = new SimTransport(DEFAULT_TARGET);
    sim.fw.scanSeconds = 0.2;
    const { installSimSump } = await import("../src/lib/logic/sim-sump");
    installSimSump(sim.fw);
    return sim;
  }
  const { NodeSerialTransport } = await import("./serial");
  return new NodeSerialTransport(o.port ?? (await defaultPort()));
}

/** Scan progress on stderr (terminals only); errors arrive as exceptions. */
function scanContext(o: Opts, io: Io, signal: AbortSignal): OpContext {
  let last = "";
  return {
    signal,
    onEvent: (e) => {
      if (e.type === "message" && e.level === "warn" && !o.json) io.err(`${io.tty ? "\r\x1b[K" : ""}warning: ${e.text}\n`);
      else if (e.type === "progress" && io.tty && !o.json && e.fraction !== null) {
        const line = `\r\x1b[Kscanning… ${Math.round(e.fraction * 100)}%`;
        if (line !== last) io.err((last = line));
      }
    },
  };
}

const plain = (f: Finding) => describeFinding(f).replace(/\*\*/g, "").replace(/`/g, "").replace(/^- /, "");

function printScan(r: ScanResult, o: Opts, io: Io) {
  if (o.json) return io.out(JSON.stringify({ findings: r.findings, permutations: r.permutations, aborted: r.aborted, messages: r.messages }) + "\n");
  if (!r.findings.length) io.out(r.aborted ? "Stopped. Nothing found.\n" : "Nothing found.\n");
  for (const f of r.findings) io.out(plain(f) + "\n");
  if (r.aborted && r.findings.length) io.out("(stopped early)\n");
}

export async function main(argv: string[], io: Io): Promise<number> {
  let o: Opts;
  let pos: string[];
  try {
    const p = parse(argv);
    o = p.values;
    pos = p.positionals;
  } catch (e) {
    io.err(`${(e as Error).message}\nRun jtagulator-cli --help for usage.\n`);
    return 2;
  }
  if (o.version) return io.out(`${CLI_VERSION}\n`), 0;
  const [cmd, sub, arg] = pos;
  if (o.help || !cmd) return io.out(HELP), cmd || o.help ? 0 : 2;

  const ctl = new AbortController();
  io.signal?.addEventListener("abort", () => ctl.abort());
  const emit = (human: string, json: unknown) => io.out(o.json ? JSON.stringify(json) + "\n" : human + "\n");

  try {
    if (cmd === "ports") {
      const { listPorts } = await import("./serial");
      const ports = await listPorts();
      emit(ports.map((p) => `${p.likely ? "*" : " "} ${p.label}`).join("\n") || "No serial ports.", ports);
      return 0;
    }
    if (cmd === "firmware") return await firmware(sub, arg, o, io, emit);

    const t = await openTransport(o, io);
    const session = new Session(t);
    await session.connect();
    const dev = new JTAGulator(session);
    try {
      // Opening the port resets the Propeller. Its boot takes 0.5-2 s, so wait for the
      // welcome banner (no banner: the board didn't reset, or is in a special mode).
      const boot = () => (t.kind === "sim" ? new Promise((r) => setTimeout(r, 50)) : session.expect(/Welcome to JTAGulator[\s\S]*> $/, { timeout: 3000 }).catch(() => {}));
      await boot();
      let mode = await dev.sync();
      // No answer: the board may be running something else from RAM. Reset it once.
      if (mode === "unknown" && t.reset) {
        await t.reset();
        await boot();
        mode = await dev.sync();
      }
      if (cmd === "exit-mode") {
        if (mode === "sump" || mode === "ocd") await dev.exitSpecialMode();
        emit(mode === "normal" ? "Already in the normal menu." : `Left ${mode === "sump" ? "logic analyzer" : "OpenOCD"} mode.`, { previous: mode, mode: dev.mode });
        return 0;
      }
      if (mode === "sump" || mode === "ocd")
        throw new UsageError(`The JTAGulator is in ${mode === "sump" ? "logic analyzer" : "OpenOCD"} mode. Run "jtagulator-cli exit-mode" first.`);
      if (mode !== "normal") throw new Error("No response from the JTAGulator. Check the port and cable.");
      const ctx = scanContext(o, io, ctl.signal);
      const call = (name: CallName, ...args: unknown[]) => (CALLS[name].run as (...a: unknown[]) => Promise<unknown>)(dev, ctx, ...args);
      if (o.voltage !== undefined) await dev.setTargetVoltage(o.voltage === "off" ? 0 : Number(o.voltage), ctx);

      switch (cmd) {
        case "info": {
          const info = await dev.info(ctx);
          const v = await dev.getVoltage(ctx);
          emit(`${info.firmware}\nTarget voltage: ${v === null ? "off" : `${v} V`}`, { ...info, voltage: v });
          return 0;
        }
        case "voltage": {
          if (sub !== undefined) await dev.setTargetVoltage(sub === "off" ? 0 : Number(sub), ctx);
          const v = await dev.getVoltage(ctx);
          emit(v === null ? "Target voltage: off" : `Target voltage: ${v} V`, { voltage: v });
          return 0;
        }
        case "scan": {
          const range = { start: channel(o.start, "start", 0), end: channel(o.end, "end", 7) };
          if (range.end <= range.start) throw new UsageError("--end must be above --start");
          const pinsLow = o["pins-low"] ? { lowMs: 100, highMs: 100 } : undefined;
          const known = knownPins(o.known);
          const duration = o.duration ? int(o.duration, "duration") : undefined;
          const scans: Record<string, () => Promise<unknown>> = {
            jtag: () => call("jtag.scan", { ...range, pinsLow }),
            idcode: () => call("jtag.idcodeScan", { ...range, pinsLow }),
            bypass: () => call("jtag.bypassScan", { ...range, pinsLow, known }),
            rtck: () => call("jtag.rtckScan", { ...range, tck: channel(o.tck ?? String(known.tck ?? ""), "tck") }),
            swd: () => call("swd.scan", { ...range }),
            uart: () => call("uart.scan", { ...range, known, text: o.text, printableOnly: true }),
            txd: () => call("uart.txdScan", { ...range, durationMs: duration }),
          };
          if (!sub || !scans[sub]) throw new UsageError(`scan needs one of: ${Object.keys(scans).join(", ")}`);
          if ((await dev.getVoltage(ctx)) === null) throw new UsageError("Set the target voltage first, e.g. -v 3.3 (match the target's I/O level).");
          printScan((await scans[sub]()) as ScanResult, o, io);
          if (io.tty && !o.json) io.err("\r\x1b[K");
          return 0;
        }
        case "ids": {
          if (sub === "swd") {
            const r = (await call("swd.deviceId", { swdio: channel(o.swdio, "swdio"), swclk: channel(o.swclk, "swclk") })) as Finding | null;
            emit(r ? plain(r) : "No SWD reply.", r);
            return r ? 0 : 1;
          }
          if (sub !== "jtag") throw new UsageError("ids needs jtag or swd");
          const r = (await call("jtag.deviceIds", { tdo: channel(o.tdo, "tdo"), tck: channel(o.tck, "tck"), tms: channel(o.tms, "tms") })) as Finding & { kind: "jtag" };
          emit(r.devices.length ? plain(r).split("\n").slice(1).map((l) => l.trim().replace(/^- /, "")).join("\n") : "No devices.", r);
          return r.devices.length ? 0 : 1;
        }
        case "bypass": {
          const r = (await call("jtag.testBypass", { tdi: channel(o.tdi, "tdi"), tdo: channel(o.tdo, "tdo"), tck: channel(o.tck, "tck"), tms: channel(o.tms, "tms") })) as {
            devices: number;
            patternIn: string | null;
            patternOut: string | null;
            match: boolean;
            transcript: string;
          };
          const { transcript: _t, ...rest } = r;
          emit(`${r.match ? "Match" : "No match"}: sent ${r.patternIn ?? "?"}, received ${r.patternOut ?? "?"} (${r.devices} device${r.devices === 1 ? "" : "s"} in the chain)`, rest);
          return r.match ? 0 : 1;
        }
        case "gpio": {
          if (sub === "read") {
            const r = (await call("gpio.read")) as { value: number; bits: boolean[] };
            emit(`0x${r.value.toString(16).toUpperCase().padStart(6, "0")}  ${r.bits.map((b, i) => (b ? `CH${i}` : "")).filter(Boolean).join(" ") || "(all low)"}`, r);
            return 0;
          }
          if (sub === "monitor") {
            const r = (await call("gpio.monitor", { durationMs: o.duration ? int(o.duration, "duration") : 2000 })) as { value: number }[];
            emit(r.map((s) => `0x${s.value.toString(16).toUpperCase().padStart(6, "0")}`).join("\n"), r);
            return 0;
          }
          if (sub === "write") {
            if (arg === undefined) throw new UsageError("gpio write needs a 24-bit value, e.g. 0x000001");
            const value = Number(arg);
            if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new UsageError("The value must be 0 to 0xFFFFFF");
            await call("gpio.pulse", value, { holdMs: o.hold ? int(o.hold, "hold") : 500 });
            emit(`Drove 0x${value.toString(16).toUpperCase().padStart(6, "0")}, then released.`, { value });
            return 0;
          }
          throw new UsageError("gpio needs read, monitor or write");
        }
        case "run": {
          if (!sub) throw new UsageError("run needs a script file");
          return await runScriptFile(sub, dev, o, io, ctl.signal, ctx);
        }
        default:
          throw new UsageError(`Unknown command "${cmd}". Run jtagulator-cli --help.`);
      }
    } finally {
      await session.disconnect().catch(() => {});
    }
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (/voltage must be defined/i.test(msg)) msg += " Add -v VOLTS (e.g. -v 3.3) to this command: each run restarts the JTAGulator, which clears the voltage.";
    if (o.json) io.out(JSON.stringify({ error: msg }) + "\n");
    else io.err(`${io.tty ? "\r\x1b[K" : ""}Error: ${msg}\n`);
    return e instanceof UsageError ? 2 : 1;
  }
}

async function runScriptFile(file: string, dev: JTAGulator, o: Opts, io: Io, signal: AbortSignal, ctx: OpContext): Promise<number> {
  const code = fs.readFileSync(file, "utf8");
  const handles = new HandleTable();
  const fmt = (v: unknown) => (typeof v === "string" ? v : v instanceof Uint8Array ? `bytes[${[...v].map((b) => b.toString(16).padStart(2, "0")).join(" ")}]` : JSON.stringify(v, null, 2));
  const log = (...a: unknown[]) => (o.json ? io.err : io.out)(a.map(fmt).join(" ") + "\n");
  const ns: Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> = {};
  for (const full of [...Object.keys(CALLS), ...HOST_CALLS]) {
    const [n, fn] = full.split(".");
    (ns[n] ??= {})[fn] = (...args: unknown[]) =>
      serveScriptCall(full, args, { dev, handles, signal, call: (name, a) => (CALLS[name].run as (...x: unknown[]) => Promise<unknown>)(dev, ctx, ...a) });
  }
  const globals: Record<string, unknown> = {
    ...ns,
    console: { log, info: log, warn: log, error: log },
    log,
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    bytes: (v: number[] | string) => (typeof v === "string" ? Uint8Array.from(v, (c) => c.charCodeAt(0)) : Uint8Array.from(v)),
    hex: (v: number, digits = 8) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(digits, "0"),
  };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<unknown>;
  try {
    const value = await new AsyncFunction(...Object.keys(globals), code)(...Object.values(globals));
    if (o.json) io.out(JSON.stringify({ result: value ?? null }) + "\n");
    else if (value !== undefined) io.out(fmt(value) + "\n");
    return 0;
  } finally {
    await handles.closeAll();
  }
}

async function firmware(sub: string | undefined, file: string | undefined, o: Opts, io: Io, emit: (h: string, j: unknown) => void): Promise<number> {
  const subs = ["install", "test", "probe", "db"];
  if (!sub || !subs.includes(sub)) throw new UsageError(`firmware needs one of: ${subs.join(", ")}`);
  if ((sub === "install" || sub === "db") && !o.yes)
    throw new UsageError(sub === "install" ? "This programs the EEPROM. Add --yes to confirm (or use \"firmware test\" to try it from RAM)." : "This rewrites the database half of the EEPROM and takes about 20 minutes. Add --yes to confirm.");
  if (o.sim) throw new UsageError("Firmware commands need a real JTAGulator");
  const t = await openTransport(o, io);
  if (!canLoad(t)) throw new UsageError("This connection can't reset the board (DTR), so it can't load firmware");
  const dt: DtrTransport = t;
  await dt.open();
  const progress = (p: LoadProgress) => {
    if (io.tty && !o.json) io.err(`\r\x1b[K${p.phase}${p.phase === "sending" ? ` ${Math.round(p.fraction * 100)}%` : ""}`);
  };
  try {
    if (sub === "probe") {
      const s = await probeDatabase(dt, progress, asset(io, "eeprom-probe.binary"));
      const modes = ["normal", "logic analyzer", "OpenOCD"];
      emit(
        `${io.tty && !o.json ? "\r\x1b[K" : ""}Manufacturer database: ${s.complete ? "complete" : `incomplete (flag 0x${s.flag.toString(16).toUpperCase()})`}\nSamples: AMD=${s.samples.amd ?? "-"} ARM=${s.samples.arm ?? "-"} ST=${s.samples.st ?? "-"}\nStored mode: ${modes[s.mode] ?? s.mode}`,
        s,
      );
      return 0;
    }
    if (sub === "db") {
      const r = await writeDatabase(dt, (p) => io.tty && !o.json && io.err(`\r\x1b[K${p.phase} ${p.percent}%`), undefined, asset(io, "eeprom-update.binary"));
      emit(`${io.tty ? "\r\x1b[K" : ""}Database: ${r.result}`, { result: r.result });
      return r.result === "errors" ? 1 : 0;
    }
    const image = file ? new Uint8Array(fs.readFileSync(file)) : asset(io, "jtagulator.binary");
    await installFirmware(dt, image, sub === "install" ? "eeprom" : "ram", progress);
    emit(
      `${io.tty && !o.json ? "\r\x1b[K" : ""}${sub === "install" ? "Programmed the EEPROM" : "Loaded into RAM (until the next reset)"}: ${file ?? `ID Tracker ${BUNDLED_VERSION}`}, ${image.length} bytes.`,
      { mode: sub === "install" ? "eeprom" : "ram", bytes: image.length, file: file ?? null },
    );
    return 0;
  } finally {
    if (sub === "install") await resetBoard(dt).catch(() => {});
    await dt.close().catch(() => {});
  }
}
