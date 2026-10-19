import { SimFirmware, type SimTarget } from "../../sim/firmware";
import { Emitter, type Transport } from "../transport";

/** Transport backed by the in-process firmware simulator. */
export class SimTransport implements Transport {
  readonly kind = "sim" as const;
  readonly name = "Simulator";
  readonly fw: SimFirmware;
  private data = new Emitter<Uint8Array>();
  private closed = new Emitter<string>();
  private isOpen = false;

  constructor(target?: SimTarget, fw?: SimFirmware) {
    this.fw = fw ?? new SimFirmware(target);
    this.fw.attach((b) => {
      if (!this.isOpen) return;
      // Deliver asynchronously in small chunks, like a USB serial adapter would.
      const copy = b.slice();
      queueMicrotask(() => this.isOpen && this.data.emit(copy));
    });
  }

  async open() {
    this.isOpen = true;
    // Opening the port toggles DTR, which resets the Propeller.
    this.fw.reset();
  }

  async close() {
    this.isOpen = false;
    this.closed.emit("closed");
  }

  async write(data: Uint8Array) {
    if (!this.isOpen) throw new Error("Port is not open");
    this.fw.write(data.slice());
  }

  async reset() {
    this.fw.reset();
  }

  onData(cb: (d: Uint8Array) => void) {
    return this.data.on(cb);
  }

  onClose(cb: (r: string) => void) {
    return this.closed.on(cb);
  }
}
