// App side of script execution: spawns the worker and serves its device calls.
import { PROMPT } from "../core/jtagulator";
import { app } from "../stores/app.svelte";
import { CALLS, HandleTable, type CallName } from "./api";
import type { FromWorker, ToWorker } from "./protocol";

export interface ScriptLog {
  at: number;
  level: "log" | "info" | "warn" | "error" | "call" | "done";
  text: string;
}

export interface ScriptRun {
  done: Promise<void>;
  stop: () => void;
}

type Wire = { source: string; flags: string; __re?: boolean };
const toRegExp = (p: unknown): RegExp => {
  if (typeof p === "string") return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const w = p as Wire;
  return new RegExp(w.source, w.flags.replace("g", ""));
};

export function runScript(code: string, onLog: (l: ScriptLog) => void): ScriptRun {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const ctl = new AbortController();
  const handles = new HandleTable();
  const log = (level: ScriptLog["level"], text: string) => onLog({ at: Date.now(), level, text });
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  let ended = false;

  const end = async (level: "done" | "error", text: string) => {
    if (ended) return;
    ended = true;
    ctl.abort();
    worker.terminate();
    await handles.closeAll();
    log(level, text);
    finish();
  };

  async function serve(name: string, args: unknown[]): Promise<unknown> {
    const dev = app.dev;
    if (name === "target.get") return JSON.parse(JSON.stringify(app.target));
    if (!dev) throw new Error("Not connected to a JTAGulator");
    switch (name) {
      case "uart.passthrough": {
        const h = await dev.uartPassthrough(args[0] as never, { signal: ctl.signal });
        return handles.addPassthrough(h);
      }
      case "uart.send": {
        const p = handles.passthrough.get(args[0] as number);
        if (!p) throw new Error("Unknown passthrough handle");
        await p.h.write(args[1] as string | Uint8Array);
        return;
      }
      case "uart.read": {
        const p = handles.passthrough.get(args[0] as number);
        if (!p) throw new Error("Unknown passthrough handle");
        const out = p.buf;
        p.buf = "";
        return out;
      }
      case "uart.expect": {
        const p = handles.passthrough.get(args[0] as number);
        if (!p) throw new Error("Unknown passthrough handle");
        const re = toRegExp(args[1]);
        const timeout = (args[2] as number | undefined) ?? 5000;
        const t0 = Date.now();
        for (;;) {
          const m = re.exec(p.buf);
          if (m) {
            const before = p.buf.slice(0, m.index);
            p.buf = p.buf.slice(m.index + m[0].length);
            return { match: m[0], groups: [...m].slice(1), before };
          }
          const left = timeout - (Date.now() - t0);
          if (left <= 0) throw new Error(`uart.expect timed out waiting for ${re}`);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, left);
            p.waiters.push(() => (clearTimeout(timer), resolve()));
          });
          if (ctl.signal.aborted) throw new Error("Stopped");
        }
      }
      case "uart.close": {
        await handles.passthrough.get(args[0] as number)?.h.close();
        return;
      }
      case "gpio.drive": {
        const h = await dev.gpioWrite(args[0] as number, {}, { signal: ctl.signal });
        return handles.addOutput(h);
      }
      case "gpio.release": {
        await handles.outputs.get(args[0] as number)?.release();
        return;
      }
      case "term.send": {
        dev.invalidateMenu();
        await dev.raw(args[0] as string);
        return;
      }
      case "term.expect": {
        const s = dev.session;
        const r = await s.exclusive(() => s.expect(toRegExp(args[0]), { timeout: (args[1] as number) ?? 5000, signal: ctl.signal }));
        if (PROMPT.test(r.match[0])) dev.invalidateMenu();
        return { match: r.match[0], groups: [...r.match].slice(1), before: r.before };
      }
    }
    if (!(name in CALLS)) throw new Error(`Unknown function ${name}`);
    log("call", name);
    return app.call(name as CallName, args, { source: "script", signal: ctl.signal });
  }

  worker.onmessage = async (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type === "log") log(m.level, m.text);
    else if (m.type === "done") void end("done", m.value !== undefined ? `Finished → ${m.value}` : "Finished");
    else if (m.type === "failed") void end("error", m.stack && !m.stack.includes("blob:") ? m.stack : m.error);
    else if (m.type === "call") {
      let reply: ToWorker;
      try {
        const value = await serve(m.name, m.args);
        reply = { type: "result", id: m.id, value: JSON.parse(JSON.stringify(value ?? null, (_k, v) => (v instanceof Uint8Array ? [...v] : v))) };
      } catch (e) {
        reply = { type: "result", id: m.id, error: e instanceof Error ? e.message : String(e) };
      }
      if (!ended) worker.postMessage(reply);
    }
  };
  worker.onerror = (e) => void end("error", e.message || "Script error");

  worker.postMessage({ type: "run", code, calls: Object.keys(CALLS) } satisfies ToWorker);
  log("info", "Script started");
  return { done, stop: () => void end("error", "Stopped by user") };
}
