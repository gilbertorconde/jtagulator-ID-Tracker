// External tools (OpenOCD) run by the Rust backend, with streamed output.
import { Channel, invoke } from "@tauri-apps/api/core";

type ProcessEvent = { event: "stdout"; data: string } | { event: "stderr"; data: string } | { event: "exit"; data: { code: number | null } };

export interface ProcessHandle {
  kill(): Promise<void>;
  exited: Promise<number | null>;
}

export function which(program: string): Promise<string | null> {
  return invoke<string | null>("which", { program });
}

export async function spawn(program: string, args: string[], onLine: (line: string, stream: "out" | "err") => void): Promise<ProcessHandle> {
  let resolveExit!: (c: number | null) => void;
  const exited = new Promise<number | null>((r) => (resolveExit = r));
  const ch = new Channel<ProcessEvent>();
  ch.onmessage = (m) => {
    if (m.event === "stdout") onLine(m.data, "out");
    else if (m.event === "stderr") onLine(m.data, "err");
    else resolveExit(m.data.code);
  };
  const id = await invoke<number>("process_spawn", { program, args, onEvent: ch });
  return { kill: () => invoke("process_kill", { id }), exited };
}

/** Split a command line into arguments, honoring double and single quotes. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let any = false;
  for (const c of line) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      any = true;
    } else if (/\s/.test(c)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
    } else cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}
