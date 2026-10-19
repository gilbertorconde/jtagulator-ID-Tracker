import { Channel, invoke } from "@tauri-apps/api/core";
import { Emitter, type PortInfo, type Transport } from "../transport";

type SerialEvent = { event: "data"; data: number[] } | { event: "closed"; data: { reason: string } };

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface RustPort {
  path: string;
  kind: string;
  vid?: number;
  pid?: number;
  serial_number?: string;
  manufacturer?: string;
  product?: string;
}

export async function listTauriPorts(): Promise<PortInfo[]> {
  const ports = await invoke<RustPort[]>("serial_list");
  return ports.map((p) => {
    const ftdi = p.vid === 0x0403 && p.pid === 0x6001;
    const named = /jtagulator/i.test(`${p.product ?? ""} ${p.manufacturer ?? ""}`);
    const desc = [p.manufacturer, p.product].filter(Boolean).join(" ");
    return {
      path: p.path,
      label: desc ? `${p.path} — ${desc}` : p.path,
      likely: named || ftdi,
      vid: p.vid,
      pid: p.pid,
      serial: p.serial_number,
      manufacturer: p.manufacturer,
      product: p.product,
    };
  });
}

/** USB serial port through the Rust backend (serialport crate). */
export class TauriSerialTransport implements Transport {
  readonly kind = "tauri" as const;
  private data = new Emitter<Uint8Array>();
  private closed = new Emitter<string>();
  private id: number | null = null;

  constructor(public readonly path: string, public readonly baud = 115200) {}

  get name() {
    return this.path;
  }

  async open() {
    const ch = new Channel<SerialEvent>();
    ch.onmessage = (m) => {
      if (m.event === "data") this.data.emit(Uint8Array.from(m.data));
      else {
        this.id = null;
        this.closed.emit(m.data.reason);
      }
    };
    this.id = await invoke<number>("serial_open", { path: this.path, baud: this.baud, onEvent: ch });
  }

  async close() {
    if (this.id === null) return;
    const id = this.id;
    this.id = null;
    await invoke("serial_close", { id });
  }

  async write(data: Uint8Array) {
    if (this.id === null) throw new Error("Port is not open");
    await invoke("serial_write", { id: this.id, data: Array.from(data) });
  }

  async setDtr(on: boolean) {
    if (this.id === null) throw new Error("Port is not open");
    await invoke("serial_set_dtr", { id: this.id, on });
  }

  async reset() {
    if (this.id === null) return;
    await invoke("serial_reset", { id: this.id });
  }

  onData(cb: (d: Uint8Array) => void) {
    return this.data.on(cb);
  }

  onClose(cb: (r: string) => void) {
    return this.closed.on(cb);
  }
}
