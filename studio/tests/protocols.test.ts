import { describe, expect, it } from "vitest";
import { decodeCan, decodeJtag, decodeOneWire, decodeSwd } from "../src/lib/logic/protocols";
import type { Capture } from "../src/lib/logic/sump";

/** A capture sampled from a function of time (s) returning the channel bits. */
function sample(rate: number, seconds: number, at: (t: number) => number): Capture {
  const n = Math.round(rate * seconds);
  const samples = new Uint32Array(n);
  for (let i = 0; i < n; i++) samples[i] = at(i / rate) >>> 0;
  return { sampleRateHz: rate, samples, channelMask: 0xffffff, triggerIndex: null, capturedAt: 0 };
}

/** Piecewise-constant level from [duration (s), level] segments. */
function segments(list: [number, number][]) {
  const ends: number[] = [];
  let t = 0;
  for (const [d] of list) ends.push((t += d));
  return (x: number) => {
    const i = ends.findIndex((e) => x < e);
    return i < 0 ? 1 : list[i][1];
  };
}

describe("1-Wire", () => {
  it("decodes reset, presence and command bytes", () => {
    const us = 1e-6;
    const seg: [number, number][] = [[100 * us, 1], [500 * us, 0], [30 * us, 1], [120 * us, 0], [300 * us, 1]];
    for (const byte of [0xcc, 0x44]) {
      for (let k = 0; k < 8; k++) seg.push(...(((byte >> k) & 1 ? [[6 * us, 0], [64 * us, 1]] : [[60 * us, 0], [10 * us, 1]]) as [number, number][]));
    }
    const lvl = segments(seg);
    const cap = sample(1_000_000, 0.003, (t) => lvl(t) << 3);
    const a = decodeOneWire(cap, { channel: 3 });
    expect(a.map((x) => x.label)).toEqual(["Reset", "Presence", "CC Skip ROM", "44"]);
  });
});

describe("CAN", () => {
  function crc15(bits: number[]) {
    let crc = 0;
    for (const b of bits) {
      const nxt = b ^ ((crc >> 14) & 1);
      crc = (crc << 1) & 0x7fff;
      if (nxt) crc ^= 0x4599;
    }
    return crc;
  }
  const bitsOf = (v: number, n: number) => Array.from({ length: n }, (_, k) => (v >> (n - 1 - k)) & 1);

  function frame(id: number, data: number[], corrupt = false) {
    const body = [0, ...bitsOf(id, 11), 0, 0, 0, ...bitsOf(data.length, 4), ...data.flatMap((b) => bitsOf(b, 8))];
    let crc = crc15(body);
    if (corrupt) crc ^= 1;
    const all = [...body, ...bitsOf(crc, 15)];
    // Bit stuffing: after five equal bits, insert the opposite.
    const stuffed: number[] = [];
    let run = 0;
    let last = -1;
    for (const b of all) {
      stuffed.push(b);
      run = b === last ? run + 1 : 1;
      last = b;
      if (run === 5) {
        stuffed.push(1 - b);
        last = 1 - b;
        run = 1;
      }
    }
    return [...stuffed, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1];
  }

  it("decodes a standard frame with stuffing and checks the CRC", () => {
    const bits = [...Array(12).fill(1), ...frame(0x123, [0x00, 0x00, 0xab, 0xcd]), ...Array(12).fill(1), ...frame(0x7ff, [0x55], true), ...Array(5).fill(1)];
    const rate = 1_000_000;
    const bitrate = 125_000;
    const cap = sample(rate, bits.length / bitrate, (t) => bits[Math.min(bits.length - 1, Math.floor(t * bitrate))] << 5);
    const a = decodeCan(cap, { channel: 5, bitrate });
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ label: "123 [4] 00 00 AB CD", error: false });
    expect(a[0].title).toMatch(/CRC OK, ACKed/);
    expect(a[1]).toMatchObject({ label: "7FF [1] 55", error: true });
  });
});

describe("JTAG", () => {
  it("follows the TAP and reports IR and DR shifts", () => {
    // [tms, tdi, tdo] per TCK cycle, starting in Test-Logic-Reset.
    const cycles: [number, number, number][] = [];
    const tms = (...v: number[]) => v.forEach((m) => cycles.push([m, 0, 0]));
    tms(0, 1, 1, 0, 0); // RTI, Select-DR, Select-IR, Capture-IR, Shift-IR
    [0, 1, 1, 1].forEach((b, k) => cycles.push([k === 3 ? 1 : 0, b, k === 0 ? 1 : 0])); // IR = 0xE
    tms(1, 0, 1, 0, 0); // Update-IR, RTI, Select-DR, Capture-DR, Shift-DR
    const id = 0x4ba00477;
    for (let k = 0; k < 32; k++) cycles.push([k === 31 ? 1 : 0, 0, (id >>> k) & 1]);
    tms(1, 0, 1, 1, 1, 1, 1); // Update-DR, RTI, then five TMS highs to reset
    const T = 1e-6;
    const cap = sample(8_000_000, cycles.length * T, (t) => {
      const c = cycles[Math.min(cycles.length - 1, Math.floor(t / T))];
      const tck = (t % T) >= T / 2 ? 1 : 0; // rising edge mid-cycle; signals change while TCK is low
      return tck | (c[0] << 1) | (c[1] << 2) | (c[2] << 3);
    });
    const a = decodeJtag(cap, { tck: 0, tms: 1, tdi: 2, tdo: 3 });
    expect(a.map((x) => x.label)).toEqual(["IR 4 bits TDI 0xE TDO 0x1", "DR 32 bits TDI 0x00000000 TDO 0x4BA00477", "Reset"]);
  });
});

describe("SWD", () => {
  /** SWDIO level for each clock cycle (a turnaround floats high). */
  function build() {
    const bits: number[] = [];
    const push = (...b: number[]) => bits.push(...b);
    const word = (v: number) => {
      const d = Array.from({ length: 32 }, (_, k) => (v >>> k) & 1);
      return [...d, d.reduce((x, y) => x + y, 0) % 2];
    };
    push(...Array(52).fill(1), 0, 0); // line reset, idle
    push(1, 0, 1, 0, 0, 1, 0, 1); // read DP IDCODE
    push(1, 1, 0, 0, ...word(0x2ba01477), 1); // trn, ACK OK, data, trn
    push(1, 0, 0, 0, 1, 1, 0, 1); // write DP SELECT (A=0x8)
    push(1, 1, 0, 0, 1, ...word(0x000000f0)); // trn, ACK OK, trn, data
    push(1, 1, 1, 1, 1, 0, 0, 1); // read AP 0xC
    push(1, 0, 1, 0, 1); // trn, ACK WAIT, trn
    push(0, 0, 0, 0);
    return bits;
  }

  it("decodes a line reset, reads, writes and a WAIT", () => {
    const bits = build();
    const T = 1e-6;
    // 8 samples per clock cycle: SWCLK low for 4, high for 4.
    const cap = sample(8_000_000, bits.length * T, (t) => {
      const i = Math.round(t * 8_000_000);
      return ((i >> 2) & 1) | (bits[Math.min(bits.length - 1, i >> 3)] << 1);
    });
    const a = decodeSwd(cap, { swclk: 0, swdio: 1 });
    expect(a.map((x) => x.label)).toEqual(["Line reset", "R IDCODE 0x2BA01477", "W SELECT 0x000000F0", "R AP 0xC WAIT"]);
    expect(a.map((x) => !!x.error)).toEqual([false, false, false, true]);
  });
});
