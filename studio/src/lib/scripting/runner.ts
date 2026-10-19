// App side of script execution: spawns the worker and serves its device calls.
import { app } from "../stores/app.svelte";
import { CALLS, HandleTable } from "./api";
import { serveScriptCall } from "./host";
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

  const serve = (name: string, args: unknown[]) =>
    serveScriptCall(name, args, {
      dev: app.dev,
      handles,
      signal: ctl.signal,
      target: () => JSON.parse(JSON.stringify(app.target)),
      call: (n, a) => {
        log("call", n);
        return app.call(n, a, { source: "script", signal: ctl.signal });
      },
    });

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
