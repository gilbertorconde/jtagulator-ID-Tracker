/// <reference lib="webworker" />
// Runs a user script. Device access only goes through postMessage to the app,
// so a script can't touch the UI, files, or the serial port directly.
import type { FromWorker, ToWorker } from "./protocol";

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);
let seq = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function call(name: string, args: unknown[]): Promise<unknown> {
  const id = seq++;
  const wire = args.map((a) => (a instanceof RegExp ? { source: a.source, flags: a.flags, __re: true } : a));
  post({ type: "call", id, name, args: wire });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return `bytes[${[...v].map((b) => b.toString(16).padStart(2, "0")).join(" ")}]`;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "number" && Number.isInteger(x) && x > 0xffff ? x : x), 2);
  } catch {
    return String(v);
  }
}

function buildGlobals(calls: string[]) {
  const ns: Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> = {};
  const add = (full: string) => {
    const [n, fn] = full.split(".");
    (ns[n] ??= {})[fn] = (...a: unknown[]) => call(full, a);
  };
  calls.forEach(add);
  // Session-style helpers handled by the app side.
  ["uart.passthrough", "uart.send", "uart.expect", "uart.read", "uart.close", "gpio.drive", "gpio.release", "term.send", "term.expect", "target.get"].forEach(add);

  const log = (level: "log" | "info" | "warn" | "error") => (...a: unknown[]) => post({ type: "log", level, text: a.map(fmt).join(" ") });
  const console = { log: log("log"), info: log("info"), warn: log("warn"), error: log("error") };
  const helpers = {
    console,
    log: console.log,
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    bytes: (v: number[] | string) => (typeof v === "string" ? Uint8Array.from(v, (c) => c.charCodeAt(0)) : Uint8Array.from(v)),
    hex: (v: number, digits = 8) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(digits, "0"),
  };
  return { ...ns, ...helpers };
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === "result") {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (!p) return;
    if (m.error !== undefined) p.reject(new Error(m.error));
    else p.resolve(m.value);
    return;
  }
  if (m.type !== "run") return;
  const g = buildGlobals(m.calls);
  const names = Object.keys(g);
  // Load the script as a module from a blob URL, so no eval is needed.
  const src = `export default async function (${names.join(", ")}) {\n${m.code}\n}`;
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    const value = await mod.default(...names.map((n) => (g as Record<string, unknown>)[n]));
    post({ type: "done", value: value === undefined ? undefined : fmt(value) });
  } catch (e) {
    const err = e as Error;
    post({ type: "failed", error: err?.message ?? String(e), stack: err?.stack });
  } finally {
    URL.revokeObjectURL(url);
  }
};
