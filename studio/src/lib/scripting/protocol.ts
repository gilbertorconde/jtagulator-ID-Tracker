// Messages between the script worker and the app.
export type ToWorker =
  | { type: "run"; code: string; calls: string[] }
  | { type: "result"; id: number; value?: unknown; error?: string };

export type FromWorker =
  | { type: "call"; id: number; name: string; args: unknown[] }
  | { type: "log"; level: "log" | "info" | "warn" | "error"; text: string }
  | { type: "done"; value?: string }
  | { type: "failed"; error: string; stack?: string };

/** RegExps don't survive postMessage; scripts' patterns are sent like this. */
export interface WirePattern {
  source: string;
  flags: string;
}
