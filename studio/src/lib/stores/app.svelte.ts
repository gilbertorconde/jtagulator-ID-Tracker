// Global application state (Svelte 5 runes): connection, device status, the
// running operation, findings about the target, and settings.
import { DeviceError, JTAGulator, type DeviceInfo } from "../core/jtagulator";
import { AbortedError, Session } from "../core/session";
import type { PortInfo, Transport } from "../core/transport";
import { SimTransport } from "../core/transports/sim";
import { isTauri, listTauriPorts, TauriSerialTransport } from "../core/transports/tauri";
import { hasWebSerial, WebSerialTransport } from "../core/transports/webserial";
import type { DeviceMode, Finding, Menu, OpContext, OpEvent } from "../core/types";
import { CALLS, callToCode, type CallName } from "../scripting/api";
import { DEFAULT_TARGET } from "../sim/firmware";
import { untrack } from "svelte";
import { canLoad, type DtrTransport } from "../firmware/loader";

export type View = "overview" | "jtag" | "swd" | "uart" | "gpio" | "logic" | "all" | "scripts" | "findings" | "firmware" | "settings";

export interface RunningOp {
  id: number;
  name: CallName;
  label: string;
  args: unknown[];
  startedAt: number;
  phase: "configuring" | "running" | "done";
  progress: number | null;
  ticks: number;
  permutations: number | null;
  findings: Map<number, Finding>;
  messages: { level: "info" | "warn" | "error"; text: string }[];
  scan: boolean;
  source: "ui" | "script";
  abort: () => void;
}

export interface OpRecord {
  id: number;
  name: CallName;
  label: string;
  args: unknown[];
  startedAt: number;
  durationMs: number;
  status: "ok" | "aborted" | "error";
  error?: string;
  findings: Finding[];
  result: unknown;
  source: "ui" | "script";
}

export interface Toast {
  id: number;
  level: "info" | "ok" | "warn" | "error";
  title: string;
  detail?: string;
}

/** What we know about the board under test, prefilled into forms. */
export interface TargetProfile {
  id: string;
  updatedAt: number;
  name: string;
  notes: string;
  voltage: number | null;
  jtag: { tdi: number | null; tdo: number | null; tck: number | null; tms: number | null; trst: number | null; rtck: number | null };
  swd: { swdio: number | null; swclk: number | null };
  uart: { txd: number | null; rxd: number | null; baud: number | null };
  range: { start: number; end: number };
  /** Every finding, newest first, de-duplicated. */
  findings: { at: number; op: string; finding: Finding }[];
  channelNames: Record<number, string>;
}

export interface Settings {
  theme: "dark" | "light";
  simSpeed: number;
  confirmRisky: boolean;
  terminalOpen: boolean;
  terminalHeight: number;
  lastPort: string | null;
  /** Wiring guides the user collapsed, per page. */
  wiringHidden: Record<string, boolean>;
  /** GitHub repository ("owner/name") checked for firmware releases. */
  firmwareRepo: string;
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const blankTarget = (): TargetProfile => ({
  id: newId(),
  updatedAt: Date.now(),
  name: "Untitled target",
  notes: "",
  voltage: null,
  jtag: { tdi: null, tdo: null, tck: null, tms: null, trst: null, rtck: null },
  swd: { swdio: null, swclk: null },
  uart: { txd: null, rxd: null, baud: null },
  range: { start: 0, end: 7 },
  findings: [],
  channelNames: {},
});

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function loadList(key: string): TargetProfile[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function findingKey(f: Finding): string {
  switch (f.kind) {
    case "jtag":
      return `jtag:${f.tdi}:${f.tdo}:${f.tck}:${f.tms}:${f.devices.map((d) => d.idcode.raw).join(",")}`;
    case "swd":
      return `swd:${f.swdio}:${f.swclk}:${f.dpidr?.raw}`;
    case "uart":
      return `uart:${f.txd}:${f.rxd}:${f.baud}`;
    case "uart-txd":
      return `txd:${f.txd}:${f.bestFit}`;
    case "rtck":
      return `rtck:${f.tck}:${f.rtck}`;
    case "extest":
      return `extest:${f.channel}:${f.bit}`;
    case "irdr":
      return `irdr:${f.ir}:${f.dr}`;
  }
}

let opSeq = 1;
let toastSeq = 1;

class AppState {
  view = $state<View>("overview");
  /** Sidebar drawer on narrow screens. */
  navOpen = $state(false);

  // connection
  status = $state<"disconnected" | "connecting" | "connected">("disconnected");
  transportKind = $state<Transport["kind"] | null>(null);
  portName = $state<string | null>(null);
  ports = $state<PortInfo[]>([]);
  session: Session | null = $state.raw(null);
  dev: JTAGulator | null = $state.raw(null);
  sim: SimTransport | null = $state.raw(null);

  // device
  menu = $state<Menu | null>(null);
  mode = $state<DeviceMode>("unknown");
  voltage = $state<number | null>(null);
  info = $state<DeviceInfo | null>(null);
  busy = $state(false);

  // operations
  op = $state<RunningOp | null>(null);
  history = $state<OpRecord[]>([]);
  toasts = $state<Toast[]>([]);
  dialog = $state<{ title: string; body: string; ok: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);

  // recorder
  recording = $state(false);
  recorded = $state<string[]>([]);

  target = $state<TargetProfile>(load("jts.target", blankTarget()));
  /** Every saved target, including the current one (kept in sync). */
  targets = $state<TargetProfile[]>(loadList("jts.targets"));
  settings = $state<Settings>(
    load("jts.settings", {
      theme: "dark",
      simSpeed: 4,
      confirmRisky: true,
      terminalOpen: false,
      terminalHeight: 260,
      lastPort: null,
      wiringHidden: {},
      firmwareRepo: "gilbertorconde/jtagulator-ID-Tracker",
    } as Settings),
  );

  /** ID Tracker 1.3+ parses all 24 logic analyzer trigger channels. */
  fullTriggers = $derived(!!this.info?.idTracker && parseFloat(this.info.version ?? "0") >= 1.3);

  readonly tauri = isTauri();
  readonly webSerial = hasWebSerial();

  constructor() {
    if (!this.target.id) this.target.id = newId();
    $effect.root(() => {
      $effect(() => {
        const json = JSON.stringify(this.target);
        localStorage.setItem("jts.target", json);
        untrack(() => {
          const copy = JSON.parse(json) as TargetProfile;
          copy.updatedAt = Date.now();
          const i = this.targets.findIndex((t) => t.id === copy.id);
          this.targets = i >= 0 ? this.targets.map((t, k) => (k === i ? copy : t)) : [copy, ...this.targets];
          localStorage.setItem("jts.targets", JSON.stringify(this.targets));
        });
      });
      $effect(() => {
        localStorage.setItem("jts.settings", JSON.stringify(this.settings));
        document.documentElement.dataset.theme = this.settings.theme;
      });
      $effect(() => {
        if (this.sim) this.sim.fw.scanSeconds = this.settings.simSpeed;
      });
    });
  }

  // ------------------------------------------------------------- notifications

  toast(level: Toast["level"], title: string, detail?: string, ms = level === "error" ? 8000 : 4000) {
    const t = { id: toastSeq++, level, title, detail };
    this.toasts = [...this.toasts, t];
    setTimeout(() => this.dismiss(t.id), ms);
  }

  /** Modal yes/no question. */
  ask(title: string, body: string, ok = "OK", danger = false): Promise<boolean> {
    this.dialog?.resolve(false);
    return new Promise((resolve) => {
      this.dialog = {
        title,
        body,
        ok,
        danger,
        resolve: (v) => {
          this.dialog = null;
          resolve(v);
        },
      };
    });
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  error(e: unknown, title = "Operation failed") {
    if (e instanceof AbortedError) return this.toast("info", "Stopped");
    const msg = e instanceof Error ? e.message : String(e);
    this.toast("error", title, msg);
  }

  // ---------------------------------------------------------------- connection

  async refreshPorts() {
    if (!this.tauri) return;
    try {
      this.ports = await listTauriPorts();
    } catch (e) {
      this.error(e, "Could not list serial ports");
    }
  }

  async connect(kind: "sim" | "tauri" | "webserial", path?: string) {
    if (this.status !== "disconnected") await this.disconnect();
    let t: Transport;
    if (kind === "sim") {
      const sim = new SimTransport(DEFAULT_TARGET);
      sim.fw.scanSeconds = this.settings.simSpeed;
      // Logic analyzer simulation is optional; load it lazily when present.
      try {
        const mod = await import("../logic/sim-sump");
        mod.installSimSump(sim.fw);
      } catch {
        /* not available */
      }
      this.sim = sim;
      t = sim;
    } else if (kind === "tauri") {
      if (!path) throw new Error("Pick a serial port");
      t = new TauriSerialTransport(path);
      this.settings.lastPort = path;
    } else {
      t = new WebSerialTransport();
    }
    this.status = "connecting";
    this.transportKind = kind;
    this.portName = t.name;
    const session = new Session(t);
    const dev = new JTAGulator(session);
    dev.events.addEventListener("menu", (e) => (this.menu = (e as CustomEvent).detail));
    dev.events.addEventListener("mode", (e) => (this.mode = (e as CustomEvent).detail));
    dev.events.addEventListener("voltage", (e) => {
      this.voltage = (e as CustomEvent).detail;
      this.target.voltage = this.voltage;
    });
    session.busyChange.on((b) => (this.busy = b));
    session.closed.on((reason) => {
      if (this.session !== session) return;
      this.cleanup();
      if (reason !== "disconnected" && reason !== "closed") this.toast("warn", "Disconnected", reason);
    });
    try {
      await session.connect();
      this.session = session;
      this.dev = dev;
      // The Propeller resets when the port opens; give it a moment to boot.
      await new Promise((r) => setTimeout(r, kind === "sim" ? 50 : 600));
      const mode = await dev.sync();
      this.status = "connected";
      if (mode === "normal") {
        this.info = await dev.info().catch(() => null);
        await dev.getVoltage().catch(() => null);
        this.toast("ok", "Connected", this.info?.firmware ?? t.name);
      } else if (mode === "sump" || mode === "ocd") {
        this.toast("warn", `JTAGulator is in ${mode === "sump" ? "logic analyzer" : "OpenOCD"} mode`, "Exit the mode to use the menus.");
        if (mode === "sump") this.view = "logic";
      } else {
        this.toast("warn", "No response from JTAGulator", "Check the port, then try Reset.");
      }
    } catch (e) {
      this.cleanup();
      await t.close().catch(() => {});
      this.error(e, "Connection failed");
    }
  }

  private cleanup() {
    this.op?.abort();
    this.status = "disconnected";
    this.session = null;
    this.dev = null;
    this.sim = null;
    this.menu = null;
    this.mode = "unknown";
    this.voltage = null;
    this.info = null;
    this.busy = false;
    this.transportKind = null;
    this.portName = null;
  }

  async disconnect() {
    const s = this.session;
    this.op?.abort();
    this.cleanup();
    await s?.disconnect().catch(() => {});
  }

  /** Pulse DTR (Propeller reset) and resync. */
  async resetDevice() {
    const s = this.session;
    const d = this.dev;
    if (!s || !d) return;
    this.op?.abort();
    await s.transport.reset?.();
    d.invalidateMenu();
    await new Promise((r) => setTimeout(r, this.transportKind === "sim" ? 50 : 600));
    const mode = await d.sync().catch((e) => (this.error(e), "unknown"));
    if (mode === "normal") {
      this.info = await d.info().catch(() => null);
      await d.getVoltage().catch(() => null);
    }
    this.toast("info", "Device reset", `Mode: ${mode}`);
  }

  // ---------------------------------------------------------------- operations

  /**
   * Run a device operation from the registry. Tracks progress, collects
   * findings into the target profile, records into macros, logs history.
   */
  async call<N extends CallName>(name: N, args: unknown[], opts: { source?: "ui" | "script"; signal?: AbortSignal; onEvent?: (e: OpEvent) => void } = {}): Promise<unknown> {
    const dev = this.dev;
    if (!dev) throw new DeviceError("Not connected");
    const spec = CALLS[name];
    const ctl = new AbortController();
    opts.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
    const source = opts.source ?? "ui";
    if (this.recording && source === "ui") this.recorded = [...this.recorded, callToCode(name, args)];

    const op: RunningOp = {
      id: opSeq++,
      name,
      label: spec.label,
      args,
      startedAt: Date.now(),
      phase: "configuring",
      progress: null,
      ticks: 0,
      permutations: null,
      findings: new Map(),
      messages: [],
      scan: "scan" in spec && !!spec.scan,
      source,
      abort: () => ctl.abort(),
    };
    const prev = this.op;
    this.op = op;
    const live = () => this.op?.id === op.id && this.op;

    const ctx: OpContext = {
      signal: ctl.signal,
      onEvent: (e) => {
        opts.onEvent?.(e);
        const o = live();
        if (!o) return;
        if (e.type === "phase") o.phase = e.phase;
        else if (e.type === "progress") {
          o.ticks = e.ticks;
          o.progress = e.fraction;
        } else if (e.type === "permutations") o.permutations = e.count;
        else if (e.type === "result") {
          o.findings = new Map(o.findings).set(e.id, e.finding);
        } else if (e.type === "message") o.messages = [...o.messages, { level: e.level, text: e.text }];
      },
    };

    const rec: OpRecord = {
      id: op.id,
      name,
      label: spec.label,
      args,
      startedAt: op.startedAt,
      durationMs: 0,
      status: "ok",
      findings: [],
      result: undefined,
      source,
    };
    try {
      const result = await (spec.run as (d: JTAGulator, c: OpContext, ...a: unknown[]) => Promise<unknown>)(dev, ctx, ...args);
      rec.result = result;
      const findings = extractFindings(result);
      rec.findings = findings;
      if (result && typeof result === "object" && "aborted" in result && (result as { aborted: boolean }).aborted) rec.status = "aborted";
      this.absorb(name, findings, args);
      return result;
    } catch (e) {
      rec.status = e instanceof AbortedError ? "aborted" : "error";
      rec.error = e instanceof Error ? e.message : String(e);
      rec.findings = [...op.findings.values()];
      this.absorb(name, rec.findings, args);
      throw e;
    } finally {
      rec.durationMs = Date.now() - op.startedAt;
      this.history = [rec, ...this.history].slice(0, 200);
      if (this.op?.id === op.id) this.op = prev && prev !== op ? prev : null;
    }
  }

  /** Run from the UI: errors become toasts instead of exceptions. */
  async run<N extends CallName>(name: N, ...args: unknown[]): Promise<unknown> {
    const spec = CALLS[name] as { risky?: string; label: string };
    if (spec.risky && this.settings.confirmRisky && !(await this.ask(spec.label, spec.risky, "Continue"))) return undefined;
    try {
      return await this.call(name, args);
    } catch (e) {
      this.error(e, CALLS[name].label);
      return undefined;
    }
  }

  stop() {
    this.op?.abort();
  }

  /** Fold new findings into the target profile and remember pins for next time. */
  private absorb(op: string, findings: Finding[], args: unknown[]) {
    if (!findings.length) return;
    const t = this.target;
    const seen = new Set(t.findings.map((f) => findingKey(f.finding)));
    const fresh = findings.filter((f) => !seen.has(findingKey(f))).map((finding) => ({ at: Date.now(), op, finding }));
    t.findings = [...fresh, ...t.findings].slice(0, 500);
    for (const f of findings) {
      if (f.kind === "jtag" && f.tdo >= 0) {
        if (f.tdi !== null) t.jtag.tdi = f.tdi;
        t.jtag.tdo = f.tdo;
        t.jtag.tck = f.tck;
        t.jtag.tms = f.tms;
        if (f.trst.length) t.jtag.trst = f.trst[0];
      } else if (f.kind === "rtck") {
        t.jtag.tck = f.tck;
        t.jtag.rtck = f.rtck;
      } else if (f.kind === "swd" && f.swdio >= 0) {
        t.swd.swdio = f.swdio;
        t.swd.swclk = f.swclk;
      } else if (f.kind === "uart") {
        t.uart.txd = f.txd;
        t.uart.rxd = f.rxd;
        t.uart.baud = f.baud;
      } else if (f.kind === "uart-txd") {
        t.uart.txd = f.txd;
        if (f.bestFit) t.uart.baud = f.bestFit;
      }
    }
    const a = args[0] as { start?: number; end?: number } | undefined;
    if (a && typeof a.start === "number" && typeof a.end === "number") t.range = { start: a.start, end: a.end };
  }

  newTarget() {
    this.target = blankTarget();
  }

  switchTarget(id: string) {
    const t = this.targets.find((x) => x.id === id);
    if (t) this.target = structuredClone($state.snapshot(t));
  }

  /** Remove a saved target. Deleting the current one switches to another (or a blank one). */
  deleteTarget(id: string) {
    this.targets = this.targets.filter((t) => t.id !== id);
    localStorage.setItem("jts.targets", JSON.stringify(this.targets));
    if (this.target.id === id) {
      const next = this.targets[0];
      this.target = next ? structuredClone($state.snapshot(next)) : blankTarget();
    }
  }

  /** Add or replace a target from an imported file, then switch to it. */
  importTarget(t: TargetProfile) {
    const known = this.targets.some((x) => x.id === t.id);
    this.target = { ...blankTarget(), ...t, id: t.id && !known ? t.id : newId() };
  }

  // ------------------------------------------------------------------ firmware

  /** Label of the running firmware task (loader in use), or null. */
  firmwareBusy = $state<string | null>(null);

  /** True when the connected port can load firmware (needs DTR control). */
  get canFlash() {
    return this.status === "connected" && !!this.session && canLoad(this.session.transport);
  }

  /**
   * Run a firmware task with exclusive use of the serial port, then let the
   * board boot and re-sync with it.
   */
  async firmwareTask<T>(label: string, fn: (t: DtrTransport) => Promise<T>): Promise<T> {
    const s = this.session;
    const d = this.dev;
    if (!s || !d || !canLoad(s.transport)) throw new Error("Connect a JTAGulator over USB first (the simulator can't be flashed)");
    if (this.firmwareBusy) throw new Error(`${this.firmwareBusy} is already running`);
    const release = await s.acquire();
    this.firmwareBusy = label;
    try {
      return await fn(s.transport);
    } finally {
      s.flush();
      d.invalidateMenu();
      release();
      this.firmwareBusy = null;
      // The board resets after a load; give it time to boot from EEPROM or RAM.
      await new Promise((r) => setTimeout(r, 1800));
      const mode = await d.sync().catch(() => "unknown");
      this.info = mode === "normal" ? await d.info().catch(() => null) : null;
      if (mode === "normal") await d.getVoltage().catch(() => null);
    }
  }

  // ------------------------------------------------------------------ recorder

  startRecording() {
    this.recorded = [];
    this.recording = true;
  }

  stopRecording(): string {
    this.recording = false;
    const body = this.recorded.join("\n");
    return `// Recorded ${new Date().toLocaleString()}\n${body}\n`;
  }

  /** Recorder hook for actions that aren't registry calls (terminal, passthrough). */
  recordLine(code: string) {
    if (this.recording) this.recorded = [...this.recorded, code];
  }
}

function extractFindings(result: unknown): Finding[] {
  if (!result || typeof result !== "object") return [];
  if ("findings" in result && Array.isArray((result as { findings: unknown }).findings)) return (result as { findings: Finding[] }).findings;
  if ("kind" in result) return [result as Finding];
  return [];
}

export const app = new AppState();
