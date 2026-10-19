import { Emitter, type Transport } from "../transport";

// Minimal Web Serial typings (Chromium only).
interface WSPort {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  setSignals(s: { dataTerminalReady?: boolean }): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

export const hasWebSerial = () => typeof navigator !== "undefined" && "serial" in navigator;

/** Browser fallback (Chrome/Edge) for running the UI without the desktop shell. */
export class WebSerialTransport implements Transport {
  readonly kind = "webserial" as const;
  readonly name = "Web Serial";
  private data = new Emitter<Uint8Array>();
  private closed = new Emitter<string>();
  private port: WSPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  async open() {
    const serial = (navigator as unknown as { serial: { requestPort(o?: unknown): Promise<WSPort> } }).serial;
    this.port = await serial.requestPort({ filters: [] });
    await this.port.open({ baudRate: 115200 });
    void this.pump();
  }

  private async pump() {
    const p = this.port;
    if (!p?.readable) return;
    this.reader = p.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.data.emit(value);
      }
    } catch (e) {
      this.closed.emit(String(e));
    } finally {
      this.reader?.releaseLock();
    }
  }

  async close() {
    await this.reader?.cancel().catch(() => {});
    await this.port?.close().catch(() => {});
    this.port = null;
    this.closed.emit("closed");
  }

  async write(data: Uint8Array) {
    const w = this.port?.writable?.getWriter();
    if (!w) throw new Error("Port is not open");
    try {
      await w.write(data);
    } finally {
      w.releaseLock();
    }
  }

  async reset() {
    await this.port?.setSignals({ dataTerminalReady: false });
    await new Promise((r) => setTimeout(r, 50));
    await this.port?.setSignals({ dataTerminalReady: true });
  }

  onData(cb: (d: Uint8Array) => void) {
    return this.data.on(cb);
  }

  onClose(cb: (r: string) => void) {
    return this.closed.on(cb);
  }
}
