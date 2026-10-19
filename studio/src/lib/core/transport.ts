// A byte pipe to a JTAGulator: the real USB serial port (Tauri / Web Serial)
// or the built-in simulator.

export interface PortInfo {
  path: string;
  label: string;
  /** True when the USB descriptor looks like a JTAGulator (FTDI FT232R). */
  likely: boolean;
  vid?: number;
  pid?: number;
  serial?: string;
  manufacturer?: string;
  product?: string;
}

export interface Transport {
  readonly kind: "tauri" | "webserial" | "sim";
  readonly name: string;
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  /** Pulse DTR to reset the Propeller, if the transport can. */
  reset?(): Promise<void>;
  onData(cb: (data: Uint8Array) => void): () => void;
  onClose(cb: (reason: string) => void): () => void;
}

export class Emitter<T> {
  private subs = new Set<(v: T) => void>();
  on(cb: (v: T) => void) {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }
  emit(v: T) {
    for (const cb of [...this.subs]) cb(v);
  }
}

export const enc = new TextEncoder();

/** Bytes to a string with one char per byte (the firmware speaks 8-bit ASCII). */
export function latin1(data: Uint8Array): string {
  let s = "";
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
  return s;
}

export function bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
