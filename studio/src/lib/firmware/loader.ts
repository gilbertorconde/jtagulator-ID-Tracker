// Parallax Propeller 1 serial loader (the boot ROM protocol), so firmware can be
// loaded over the JTAGulator's USB serial port from the desktop app or a browser.
//
// Protocol (as implemented by Parallax's tools and p1load):
//  1. Pulse DTR to reset the chip, wait ~100 ms for the boot ROM.
//  2. Send 0xF9 (timing calibration), 250 bits of an LFSR sequence seeded with
//     'P' (one byte per bit: 0xFE = 1, 0xFF = 0), then 258 x 0xF9 to clock out
//     the reply: the next 250 LFSR bits and an 8-bit chip version.
//  3. Send the command as a long: 1 = load RAM and run, 2 = program EEPROM and
//     stop, 3 = program EEPROM and run. Then the image size in longs and the
//     image, each long packed as 11 bytes carrying 3 bits each.
//  4. Poll with 0xF9; the chip answers 0xFE when the checksum is good (then, for
//     EEPROM loads, again after programming and after verifying), 0xFF on failure.
import type { Transport } from "../core/transport";
import { PINHOUND_FW } from "../core/jtagulator";

export type LoadMode = "ram" | "eeprom";

export interface LoadProgress {
  phase: "reset" | "handshake" | "sending" | "checksum" | "programming" | "verifying" | "done";
  /** 0..1 within the sending phase. */
  fraction: number;
}

export class LoaderError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LoaderError";
  }
}

export interface DtrTransport extends Transport {
  setDtr(on: boolean): Promise<void>;
}

export const canLoad = (t: Transport): t is DtrTransport => typeof (t as Partial<DtrTransport>).setDtr === "function";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lfsrBits(count: number, seed = 0x50) {
  let lfsr = seed;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(lfsr & 1);
    lfsr = ((lfsr << 1) | (((lfsr >> 7) ^ (lfsr >> 5) ^ (lfsr >> 4) ^ (lfsr >> 1)) & 1)) & 0xff;
  }
  return out;
}

/** A long encoded for the boot ROM: 10 bytes of 3 bits, then 1 byte of 2 bits. */
export function encodeLong(value: number, out: number[] = []) {
  let v = value >>> 0;
  for (let n = 0; n < 10; n++) {
    out.push(0x92 | (v & 1) | ((v & 2) << 2) | ((v & 4) << 4));
    v >>>= 3;
  }
  out.push(0xf2 | (v & 1) | ((v & 2) << 2));
  return out;
}

/**
 * Turn a .binary or .eeprom file into the image the boot ROM expects. EEPROM
 * images are trimmed to the program (the header's vbase), like a .binary.
 */
export function prepareImage(file: Uint8Array): Uint8Array {
  if (file.length < 16) throw new LoaderError("File is too small to be a Propeller image");
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const clkfreq = dv.getUint32(0, true);
  const pbase = dv.getUint16(6, true);
  const vbase = dv.getUint16(8, true);
  if (pbase !== 0x10 || vbase <= pbase || vbase > 0x8000 || clkfreq === 0)
    throw new LoaderError("Not a Propeller .binary or .eeprom image (bad header)");
  let len = file.length === 0x8000 ? vbase : file.length;
  len = Math.ceil(len / 4) * 4;
  if (len > 0x8000) throw new LoaderError("Image is larger than 32 KB");
  const img = new Uint8Array(len);
  img.set(file.subarray(0, Math.min(len, file.length)));
  return img;
}

/** Firmware details read from an image header and its strings. */
export function describeImage(file: Uint8Array) {
  const img = prepareImage(file);
  let text = "";
  for (const b of img) text += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "\n";
  const fw = text.match(/JTAGulator FW [^\n]*/)?.[0] ?? null;
  return {
    bytes: img.length,
    firmware: fw,
    version: fw?.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null,
    pinhound: !!fw && PINHOUND_FW.test(fw),
  };
}

export async function loadPropeller(
  t: DtrTransport,
  file: Uint8Array,
  mode: LoadMode,
  onProgress: (p: LoadProgress) => void = () => {},
): Promise<{ chipVersion: number }> {
  const image = prepareImage(file);
  const rx: number[] = [];
  let waiter: (() => void) | null = null;
  const unsub = t.onData((d) => {
    for (const b of d) rx.push(b);
    waiter?.();
  });
  const take = async (n: number, timeoutMs: number) => {
    const end = Date.now() + timeoutMs;
    while (rx.length < n) {
      const left = end - Date.now();
      if (left <= 0) return null;
      await new Promise<void>((r) => {
        const timer = setTimeout(r, Math.min(left, 50));
        waiter = () => (clearTimeout(timer), r());
      });
      waiter = null;
    }
    return rx.splice(0, n);
  };
  /** Poll with 0xF9 until the chip answers 0xFE (ok) or 0xFF (fail). */
  const ack = async (timeoutMs: number, what: string) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await t.write(Uint8Array.of(0xf9));
      const r = await take(1, 30);
      if (!r) continue;
      if (r[0] === 0xfe) return;
      if (r[0] === 0xff) throw new LoaderError(`${what} failed`);
    }
    throw new LoaderError(`No answer from the Propeller (${what})`);
  };

  try {
    onProgress({ phase: "reset", fraction: 0 });
    await t.setDtr(true);
    await sleep(10);
    await t.setDtr(false);
    await sleep(100);
    rx.length = 0;

    onProgress({ phase: "handshake", fraction: 0 });
    const bits = lfsrBits(250 + 250);
    const hello = [0xf9, ...bits.slice(0, 250).map((b) => 0xfe | b), ...Array<number>(258).fill(0xf9)];
    await t.write(Uint8Array.from(hello));
    const reply = await take(258, 1500);
    if (!reply) throw new LoaderError("No Propeller found: it didn't answer the handshake. Is this a JTAGulator, and is nothing else using the port?");
    for (let i = 0; i < 250; i++) {
      if (reply[i] !== (0xfe | bits[250 + i])) throw new LoaderError("Propeller handshake mismatch");
    }
    let chipVersion = 0;
    for (let i = 0; i < 8; i++) chipVersion = ((chipVersion >> 1) & 0x7f) | ((reply[250 + i] & 1) << 7);

    const cmd = encodeLong(mode === "ram" ? 1 : 3);
    encodeLong(image.length / 4, cmd);
    await t.write(Uint8Array.from(cmd));

    // Send the image in chunks so progress is visible.
    const dv = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const longs = image.length / 4;
    const chunk = 128;
    const sendStart = Date.now();
    for (let i = 0; i < longs; i += chunk) {
      const buf: number[] = [];
      for (let j = i; j < Math.min(longs, i + chunk); j++) encodeLong(dv.getUint32(j * 4, true), buf);
      await t.write(Uint8Array.from(buf));
      onProgress({ phase: "sending", fraction: Math.min(1, (i + chunk) / longs) });
    }
    // The OS buffers the writes; allow for the time to actually transmit them.
    const txSeconds = (longs * 11 * 10) / 115200;
    // Don't start polling before the image has left the wire, or the extra 0xF9
    // bytes end up as input to the program once it starts.
    await sleep(Math.max(0, txSeconds * 1000 - (Date.now() - sendStart)));
    onProgress({ phase: "checksum", fraction: 1 });
    await ack(txSeconds * 1000 + 2500, "Checksum");
    if (mode === "eeprom") {
      onProgress({ phase: "programming", fraction: 1 });
      await ack(8000, "EEPROM programming");
      onProgress({ phase: "verifying", fraction: 1 });
      await ack(4000, "EEPROM verify");
    }
    onProgress({ phase: "done", fraction: 1 });
    return { chipVersion };
  } finally {
    unsub();
  }
}
