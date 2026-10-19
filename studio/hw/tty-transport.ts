// Node transport for running the API against a real JTAGulator (Linux/macOS).
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import tty from "node:tty";
import { Emitter, type Transport } from "../src/lib/core/transport";

export class TtyTransport implements Transport {
  readonly kind = "tauri" as const;
  private fd = -1;
  private rs: tty.ReadStream | null = null;
  private data = new Emitter<Uint8Array>();
  private closed = new Emitter<string>();
  private dtr: ChildProcess | null = null;
  constructor(public readonly name: string) {}

  async open() {
    execFileSync("stty", ["-F", this.name, "115200", "raw", "-echo", "-echoe", "-echok", "cs8", "-cstopb", "-parenb", "-ixon", "-crtscts"]);
    this.fd = fs.openSync(this.name, fs.constants.O_RDWR | fs.constants.O_NOCTTY);
    this.rs = new tty.ReadStream(this.fd);
    this.rs.setRawMode?.(true);
    this.rs.on("data", (b: Buffer) => this.data.emit(new Uint8Array(b)));
    this.rs.on("error", (e) => this.closed.emit(String(e)));
  }
  /** DTR through a small Python helper (Node has no ioctl). */
  async setDtr(on: boolean) {
    if (!this.dtr) {
      const py = `
import fcntl, os, struct, sys, termios
fd = os.open(sys.argv[1], os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
bit = struct.pack("I", termios.TIOCM_DTR)
for line in sys.stdin:
    fcntl.ioctl(fd, termios.TIOCMBIS if line.strip() == "1" else termios.TIOCMBIC, bit)
    print("ok", flush=True)
`;
      this.dtr = spawn("python3", ["-c", py, this.name], { stdio: ["pipe", "pipe", "inherit"] });
    }
    const p = this.dtr;
    await new Promise<void>((resolve) => {
      p.stdout!.once("data", () => resolve());
      p.stdin!.write(on ? "1\n" : "0\n");
    });
  }

  async close() {
    this.dtr?.kill();
    this.dtr = null;
    this.rs?.destroy();
    this.rs = null;
    this.fd = -1;
    this.closed.emit("closed");
  }
  async write(d: Uint8Array) {
    // The fd is non-blocking (tty.ReadStream sets it): handle partial writes.
    let off = 0;
    while (off < d.length) {
      try {
        off += fs.writeSync(this.fd, d, off, d.length - off);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
        await new Promise((r) => setTimeout(r, 2));
      }
    }
  }
  onData(cb: (d: Uint8Array) => void) {
    return this.data.on(cb);
  }
  onClose(cb: (r: string) => void) {
    return this.closed.on(cb);
  }
}
