// Serial transport for the command-line tool, on the `serialport` package.
import tty from "node:tty";
import { SerialPort } from "serialport";
import { Emitter, type PortInfo, type Transport } from "../src/lib/core/transport";

export class NodeSerialTransport implements Transport {
  readonly kind = "node" as const;
  private port: SerialPort | null = null;
  private rs: tty.ReadStream | null = null;
  private data = new Emitter<Uint8Array>();
  private closed = new Emitter<string>();
  constructor(public readonly name: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = new SerialPort({ path: this.name, baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none", autoOpen: false });
      const debug = !!process.env.JTAGULATOR_DEBUG;
      const deliver = (b: Buffer) => {
        if (debug) process.stderr.write(`\x1b[2m${(performance.now() / 1000).toFixed(3)} < ${JSON.stringify(b.toString("latin1"))}\x1b[0m\n`);
        this.data.emit(new Uint8Array(b));
      };
      p.on("close", () => this.closed.emit("closed"));
      p.on("error", (e) => this.closed.emit(String(e)));
      p.open((e) => {
        if (e) return reject(new Error(`Could not open ${this.name}: ${e.message}`));
        this.port = p;
        // serialport's reader (bindings-cpp 13) can hold incoming bytes until the next
        // write, so on Linux/macOS read the descriptor through Node's own TTY stream.
        const fd = (p.port as { fd?: number } | undefined)?.fd;
        if (process.platform !== "win32" && typeof fd === "number") {
          this.rs = new tty.ReadStream(fd);
          this.rs.on("data", deliver);
          this.rs.on("error", (err) => this.port && this.closed.emit(String(err)));
        } else p.on("data", deliver);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    const p = this.port;
    this.port = null;
    // Detach the reader without closing the descriptor; serialport closes it.
    this.rs?.removeAllListeners("data");
    this.rs?.pause();
    this.rs = null;
    if (!p?.isOpen) return Promise.resolve();
    return new Promise((resolve) => p.close(() => resolve()));
  }

  write(d: Uint8Array): Promise<void> {
    if (process.env.JTAGULATOR_DEBUG) process.stderr.write(`\x1b[2m${(performance.now() / 1000).toFixed(3)} > ${JSON.stringify(Buffer.from(d).toString("latin1"))}\x1b[0m\n`);
    const p = this.port;
    if (!p) return Promise.reject(new Error("Port is closed"));
    return new Promise((resolve, reject) => {
      p.write(Buffer.from(d), (e) => (e ? reject(e) : p.drain((e2) => (e2 ? reject(e2) : resolve()))));
    });
  }

  setDtr(on: boolean): Promise<void> {
    const p = this.port;
    if (!p) return Promise.reject(new Error("Port is closed"));
    return new Promise((resolve, reject) => p.set({ dtr: on }, (e) => (e ? reject(e) : resolve())));
  }

  async reset() {
    await this.setDtr(true);
    await new Promise((r) => setTimeout(r, 10));
    await this.setDtr(false);
  }

  onData(cb: (d: Uint8Array) => void) {
    return this.data.on(cb);
  }
  onClose(cb: (r: string) => void) {
    return this.closed.on(cb);
  }
}

/** Serial ports, JTAGulator-looking ones (FTDI FT232R) first. */
export async function listPorts(): Promise<PortInfo[]> {
  const ports = await SerialPort.list();
  return ports
    .map((p) => {
      const vid = p.vendorId ? parseInt(p.vendorId, 16) : undefined;
      const pid = p.productId ? parseInt(p.productId, 16) : undefined;
      const likely = vid === 0x0403 && pid === 0x6001;
      return {
        path: p.path,
        label: [p.path, p.manufacturer, p.serialNumber].filter(Boolean).join(" · "),
        likely,
        vid,
        pid,
        serial: p.serialNumber,
        manufacturer: p.manufacturer,
      };
    })
    .sort((a, b) => Number(b.likely) - Number(a.likely) || a.path.localeCompare(b.path));
}
