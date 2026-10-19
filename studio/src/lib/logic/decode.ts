// Small analysis helpers over a logic analyzer Capture.
import type { Capture } from "./sump";

export const bitAt = (cap: Capture, ch: number, i: number) => (cap.samples[i] >>> ch) & 1;

/** Sample indices i (> 0) where CHch differs from sample i - 1. */
export function transitions(cap: Capture, ch: number): Int32Array {
  const s = cap.samples;
  const out: number[] = [];
  let prev = s.length ? (s[0] >>> ch) & 1 : 0;
  for (let i = 1; i < s.length; i++) {
    const b = (s[i] >>> ch) & 1;
    if (b !== prev) out.push(i), (prev = b);
  }
  return Int32Array.from(out);
}

export interface EdgeStats {
  channel: number;
  rising: number;
  falling: number;
  /** Fraction of samples high (0..1). */
  highRatio: number;
  /** Estimated from rising edge to rising edge, or null with fewer than two. */
  frequencyHz: number | null;
  periodS: number | null;
  /** High time / period over whole periods, or null. */
  duty: number | null;
  /** Shortest run of a constant level between two edges (s), or null. */
  minPulseS: number | null;
  /** Level when there are no edges. */
  constant: 0 | 1 | null;
}

/** Edge counts, frequency and duty cycle of one channel. */
export function measure(cap: Capture, ch: number): EdgeStats {
  const s = cap.samples;
  const n = s.length;
  const dt = 1 / cap.sampleRateHz;
  let rising = 0;
  let falling = 0;
  let high = 0;
  const risingAt: number[] = [];
  let minRun = Infinity;
  let lastEdge = -1;
  let prev = n ? (s[0] >>> ch) & 1 : 0;
  if (prev) high++;
  for (let i = 1; i < n; i++) {
    const b = (s[i] >>> ch) & 1;
    if (b) high++;
    if (b !== prev) {
      if (b) rising++, risingAt.push(i);
      else falling++;
      if (lastEdge >= 0) minRun = Math.min(minRun, i - lastEdge);
      lastEdge = i;
      prev = b;
    }
  }
  let frequencyHz: number | null = null;
  let periodS: number | null = null;
  let duty: number | null = null;
  if (risingAt.length >= 2) {
    const first = risingAt[0];
    const last = risingAt[risingAt.length - 1];
    const periodSamples = (last - first) / (risingAt.length - 1);
    periodS = periodSamples * dt;
    frequencyHz = 1 / periodS;
    let h = 0;
    for (let i = first; i < last; i++) h += (s[i] >>> ch) & 1;
    duty = h / (last - first);
  }
  return {
    channel: ch,
    rising,
    falling,
    highRatio: n ? high / n : 0,
    frequencyHz,
    periodS,
    duty,
    minPulseS: Number.isFinite(minRun) ? minRun * dt : null,
    constant: rising + falling === 0 && n ? (prev as 0 | 1) : null,
  };
}

/** measure() for every captured channel (per Capture.channelMask). */
export function measureAll(cap: Capture, channels?: number[]): EdgeStats[] {
  const list = channels ?? Array.from({ length: 24 }, (_, i) => i).filter((c) => (cap.channelMask >>> c) & 1);
  return list.map((c) => measure(cap, c));
}

export interface UartOptions {
  channel: number;
  baud: number;
  /** Line idles low (inverted / RS-232 levels before a transceiver). */
  invert?: boolean;
  dataBits?: 5 | 6 | 7 | 8;
}

export interface UartFrame {
  startSample: number;
  endSample: number;
  byte: number;
  /** Stop bit was not at the idle level. */
  framingError?: boolean;
}

/** Minimum samples per bit for a usable UART decode. */
export const UART_MIN_SAMPLES_PER_BIT = 2.5;

/**
 * Decode UART (LSB first, 1 stop bit, no parity, idle high unless inverted).
 * Bits are sampled at their centre. Returns [] if the sample rate is too low
 * for the baud rate (see uartSamplesPerBit()).
 */
export function decodeUart(cap: Capture, o: UartOptions): UartFrame[] {
  const s = cap.samples;
  const n = s.length;
  const p = cap.sampleRateHz / o.baud;
  const nbits = o.dataBits ?? 8;
  if (p < UART_MIN_SAMPLES_PER_BIT || !n) return [];
  const inv = o.invert ? 1 : 0;
  const lvl = (i: number) => ((s[Math.min(n - 1, Math.round(i))] >>> o.channel) & 1) ^ inv;
  const frames: UartFrame[] = [];
  const nextFalling = (from: number) => {
    for (let j = Math.max(1, from); j < n; j++) if (lvl(j - 1) === 1 && lvl(j) === 0) return j;
    return -1;
  };
  /** Decode the frame whose start bit begins at `start`; null if it runs past the capture. */
  const frameAt = (start: number) => {
    const stopCentre = start + p * (nbits + 1.5) - 0.5;
    if (stopCentre >= n) return null;
    const startOk = lvl(start + p * 0.5 - 0.5) === 0;
    let byte = 0;
    for (let b = 0; b < nbits; b++) byte |= lvl(start + p * (b + 1.5) - 0.5) << b;
    return { byte, startOk, stopOk: lvl(stopCentre) === 1, stopCentre };
  };
  /** Number of consecutive clean frames when assuming a frame starts at `start`. */
  const chain = (start: number, limit = 64) => {
    let count = 0;
    while (start >= 0 && count < limit) {
      const f = frameAt(start);
      if (!f || !f.startOk || !f.stopOk) break;
      count++;
      start = nextFalling(Math.ceil(f.stopCentre));
    }
    return count;
  };
  // Synchronize on an idle period (line inactive for a whole frame) when there is
  // one. Otherwise (a back-to-back stream cut mid-byte) try every edge within the
  // next two frames and keep the alignment that yields the longest run of clean
  // frames; the same happens again after a framing error.
  let i = 1;
  let synced = false;
  const frameLen = p * (nbits + 2);
  for (let j = 0, run = 0; j < n; j++) {
    run = lvl(j) ? run + 1 : 0;
    if (run >= frameLen) {
      i = j;
      synced = true;
      break;
    }
  }
  for (;;) {
    let start = nextFalling(i);
    if (start < 0) break;
    if (!synced) {
      let best = -1;
      let bestCount = 0;
      for (let e = start; e >= 0 && e < start + 2 * frameLen; e = nextFalling(e + 1)) {
        const c = chain(e);
        if (c > bestCount) (best = e), (bestCount = c);
      }
      if (best < 0) {
        // Nothing decodes cleanly here; move on.
        i = Math.ceil(start + 2 * frameLen);
        continue;
      }
      start = best;
      synced = true;
    }
    const f = frameAt(start);
    if (!f) break;
    if (!f.startOk) {
      // Glitch, not a start bit.
      i = start + 1;
      continue;
    }
    const end = Math.min(n - 1, Math.round(start + p * (nbits + 2)) - 1);
    frames.push(f.stopOk ? { startSample: start, endSample: end, byte: f.byte } : { startSample: start, endSample: end, byte: f.byte, framingError: true });
    if (!f.stopOk) synced = false;
    i = Math.ceil(f.stopCentre);
  }
  return frames;
}

export const uartSamplesPerBit = (cap: Capture, baud: number) => cap.sampleRateHz / baud;

/** Printable rendering of decoded bytes (C-style escapes for the rest). */
export function framesToText(frames: UartFrame[]): string {
  return frames.map((f) => byteLabel(f.byte)).join("");
}

export function byteLabel(b: number): string {
  if (b === 0x0a) return "\\n";
  if (b === 0x0d) return "\\r";
  if (b === 0x09) return "\\t";
  if (b >= 0x20 && b < 0x7f) return String.fromCharCode(b);
  return "\\x" + b.toString(16).padStart(2, "0");
}

/** Format seconds with an SI unit (ns, µs, ms, s). */
export function formatTime(sec: number, digits = 3): string {
  const a = Math.abs(sec);
  if (a === 0) return "0 s";
  const [div, unit] = a < 1e-6 ? [1e-9, "ns"] : a < 1e-3 ? [1e-6, "µs"] : a < 1 ? [1e-3, "ms"] : [1, "s"];
  return `${+(sec / div).toPrecision(digits)} ${unit}`;
}

/** Format a frequency with an SI unit (Hz, kHz, MHz). */
export function formatHz(hz: number, digits = 4): string {
  const a = Math.abs(hz);
  const [div, unit] = a >= 1e6 ? [1e6, "MHz"] : a >= 1e3 ? [1e3, "kHz"] : [1, "Hz"];
  return `${+(hz / div).toPrecision(digits)} ${unit}`;
}
