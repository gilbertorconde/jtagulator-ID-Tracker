// Serves a script's device calls: the CALLS registry plus the session-style
// helpers (UART passthrough, driven outputs, raw terminal). Shared by the app's
// worker runner and the command-line tool.
import { PROMPT, type JTAGulator } from "../core/jtagulator";
import { CALLS, type CallName, type HandleTable } from "./api";

export interface ScriptHostEnv {
  dev: JTAGulator | null;
  handles: HandleTable;
  signal: AbortSignal;
  /** Run a registry call (the app adds activity logging and macro recording). */
  call: (name: CallName, args: unknown[]) => Promise<unknown>;
  /** The current target profile, for target.get(). */
  target?: () => unknown;
}

/** Helper names served here, beyond the CALLS registry. */
export const HOST_CALLS = ["uart.passthrough", "uart.send", "uart.expect", "uart.read", "uart.close", "gpio.drive", "gpio.release", "term.send", "term.expect", "target.get"];

type Wire = { source: string; flags: string; __re?: boolean };
/** A RegExp, its wire form from a worker, or a literal string to find. */
export const toRegExp = (p: unknown): RegExp => {
  if (p instanceof RegExp) return new RegExp(p.source, p.flags.replace("g", ""));
  if (typeof p === "string") return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const w = p as Wire;
  return new RegExp(w.source, w.flags.replace("g", ""));
};

export async function serveScriptCall(name: string, args: unknown[], env: ScriptHostEnv): Promise<unknown> {
  const { dev, handles, signal } = env;
  if (name === "target.get") {
    if (!env.target) throw new Error("No target profile here");
    return env.target();
  }
  if (!dev) throw new Error("Not connected to a JTAGulator");
  switch (name) {
    case "uart.passthrough": {
      const h = await dev.uartPassthrough(args[0] as never, { signal });
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
        if (signal.aborted) throw new Error("Stopped");
      }
    }
    case "uart.close": {
      await handles.passthrough.get(args[0] as number)?.h.close();
      return;
    }
    case "gpio.drive": {
      const h = await dev.gpioWrite(args[0] as number, {}, { signal });
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
      const r = await s.exclusive(() => s.expect(toRegExp(args[0]), { timeout: (args[1] as number) ?? 5000, signal }));
      if (PROMPT.test(r.match[0])) dev.invalidateMenu();
      return { match: r.match[0], groups: [...r.match].slice(1), before: r.before };
    }
  }
  if (!(name in CALLS)) throw new Error(`Unknown function ${name}`);
  return env.call(name as CallName, args);
}
