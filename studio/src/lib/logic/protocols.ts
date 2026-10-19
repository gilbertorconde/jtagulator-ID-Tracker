// More protocol decoders over a logic analyzer Capture: 1-Wire, CAN, and the
// JTAG and SWD debug protocols themselves. Each returns annotations (sample
// ranges with a short label) to draw on the waveform and list in the panel.
import type { Capture } from "./sump";

export interface Annotation {
  /** Channel row to draw on. */
  channel: number;
  start: number;
  end: number;
  label: string;
  title: string;
  error?: boolean;
}

const hex = (v: number, digits = 2) => (v >>> 0).toString(16).toUpperCase().padStart(digits, "0");
const bit = (cap: Capture, ch: number, i: number) => (cap.samples[i] >>> ch) & 1;

/** Sample indices where `ch` rises (dir 1) or falls (dir 0). */
function edges(cap: Capture, ch: number, dir: 0 | 1): number[] {
  const out: number[] = [];
  for (let i = 1; i < cap.samples.length; i++) if (bit(cap, ch, i - 1) !== dir && bit(cap, ch, i) === dir) out.push(i);
  return out;
}

// ------------------------------------------------------------------ 1-Wire

const ONEWIRE_CMDS: Record<number, string> = {
  0x33: "Read ROM",
  0x55: "Match ROM",
  0xcc: "Skip ROM",
  0xf0: "Search ROM",
  0xec: "Alarm search",
  0x44: "Convert T",
  0xbe: "Read scratchpad",
  0x4e: "Write scratchpad",
  0x48: "Copy scratchpad",
  0xb8: "Recall EEPROM",
  0xb4: "Read power supply",
};

/**
 * 1-Wire at standard speed: resets (low >= 480 us), presence pulses, and bytes
 * (LSB first) from time slots: a low pulse shorter than 15 us is a 1, longer a 0.
 */
export function decodeOneWire(cap: Capture, o: { channel: number }): Annotation[] {
  const us = (n: number) => (n / cap.sampleRateHz) * 1e6;
  const ch = o.channel;
  const out: Annotation[] = [];
  const lows: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < cap.samples.length; i++) {
    const b = bit(cap, ch, i);
    if (!b && start < 0 && i > 0) start = i;
    if (b && start >= 0) {
      lows.push([start, i]);
      start = -1;
    }
  }
  let bits: { v: number; s: number; e: number }[] = [];
  let first = true;
  const flush = () => {
    while (bits.length >= 8) {
      const byte = bits.slice(0, 8).reduce((v, b, k) => v | (b.v << k), 0);
      const name = first ? ONEWIRE_CMDS[byte] : undefined;
      out.push({ channel: ch, start: bits[0].s, end: bits[7].e, label: name ? `${hex(byte)} ${name}` : hex(byte), title: `0x${hex(byte)}${name ? ` (${name})` : ""}` });
      bits = bits.slice(8);
      first = false;
    }
  };
  let afterReset = -1;
  for (const [s, e] of lows) {
    const w = us(e - s);
    if (w >= 400) {
      flush();
      bits = [];
      first = true;
      out.push({ channel: ch, start: s, end: e, label: "Reset", title: `Reset pulse, ${w.toFixed(0)} us` });
      afterReset = e;
      continue;
    }
    if (afterReset >= 0 && us(s - afterReset) < 80 && w >= 50) {
      out.push({ channel: ch, start: s, end: e, label: "Presence", title: `Presence pulse, ${w.toFixed(0)} us` });
      afterReset = -1;
      continue;
    }
    afterReset = -1;
    bits.push({ v: w < 15 ? 1 : 0, s, e });
  }
  flush();
  return out;
}

// --------------------------------------------------------------------- CAN

function crc15(bits: number[]): number {
  let crc = 0;
  for (const b of bits) {
    const nxt = b ^ ((crc >> 14) & 1);
    crc = (crc << 1) & 0x7fff;
    if (nxt) crc ^= 0x4599;
  }
  return crc;
}

/**
 * Classic CAN (11- and 29-bit IDs) on a logic-level RX line (recessive = 1).
 * Removes stuff bits, checks the CRC, and reports one annotation per frame.
 */
export function decodeCan(cap: Capture, o: { channel: number; bitrate: number }): Annotation[] {
  const ch = o.channel;
  const spb = cap.sampleRateHz / o.bitrate;
  const n = cap.samples.length;
  const out: Annotation[] = [];
  if (spb < 3) return out;
  let i = 1;
  while (i < n) {
    // SOF: a falling edge after at least 11 recessive bits (or from the start of the capture).
    let sof = -1;
    for (let j = i, run = i === 1 ? 11 * spb : 0; j < n; j++) {
      if (bit(cap, ch, j)) run++;
      else {
        if (run >= 10 * spb) {
          sof = j;
          break;
        }
        run = 0;
      }
    }
    if (sof < 0) break;
    // Walk bits from SOF, resyncing on recessive-to-dominant edges near a boundary.
    let boundary = sof;
    const raw: number[] = [];
    const take = () => {
      const center = Math.round(boundary + spb / 2);
      if (center >= n) return null;
      const b = bit(cap, ch, center);
      let next = boundary + spb;
      for (let k = Math.round(next - spb / 4); k <= Math.round(next + spb / 4) && k < n; k++) {
        if (k > 0 && bit(cap, ch, k - 1) === 1 && bit(cap, ch, k) === 0) {
          next = k;
          break;
        }
      }
      boundary = next;
      return b;
    };
    // Destuffed bits from SOF up to and including the CRC.
    const bits: number[] = [];
    let same = 0;
    let last = -1;
    let error: string | null = null;
    const takeStuffed = () => {
      for (;;) {
        const b = take();
        if (b === null) return null;
        raw.push(b);
        if (same === 5) {
          // Stuff bit: must be the opposite of the five before it.
          if (b === last) {
            error = "stuff error";
            return null;
          }
          same = 1;
          last = b;
          continue;
        }
        same = b === last ? same + 1 : 1;
        last = b;
        bits.push(b);
        return b;
      }
    };
    const field = (len: number) => {
      let v = 0;
      for (let k = 0; k < len; k++) {
        const b = takeStuffed();
        if (b === null) return null;
        v = v * 2 + b;
      }
      return v;
    };
    const sofBit = takeStuffed();
    let id = field(11);
    const rtrSrr = field(1);
    const ide = field(1);
    let rtr = rtrSrr;
    let ext = false;
    if (ide === 1) {
      const idb = field(18);
      rtr = field(1);
      field(2); // r1, r0
      if (id !== null && idb !== null) id = id * 2 ** 18 + idb;
      ext = true;
    } else field(1); // r0
    const dlc = field(4);
    const data: number[] = [];
    if (dlc !== null && rtr === 0) for (let k = 0; k < Math.min(dlc, 8); k++) {
      const b = field(8);
      if (b === null) break;
      data.push(b);
    }
    const crcEnd = bits.length;
    const crc = field(15);
    const end = Math.min(n - 1, Math.round(boundary));
    if (sofBit === null || id === null || dlc === null || crc === null) {
      out.push({ channel: ch, start: sof, end, label: "?", title: error ?? "Incomplete frame", error: true });
      i = end + 1;
      continue;
    }
    const crcOk = crc15(bits.slice(0, crcEnd)) === crc;
    // CRC delimiter, ACK slot (dominant = acknowledged), ACK delimiter.
    take();
    const ack = take() === 0;
    const idText = ext ? hex(id, 8) : hex(id, 3);
    const label = `${idText}${rtr ? " RTR" : ""} [${dlc}] ${data.map((b) => hex(b)).join(" ")}`.trim();
    out.push({
      channel: ch,
      start: sof,
      end: Math.min(n - 1, Math.round(boundary)),
      label,
      title: `${ext ? "Extended" : "Standard"} ID 0x${idText}, ${rtr ? "remote frame" : `${data.length} data bytes`}, CRC ${crcOk ? "OK" : "error"}, ${ack ? "ACKed" : "no ACK"}`,
      error: !crcOk,
    });
    i = Math.round(boundary) + 1;
  }
  return out;
}

// -------------------------------------------------------------------- JTAG

export const TAP_STATES = [
  "Test-Logic-Reset",
  "Run-Test/Idle",
  "Select-DR-Scan",
  "Capture-DR",
  "Shift-DR",
  "Exit1-DR",
  "Pause-DR",
  "Exit2-DR",
  "Update-DR",
  "Select-IR-Scan",
  "Capture-IR",
  "Shift-IR",
  "Exit1-IR",
  "Pause-IR",
  "Exit2-IR",
  "Update-IR",
] as const;

// [next if TMS=0, next if TMS=1], by state index.
const TAP_NEXT: [number, number][] = [
  [1, 0], [1, 2], [3, 9], [4, 5], [4, 5], [6, 8], [6, 7], [4, 8],
  [1, 2], [10, 0], [11, 12], [11, 12], [13, 15], [13, 14], [11, 15], [1, 2],
];

/**
 * JTAG TAP decoding: follows the state machine on TCK rising edges (starting in
 * Test-Logic-Reset) and reports each IR/DR shift with its length and the TDI/TDO
 * values (LSB first), plus resets.
 */
export function decodeJtag(cap: Capture, o: { tck: number; tms: number; tdi?: number; tdo?: number }): Annotation[] {
  const out: Annotation[] = [];
  let state = 0;
  let shiftStart = -1;
  let tdiBits: number[] = [];
  let tdoBits: number[] = [];
  const toHex = (b: number[]) => {
    let v = 0n;
    b.forEach((x, k) => (v |= BigInt(x) << BigInt(k)));
    return "0x" + v.toString(16).toUpperCase().padStart(Math.ceil(b.length / 4), "0");
  };
  for (const e of edges(cap, o.tck, 1)) {
    const tms = bit(cap, o.tms, e);
    const inShift = state === 4 || state === 11;
    if (inShift) {
      if (shiftStart < 0) shiftStart = e;
      if (o.tdi !== undefined) tdiBits.push(bit(cap, o.tdi, e));
      if (o.tdo !== undefined) tdoBits.push(bit(cap, o.tdo, e));
    }
    const next = TAP_NEXT[state][tms];
    if (inShift && next !== state) {
      const reg = state === 11 ? "IR" : "DR";
      const len = Math.max(tdiBits.length, tdoBits.length);
      const parts = [`${reg} ${len} bits`];
      if (tdiBits.length) parts.push(`TDI ${toHex(tdiBits)}`);
      if (tdoBits.length) parts.push(`TDO ${toHex(tdoBits)}`);
      out.push({ channel: o.tdi ?? o.tms, start: shiftStart, end: e, label: parts.join(" "), title: parts.join(", ") });
      shiftStart = -1;
      tdiBits = [];
      tdoBits = [];
    }
    if (next === 0 && state !== 0) out.push({ channel: o.tms, start: e, end: e, label: "Reset", title: "Test-Logic-Reset" });
    state = next;
  }
  return out;
}

// --------------------------------------------------------------------- SWD

const DP_REGS_R: Record<number, string> = { 0x0: "IDCODE", 0x4: "CTRL/STAT", 0x8: "RESEND", 0xc: "RDBUFF" };
const DP_REGS_W: Record<number, string> = { 0x0: "ABORT", 0x4: "CTRL/STAT", 0x8: "SELECT", 0xc: "TARGETSEL" };

/**
 * SWD transactions, as sigrok's decoder reads them: one bit per SWCLK cycle,
 * sampled on the rising edge. A request is 8 bits (start, APnDP, RnW, A[2:3],
 * parity, stop 0, park 1), then a turnaround cycle and a 3-bit ACK. Reads follow
 * with 32 data bits, parity and a turnaround; writes with a turnaround, then 32
 * data bits and parity. Line resets (50+ cycles with SWDIO high) resynchronize.
 */
export function decodeSwd(cap: Capture, o: { swclk: number; swdio: number }): Annotation[] {
  const out: Annotation[] = [];
  const at = edges(cap, o.swclk, 1);
  const b = at.map((i) => bit(cap, o.swdio, i));
  const n = at.length;
  let j = 0;
  const label = (read: boolean, reg: string, rest: string) => `${read ? "R" : "W"} ${reg} ${rest}`;
  while (j < n) {
    // A run of 50+ highs is a line reset as a whole: its tail plus the idle
    // cycles after it can look like a valid request.
    if (b[j] && (j === 0 || !b[j - 1])) {
      let r = j;
      while (r < n && b[r]) r++;
      if (r - j >= 50) {
        out.push({ channel: o.swdio, start: at[j], end: at[r - 1], label: "Line reset", title: `Line reset (${r - j} clocks with SWDIO high)` });
        j = r;
        continue;
      }
    }
    if (!b[j] || j + 12 > n) {
      j++;
      continue;
    }
    const [, apndp, rnw, a2, a3, parity, stop, park] = b.slice(j, j + 8);
    if (stop !== 0 || park !== 1 || (apndp + rnw + a2 + a3) % 2 !== parity) {
      j++;
      continue;
    }
    const s = at[j];
    const addr = (a2 | (a3 << 1)) << 2;
    const read = rnw === 1;
    const reg = apndp ? `AP 0x${hex(addr, 1)}` : (read ? DP_REGS_R : DP_REGS_W)[addr] ?? `DP 0x${hex(addr, 1)}`;
    const what = `${apndp ? "AP" : "DP"} ${read ? "read" : "write"} ${reg}`;
    j += 9; // request + turnaround
    const ackBits = b.slice(j, j + 3).join("");
    j += 3;
    const ack = ackBits === "100" ? "OK" : ackBits === "010" ? "WAIT" : ackBits === "001" ? "FAULT" : "no reply";
    if (ack !== "OK") {
      out.push({ channel: o.swdio, start: s, end: at[j - 1], label: label(read, reg, ack), title: `${what}: ${ack}`, error: true });
      // WAIT and FAULT end with a turnaround; with no reply the line floats.
      if (ack !== "no reply") j++;
      continue;
    }
    if (!read) j++; // turnaround back to the host
    if (j + 33 > n) {
      out.push({ channel: o.swdio, start: s, end: at[n - 1], label: label(read, reg, "(cut off)"), title: `${what}: capture ended`, error: true });
      break;
    }
    const data = b.slice(j, j + 32);
    const value = data.reduce((v, x, k) => v | (x << k), 0) >>> 0;
    const parityErr = b[j + 32] !== data.reduce((x, y) => x + y, 0) % 2;
    const end = at[j + 32];
    j += 33;
    if (read) j++; // turnaround back to the host
    out.push({
      channel: o.swdio,
      start: s,
      end,
      label: label(read, reg, `0x${hex(value, 8)}`),
      title: `${what} = 0x${hex(value, 8)}, ACK OK${parityErr ? ", parity error" : ""}`,
      error: parityErr,
    });
  }
  return out;
}
