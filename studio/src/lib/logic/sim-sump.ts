// Emulation of PropSUMP.spin for the simulator. Command parsing, parameter
// conversion, sample order and the known firmware quirks follow the Spin code;
// the inputs are synthesized waveforms (see SimSump.levels()).
import type { SimFirmware, SumpHandler } from "../sim/firmware";

const CAN = 0x18;
const CLK = 80_000_000;
const MAX_PERIODS = 1364; // PinHound 1.4 packs samples; pre-trigger captures stay at 1024
const MAX_PRE_PERIODS = 1024;
const DEFAULT_CLOCKS_WAIT = 66;
const DISABLE_FLAGS_MASK = 0b0011_1100;
const MAX_RX_DELAY_MS = 100;

const ID = [0x31, 0x41, 0x4c, 0x53]; // "1ALS"
// Byte for byte the DAT block from @METADATA to @END_METADATA inclusive.
const METADATA = [
  0x01, ...Array.from("JTAGulator", (c) => c.charCodeAt(0)), 0x00,
  0x21, 0x00, 0x00, 0x0c, 0x00,
  0x23, 0x00, 0x12, 0x4f, 0x80,
  0x40, 24,
  0x41, 0x02,
  0x00,
];

const LONG_CMDS = new Set([0x80, 0x81, 0x82, 0xc0, 0xc1, 0xc2, 0xc4, 0xc5, 0xc6, 0xc8, 0xc9, 0xca, 0xcc, 0xcd, 0xce]);

/** Messages "printed" on the simulated UART TX line. */
export const SIM_UART_TEXT = "U-Boot SPL 2016.09\r\nDRAM: 64 MiB\r\nTrying to boot from MMC1\r\n";
export const SIM_UART_BAUD = 9600;
/** The UART message repeats with this period (s). */
export const SIM_UART_PERIOD = 0.12;

/** Channel assignment of the synthesized activity. */
export const SIM_SIGNALS = {
  /** 1 kHz square wave. */
  clock: 0,
  /** 2 kHz PWM, 25 % duty. */
  pwm: 1,
  /** 3-bit binary counter (CH2 = LSB) at 10 kHz per step. */
  counter: [2, 3, 4] as const,
  /** Pseudo-random bits, 5 kHz. */
  noise: 6,
  /** SPI-ish burst every 5 ms: CS# low, 4 bytes at 250 kHz, mode 0. */
  spi: { cs: 20, sck: 21, mosi: 22, miso: 23 },
  /** I2C write every 4 ms at 100 kHz: START, 0x50 W, 0x00, 0x42 (all ACKed), STOP. */
  i2c: { scl: 10, sda: 11 },
} as const;

const I2C_PERIOD = 0.004;
const I2C_BIT = 10e-6;
const I2C_LEAD = 20e-6;
/** Bytes on the wire: address 0x50 + W, then two data bytes. */
export const SIM_I2C_BYTES = [0xa0, 0x00, 0x42];

const SPI_PERIOD = 0.005;
const SPI_BIT = 4e-6;
const SPI_LEAD = 10e-6;
const SPI_TX = [0x9f, 0x00, 0x00, 0x00];
const SPI_RX = [0xff, 0xef, 0x40, 0x18];

export interface SimSumpOptions {
  /** Take the real time a capture would (trigger wait + sampling), capped. */
  realtime?: boolean;
  /** Cap (ms) on the emulated capture duration. */
  maxCaptureMs?: number;
  /** How far ahead (s of signal time) to look for a trigger before giving up (it then never fires). */
  triggerHorizon?: number;
  /** Signal time source in seconds (default: wall clock). Lets tests pick the waveform phase. */
  clock?: () => number;
  /** Emulate the pre-1.3 trigger parsing bug (only the first byte of masks/values kept). */
  legacyTriggers?: boolean;
}

function hash(n: number) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export class SimSump implements SumpHandler {
  // Firmware state (VAR block of PropSUMP.spin)
  clocksWait = DEFAULT_CLOCKS_WAIT;
  readPeriods = MAX_PERIODS;
  delayPeriods = MAX_PERIODS;
  /** Counts as requested (resolved at run, like PinHound 1.3). */
  readReq = MAX_PERIODS;
  delayReq = MAX_PERIODS;
  disableFlags = 0b0010_0000;
  /** OLS flag bit 8: run-length encoding (PinHound 1.4). */
  rle = false;
  trigMask = [0, 0, 0, 0];
  trigVal = [0, 0, 0, 0];
  trigStart = [1, 1, 1, 1];

  private cmd: number[] = [];
  private paramDeadline = 0;
  private running: { timer: ReturnType<typeof setTimeout> | null } | null = null;
  private out: ((b: Uint8Array) => void) | null = null;
  /** Signal time origin (keeps float precision at µs resolution). */
  private readonly epoch = Date.now();
  readonly opts: Required<Omit<SimSumpOptions, "clock">> & Pick<SimSumpOptions, "clock">;

  constructor(
    private readonly fw: SimFirmware,
    opts: SimSumpOptions = {},
  ) {
    this.opts = { realtime: true, maxCaptureMs: 3000, triggerHorizon: 1, legacyTriggers: false, ...opts };
  }

  /** True while a long command is still collecting its parameter bytes. */
  get inLongCommand() {
    return this.cmd.length > 0;
  }

  get capturing() {
    return this.running !== null;
  }

  /** PropSUMP Go(): defaults restored; any capture is gone. */
  private triggerArg(v: ArrayLike<number>): number {
    if (this.opts.legacyTriggers) return v[1];
    return (v[1] | (v[2] << 8) | (v[3] << 16) | (v[4] << 24)) & 0xffffff;
  }

  reset() {
    this.stopCapture();
    this.cmd = [];
    this.clocksWait = DEFAULT_CLOCKS_WAIT;
    this.readPeriods = MAX_PERIODS;
    this.delayPeriods = MAX_PERIODS;
    this.readReq = MAX_PERIODS;
    this.delayReq = MAX_PERIODS;
    this.disableFlags = 0b0010_0000;
    this.trigMask = [0, 0, 0, 0];
    this.trigVal = [0, 0, 0, 0];
    this.trigStart = [1, 1, 1, 1];
  }

  /** Ctrl-X: the sampler cog is stopped. */
  cancel() {
    this.stopCapture();
    this.cmd = [];
  }

  private stopCapture() {
    if (this.running?.timer) clearTimeout(this.running.timer);
    this.running = null;
  }

  // ------------------------------------------------------------- waveforms

  /** Seconds of signal time now. */
  now() {
    return this.opts.clock ? this.opts.clock() : (Date.now() - this.epoch) / 1000;
  }

  /** Synthesized level of all 24 channels at signal time t (s). */
  levels(t: number): number {
    const S = SIM_SIGNALS;
    let v = (this.fw.target.gpio ?? 0xffffff) & 0xffffff;
    const set = (ch: number, bit: number | boolean) => {
      v = bit ? v | (1 << ch) : v & ~(1 << ch);
    };
    set(S.clock, (t * 1000) % 1 < 0.5);
    set(S.pwm, (t * 2000) % 1 < 0.25);
    const step = Math.floor(t * 10_000);
    S.counter.forEach((ch, i) => set(ch, (step >> i) & 1));
    set(S.noise, hash(Math.floor(t * 5000)) & 1);

    // UART TX, 8N1, idle high.
    const txd = this.fw.target.uart?.txd;
    if (txd !== undefined) set(txd, this.uartLevel(t));

    // SPI burst.
    const { cs, sck, mosi, miso } = S.spi;
    const ph = t % SPI_PERIOD;
    const bits = SPI_TX.length * 8;
    const inBurst = ph >= SPI_LEAD && ph < SPI_LEAD + bits * SPI_BIT + SPI_BIT;
    set(cs, !inBurst);
    let clk = 0;
    let mo = 1;
    let mi = 1;
    if (inBurst) {
      const k = Math.floor((ph - SPI_LEAD) / SPI_BIT);
      if (k < bits) {
        clk = (ph - SPI_LEAD) % SPI_BIT >= SPI_BIT / 2 ? 1 : 0;
        mo = (SPI_TX[k >> 3] >> (7 - (k & 7))) & 1;
        mi = (SPI_RX[k >> 3] >> (7 - (k & 7))) & 1;
      }
    }
    set(sck, clk);
    set(mosi, mo);
    set(miso, mi);

    const [scl, sda] = this.i2cLevel(t);
    set(S.i2c.scl, scl);
    set(S.i2c.sda, sda);
    return v >>> 0;
  }

  /** [SCL, SDA] of the synthesized I2C transaction at signal time t. */
  private i2cLevel(t: number): [number, number] {
    const T = I2C_BIT;
    const p = (t % I2C_PERIOD) - I2C_LEAD;
    const nbits = SIM_I2C_BYTES.length * 9;
    if (p < 0) return [1, 1];
    if (p < T / 2) return [1, 0]; // START: SDA falls while SCL is high
    const q = p - T / 2;
    if (q < nbits * T) {
      const k = Math.floor(q / T);
      const scl = (q % T) / T >= 0.5 ? 1 : 0;
      const b = k % 9;
      const sda = b < 8 ? (SIM_I2C_BYTES[Math.floor(k / 9)] >> (7 - b)) & 1 : 0; // 9th bit: ACK
      return [scl, sda];
    }
    const r = q - nbits * T;
    if (r < T / 4) return [0, 0];
    if (r < T / 2) return [1, 0];
    return [1, 1]; // STOP: SDA rises while SCL is high
  }

  private uartLevel(t: number): number {
    const bitT = 1 / SIM_UART_BAUD;
    const ph = t % SIM_UART_PERIOD;
    const frame = Math.floor(ph / (bitT * 10));
    if (frame >= SIM_UART_TEXT.length) return 1;
    const bit = Math.floor((ph - frame * bitT * 10) / bitT);
    if (bit === 0) return 0;
    if (bit === 9) return 1;
    return (SIM_UART_TEXT.charCodeAt(frame) >> (bit - 1)) & 1;
  }

  // ------------------------------------------------------------- protocol

  feed(b: number, out: (bytes: Uint8Array) => void) {
    this.out = out;
    const now = Date.now();

    if (this.cmd.length) {
      // GetFourMoreParamBytes: each byte has its own 100 ms RxTime window.
      while (this.cmd.length && this.cmd.length < 5 && now > this.paramDeadline) {
        this.cmd.push(-1);
        this.paramDeadline += MAX_RX_DELAY_MS;
      }
      if (this.cmd.length === 5) this.finishLong();
      if (this.cmd.length) {
        this.cmd.push(b);
        this.paramDeadline = now + MAX_RX_DELAY_MS;
        if (this.cmd.length === 5) this.finishLong();
        return;
      }
    }

    if (this.running) {
      // During a capture only RESET (and CAN, handled by the firmware) are looked at.
      if (b === 0x00) this.stopCapture();
      return;
    }

    switch (b) {
      case 0x00:
        break;
      case 0x01:
        this.run();
        break;
      case 0x02:
        out(new Uint8Array(ID));
        break;
      case 0x04:
        out(new Uint8Array(METADATA));
        break;
      case 0x06:
        out(this.encode([this.levels(this.now())]));
        break;
      default:
        if (LONG_CMDS.has(b)) {
          this.cmd = [b];
          this.paramDeadline = now + MAX_RX_DELAY_MS;
        }
    }
  }

  private finishLong() {
    const v = this.cmd;
    this.cmd = [];
    if (v.slice(1).some((x) => x < 0)) return;
    const stage = (c: number) => (c >> 2) & 3;
    switch (v[0]) {
      case 0x81: {
        const max = this.opts.legacyTriggers ? 1024 : MAX_PERIODS;
        this.readReq = Math.min(max, (((v[2] << 8) | v[1]) + 1) * 4);
        this.delayReq = Math.min(max, (((v[4] << 8) | v[3]) + 1) * 4);
        this.readPeriods = this.readReq;
        this.delayPeriods = this.delayReq;
        if (this.readPeriods > this.delayPeriods) this.readPeriods = this.delayPeriods;
        break;
      }
      case 0x80: {
        const div = (v[3] << 16) | (v[2] << 8) | v[1];
        this.clocksWait = Math.max(DEFAULT_CLOCKS_WAIT, Math.floor(((div + 1) * 4) / 5));
        break;
      }
      case 0x82:
        this.disableFlags = v[1] & DISABLE_FLAGS_MASK;
        this.rle = !this.opts.legacyTriggers && (v[2] & 1) === 1;
        break;
      // Before PinHound 1.3, `larg:=vCmd[n]` (not `|=`) left only the first byte.
      case 0xc0:
      case 0xc4:
      case 0xc8:
      case 0xcc:
        this.trigMask[stage(v[0])] = this.triggerArg(v);
        break;
      case 0xc1:
      case 0xc5:
      case 0xc9:
      case 0xcd:
        this.trigVal[stage(v[0])] = this.triggerArg(v);
        break;
      default:
        this.trigStart[stage(v[0])] = v[4] & 0b1000;
    }
  }

  /** SendSamples(): enabled groups only, group 0 first. */
  private encode(values: ArrayLike<number>): Uint8Array {
    const groups = [0, 1, 2].filter((g) => !(this.disableFlags & (1 << (2 + g))));
    const out = new Uint8Array(values.length * groups.length);
    let o = 0;
    for (let i = 0; i < values.length; i++) for (const g of groups) out[o++] = (values[i] >>> (8 * g)) & 0xff;
    return out;
  }

  /** Run-length encoded capture, as PinHound 1.4's samplerRle + SendAllSamples do it. */
  private runRle(t: number, t0: number, state: { timer: ReturnType<typeof setTimeout> | null }) {
    const groups = [0, 1, 2].filter((g) => !(this.disableFlags & (1 << (2 + g))));
    const rleMax = 2 ** (groups.length * 8 - 1) - 1;
    const entriesMax = Math.min(this.delayReq, MAX_PRE_PERIODS);
    const read = Math.min(this.readReq, entriesMax);
    const period = Math.max(this.clocksWait, 160) / CLK;
    const entries: number[] = [];
    let hold = this.levels(t) & 0xffffff;
    let count = 0;
    // Bounded so a constant signal can't stall the simulator.
    for (let i = 1; entries.length < entriesMax && i < 5_000_000; i++) {
      const v = this.levels(t + i * period) & 0xffffff;
      if (v === hold && count < rleMax) {
        count++;
        continue;
      }
      entries.push(hold);
      if (entries.length < entriesMax && count) entries.push((0x80000000 | count) >>> 0);
      hold = v;
      count = 0;
    }
    const packed = (v: number) => groups.reduce((w, g, n) => w | (((v >>> (8 * g)) & 0xff) << (8 * n)), 0);
    const bytes: number[] = [];
    for (let i = 0; i < read; i++) {
      const e = entries[entries.length - 1 - i] ?? 0;
      const w = e >= 0x80000000 ? (e & rleMax) | (rleMax + 1) : packed(e) & rleMax;
      for (let n = 0; n < groups.length; n++) bytes.push((w >>> (8 * n)) & 0xff);
    }
    void t0;
    state.timer = setTimeout(() => {
      if (this.running !== state) return;
      this.running = null;
      const data = Uint8Array.from(bytes);
      for (let o = 0; o < data.length; o += 512) this.out?.(data.subarray(o, o + 512));
    }, 0);
  }

  /** Time (s) at which (levels & mask) == val first holds at or after t, or null within the horizon. */
  private waitPeq(t: number, mask: number, val: number): number | null {
    if (!mask) return t;
    const step = 1e-6;
    const end = t + this.opts.triggerHorizon;
    for (let x = t; x < end; x += step) if (((this.levels(x) & mask) >>> 0) === ((val & mask) >>> 0)) return x;
    return null;
  }

  private run() {
    const t0 = this.now();
    // PinHound 1.3: read > delay with a stage-1 start trigger keeps samples from
    // before the trigger, sampling no faster than 80 MHz / 88.
    const preRead = Math.min(this.readReq, MAX_PRE_PERIODS);
    if (!this.opts.legacyTriggers && preRead > this.delayReq && this.trigMask[0] && this.trigStart[0]) {
      const pre = preRead - this.delayReq;
      const period = Math.max(this.clocksWait, 88) / CLK;
      const tt = this.waitPeq(t0 + pre * period, this.trigMask[0], this.trigVal[0]);
      const state: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };
      this.running = state;
      if (tt === null) return;
      const send: number[] = [];
      for (let i = preRead - 1; i >= 0; i--) send.push(this.levels(tt + (i - pre) * period));
      state.timer = setTimeout(() => {
        if (this.running !== state) return;
        this.running = null;
        const data = this.encode(send);
        for (let o = 0; o < data.length; o += 512) this.out?.(data.subarray(o, o + 512));
      }, 0);
      return;
    }
    // The sampler's trigger chain: stages 1-3 may hand over to the next; stage 4 always starts.
    let t: number | null = t0;
    for (let s = 0; s < 4 && t !== null; s++) {
      t = this.waitPeq(t, this.trigMask[s], this.trigVal[s]);
      if (s === 3 || this.trigStart[s]) break;
    }
    const state: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };
    this.running = state;
    // Trigger never fires: wait (forever) for RESET / CAN / power cycle.
    if (t === null) return;

    if (this.rle) return this.runRle(t, t0, state);

    const period = this.clocksWait / CLK;
    const buf = new Uint32Array(MAX_PERIODS); // cleared before every run
    for (let i = 0; i < this.delayPeriods; i++) buf[i] = this.levels(t + i * period);
    const send: number[] = [];
    for (let i = 0; i < this.readPeriods; i++) send.push(buf[this.delayPeriods - 1 - i]);

    const ms = this.opts.realtime
      ? Math.min(this.opts.maxCaptureMs, (t - t0 + this.delayPeriods * period) * 1000)
      : 0;
    state.timer = setTimeout(() => {
      if (this.running !== state) return;
      this.running = null;
      const data = this.encode(send);
      // Hand it over in USB-sized chunks.
      for (let o = 0; o < data.length; o += 512) this.out?.(data.subarray(o, o + 512));
    }, ms);
  }
}

/**
 * Install a SimSump on the simulator. Also wraps fw.write / fw.reset so that,
 * as in the real firmware, a 0x18 byte inside a long command's parameters is
 * data (the base simulator would treat it as Ctrl-X), Ctrl-X stops a capture,
 * and a reset clears the SUMP state.
 */
export function installSimSump(fw: SimFirmware, opts: SimSumpOptions = {}): SimSump {
  const sump = new SimSump(fw, opts);
  fw.sump = sump;
  const write = fw.write.bind(fw);
  const reset = fw.reset.bind(fw);
  let lastOut: ((b: Uint8Array) => void) | null = null;
  const feed = sump.feed.bind(sump);
  sump.feed = (b, out) => {
    lastOut = out;
    feed(b, out);
  };
  fw.write = (data: Uint8Array) => {
    let from = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== CAN) continue;
      // Process what precedes it first so the parser state is current.
      if (i > from) write(data.subarray(from, i));
      from = i;
      if (sump.inLongCommand && lastOut) {
        sump.feed(CAN, lastOut);
        from = i + 1;
      } else {
        sump.cancel();
      }
    }
    if (from < data.length) write(data.subarray(from));
  };
  fw.reset = () => {
    sump.reset();
    reset();
  };
  return sump;
}
