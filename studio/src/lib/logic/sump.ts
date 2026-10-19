// SUMP / Openbench Logic Sniffer client for the JTAGulator's logic analyzer mode
// (PropSUMP.spin). The device must already be in SUMP mode (see
// JTAGulator.enterLogicAnalyzer()).
//
// Firmware facts this client is built around (all from PropSUMP.spin):
//  - 24 probes in 3 groups of 8. Group-disable flags (0x82, byte 1 bits 2..4)
//    decide how many bytes each sample takes on the wire (1..3, group 0 first).
//  - Samples are stored 32 bits at a time: at most 1024 samples per capture,
//    regardless of how many groups are enabled (metadata claims 3072 bytes).
//  - 0x81 counts are 16-bit little endian: periods = (n + 1) * 4, capped at 1024.
//    Before ID Tracker 1.3 the read count is capped to the delay count (no
//    pre-trigger capture). From 1.3, read > delay with a stage-1 trigger keeps
//    read - delay samples from before the trigger, at <= 80 MHz / 88.
//  - 0x80 divider is 24-bit little endian in OLS 100 MHz units; the firmware
//    converts it to 80 MHz Propeller clocks: wait = floor((div + 1) * 4 / 5),
//    minimum 66 clocks (1.212 MHz).
//  - Samples are sent newest first (buffer[delay - 1 - i]).
//  - Trigger masks/values: before ID Tracker 1.3 a parsing bug kept only the
//    first parameter byte, so only CH0-7 could participate in a trigger. Triggers are level (WAITPEQ)
//    and sampling starts at the trigger, so the trigger is sample 0.
//  - Trigger config: only the "start" bit (byte 4 bit 3) is honoured.
//  - 0x06 returns the current inputs in the same 1..3 byte format as a sample.
//  - 0x00 during a capture cancels it (no samples sent). Long commands must
//    arrive within 100 ms per byte.
import { AbortedError, TimeoutError, type Session } from "../core/session";

export const SUMP = {
  RESET: 0x00,
  RUN: 0x01,
  ID: 0x02,
  META: 0x04,
  INPUT: 0x06,
  DIV: 0x80,
  CNT: 0x81,
  FLAGS: 0x82,
  TRIG_MASK: [0xc0, 0xc4, 0xc8, 0xcc],
  TRIG_VAL: [0xc1, 0xc5, 0xc9, 0xcd],
  TRIG_CONF: [0xc2, 0xc6, 0xca, 0xce],
} as const;

export const SUMP_LIMITS = {
  /** Propeller system clock. */
  clockHz: 80_000_000,
  /** Clock the OLS protocol's divider is expressed in. */
  olsClockHz: 100_000_000,
  /** Minimum wait between samples, in Propeller clocks. */
  minClocksWait: 66,
  maxClocksWait: Math.floor((0x1000000 * 4) / 5),
  /** 80 MHz / 66 clocks. */
  maxSampleRateHz: 80_000_000 / 66,
  /** What the firmware advertises in its metadata (0x23). */
  advertisedMaxSampleRateHz: 1_200_000,
  minSampleRateHz: 80_000_000 / Math.floor((0x1000000 * 4) / 5),
  maxSamples: 1024,
  /** ID Tracker 1.4 packs samples (4 per 3 longs): normal captures go up to this. */
  packedMaxSamples: 1364,
  /** Fastest rate with run-length encoding (firmware RLE_MIN_CLOCKS_WAIT = 160). */
  rleMaxRateHz: 80_000_000 / 160,
  minSamples: 4,
  /** Sample counts are multiples of this. */
  sampleStep: 4,
  channels: 24,
  groups: 3,
  /** Trigger channels on firmware with the old parsing bug (before ID Tracker 1.3). */
  triggerChannelMask: 0xff,
  /** Trigger channels on fixed firmware. */
  fullTriggerChannelMask: 0xffffff,
  /** Fastest rate with pre-trigger capture (firmware PRE_MIN_CLOCKS_WAIT = 88). */
  preTriggerMaxRateHz: 80_000_000 / 88,
  /** Serial link speed (bytes/s ~ baud / 10). */
  baud: 115_200,
} as const;

/** Sample rates offered by the UI. The actual rate is quantized; see planSampleRate(). */
export const SAMPLE_RATES = [
  1_200_000, 1_000_000, 800_000, 500_000, 400_000, 250_000, 200_000, 100_000, 50_000, 20_000, 10_000, 5_000, 2_000,
  1_000, 500, 200, 100, 50, 20, 10,
];

export interface Capture {
  /** Actual sample rate (after firmware quantization). */
  sampleRateHz: number;
  /** Oldest first; bit n = CHn. Bits of disabled groups are 0. */
  samples: Uint32Array;
  /** Channels that were actually captured (enabled groups). */
  channelMask: number;
  /** Sample index the trigger fired at, or null for an untriggered capture. */
  triggerIndex: number | null;
  /** Date.now() when the capture completed. */
  capturedAt: number;
}

export interface Trigger {
  /** Channels that must match (CH0-7 only on old firmware, see SumpClient fullTriggers). */
  mask: number;
  /** Required level of each masked channel. */
  value: number;
}

export interface CaptureOptions {
  sampleRateHz: number;
  samples: number;
  /** Channels of interest; every group containing one is enabled. Empty = all. */
  channels: number[];
  trigger?: Trigger;
  /** Samples to keep from before the trigger (needs the preTrigger option). */
  preTriggerSamples?: number;
  /**
   * Run-length encode (needs the rle option): `samples` then counts entries, and
   * the capture covers as much time as the signal's runs allow. Max 500 kHz.
   */
  rle?: boolean;
  /**
   * Multi-stage trigger (up to 4 stages, replaces `trigger`): each stage waits for
   * its pattern; a stage with `start` (or the 4th) starts the capture, otherwise
   * the next stage is armed. No pre-trigger samples with stages.
   */
  stages?: (Trigger & { start?: boolean })[];
  signal?: AbortSignal;
  /**
   * Give up after this long (ms). Defaults to the expected capture + transfer
   * time plus margin when untriggered, and no limit when waiting for a trigger.
   */
  timeoutMs?: number;
  /** Called as sample bytes arrive (0..1). */
  onProgress?: (fraction: number) => void;
}

export interface RatePlan {
  /** Value sent with 0x80 (OLS 100 MHz units, minus one). */
  divider: number;
  /** Propeller clocks between samples, as computed by the firmware. */
  clocksWait: number;
  actualHz: number;
}

/** Quantize a requested sample rate to what the firmware will really do. */
export function planSampleRate(hz: number): RatePlan {
  const L = SUMP_LIMITS;
  const want = Number.isFinite(hz) && hz > 0 ? hz : L.maxSampleRateHz;
  let cw = Math.round(L.clockHz / want);
  cw = Math.min(L.maxClocksWait, Math.max(L.minClocksWait, cw));
  // Smallest divider whose floor((div + 1) * 4 / 5) is cw.
  const divider = Math.min(0xffffff, Math.ceil((cw * 5) / 4) - 1);
  const clocksWait = Math.max(L.minClocksWait, Math.floor(((divider + 1) * 4) / 5));
  return { divider, clocksWait, actualHz: L.clockHz / clocksWait };
}

/** Clamp a sample count to a multiple of 4 in [4, max] (max 1024, or 1364 on ID Tracker 1.4). */
export function clampSamples(n: number, max: number = SUMP_LIMITS.maxSamples): number {
  const L = SUMP_LIMITS;
  if (!Number.isFinite(n)) return max;
  const r = Math.round(n / L.sampleStep) * L.sampleStep;
  return Math.min(max, Math.max(L.minSamples, r));
}

/** Bit g set = channel group g (CH8g..CH8g+7) enabled. */
export function groupsForChannels(channels: number[]): number {
  if (!channels.length) return 0b111;
  let g = 0;
  for (const c of channels) if (c >= 0 && c < SUMP_LIMITS.channels) g |= 1 << (c >> 3);
  return g;
}

export function groupMaskToChannelMask(groups: number): number {
  let m = 0;
  for (let g = 0; g < SUMP_LIMITS.groups; g++) if (groups & (1 << g)) m |= 0xff << (8 * g);
  return m >>> 0;
}

/** 0x82 flags byte: bits 2..4 disable groups 0..2; group 4 (bit 5) always disabled. */
export function flagsForGroups(groups: number): number {
  let f = 0b0010_0000;
  for (let g = 0; g < SUMP_LIMITS.groups; g++) if (!(groups & (1 << g))) f |= 1 << (2 + g);
  return f;
}

const popcount3 = (g: number) => (g & 1) + ((g >> 1) & 1) + ((g >> 2) & 1);

/** Expected capture time (ms) excluding trigger wait and transfer. */
export function captureDurationMs(sampleRateHz: number, samples: number) {
  return (clampSamples(samples, SUMP_LIMITS.packedMaxSamples) / planSampleRate(sampleRateHz).actualHz) * 1000;
}

/** Expected time (ms) to send a capture over the 115200 baud link. */
export function transferDurationMs(samples: number, groups: number) {
  return ((clampSamples(samples, SUMP_LIMITS.packedMaxSamples) * popcount3(groups) * 10) / SUMP_LIMITS.baud) * 1000;
}

const long = (cmd: number, v: number) =>
  new Uint8Array([cmd, v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

/** SUMP metadata keys (sigrok naming). */
const META_KEYS: Record<number, string> = {
  0x01: "deviceName",
  0x02: "fpgaVersion",
  0x03: "ancillaryVersion",
  0x20: "numProbes",
  0x21: "sampleMemory",
  0x22: "dynamicMemory",
  0x23: "maxSampleRate",
  0x24: "protocolVersion",
  0x40: "numProbes",
  0x41: "protocolVersion",
};

/**
 * Parse a SUMP metadata block. Returns null while incomplete. Tags 0x01-0x1F
 * are NUL-terminated strings, 0x20-0x3F 32-bit big endian, 0x40-0x5F one byte,
 * 0x00 ends the block.
 */
export function parseMetadata(b: ArrayLike<number>): { meta: Record<string, string | number>; length: number } | null {
  const meta: Record<string, string | number> = {};
  let i = 0;
  while (i < b.length) {
    const tag = b[i++];
    if (tag === 0x00) return { meta, length: i };
    const key = META_KEYS[tag] ?? `0x${tag.toString(16).padStart(2, "0")}`;
    if (tag < 0x20) {
      let s = "";
      while (i < b.length && b[i] !== 0) s += String.fromCharCode(b[i++]);
      if (i >= b.length) return null;
      i++;
      meta[key] = s;
    } else if (tag < 0x40) {
      if (i + 4 > b.length) return null;
      meta[key] = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      i += 4;
    } else if (tag < 0x60) {
      if (i + 1 > b.length) return null;
      meta[key] = b[i++];
    } else {
      // Unknown tag class: can't know its length; stop here.
      return { meta, length: i };
    }
  }
  return null;
}

/** Decode a newest-first SUMP sample stream into an oldest-first array. */
/**
 * Decode a run-length encoded capture (OLS RLE, as sigrok reads it): entries
 * arrive newest first; one whose top bit (the last byte's bit 7) is set is a
 * count, meaning the next value entry repeats count + 1 times. Returns the
 * samples oldest first, with the flag bit cleared.
 */
export function decodeRle(raw: ArrayLike<number>, entries: number, groups: number): Uint32Array {
  const bps = popcount3(groups);
  const shifts: number[] = [];
  for (let g = 0; g < 3; g++) if (groups & (1 << g)) shifts.push(8 * g);
  const newestFirst: number[] = [];
  let repeat = 0;
  for (let k = 0; k < entries; k++) {
    const o = k * bps;
    if (raw[o + bps - 1] & 0x80) {
      let c = 0;
      for (let j = 0; j < bps; j++) c |= (j === bps - 1 ? raw[o + j] & 0x7f : raw[o + j]) << (8 * j);
      repeat = c;
      continue;
    }
    let v = 0;
    for (let j = 0; j < bps; j++) v |= raw[o + j] << shifts[j];
    for (let i = 0; i <= repeat; i++) newestFirst.push(v >>> 0);
    repeat = 0;
  }
  return Uint32Array.from(newestFirst.reverse());
}

export function unpackSamples(raw: ArrayLike<number>, count: number, groups: number): Uint32Array {
  const bps = popcount3(groups);
  const out = new Uint32Array(count);
  const shifts: number[] = [];
  for (let g = 0; g < 3; g++) if (groups & (1 << g)) shifts.push(8 * g);
  for (let k = 0; k < count; k++) {
    let v = 0;
    const o = k * bps;
    for (let j = 0; j < bps; j++) v |= raw[o + j] << shifts[j];
    out[count - 1 - k] = v >>> 0;
  }
  return out;
}

interface Reader {
  bytes: number[];
  /** Resolve once `done(bytes)` is true. */
  wait(done: (b: number[]) => boolean, o: { timeout?: number; idle?: number; signal?: AbortSignal; onData?: () => void }): Promise<void>;
  close(): void;
}

export class SumpError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SumpError";
  }
}

export class SumpClient {
  /**
   * fullTriggers: the firmware parses all 24 trigger channels (ID Tracker 1.3+).
   * preTrigger: the firmware can keep samples from before the trigger (1.3+).
   * longCaptures: the firmware packs samples, allowing 1364 instead of 1024 (1.4+).
   * rle: the firmware supports run-length encoded captures (1.4+).
   */
  constructor(
    public readonly session: Session,
    public readonly opts: { fullTriggers?: boolean; preTrigger?: boolean; longCaptures?: boolean; rle?: boolean } = {},
  ) {}

  /** Largest capture this firmware takes (pre-trigger captures stay at 1024). */
  get maxSamples() {
    return this.opts.longCaptures ? SUMP_LIMITS.packedMaxSamples : SUMP_LIMITS.maxSamples;
  }

  get triggerChannelMask() {
    return this.opts.fullTriggers ? SUMP_LIMITS.fullTriggerChannelMask : SUMP_LIMITS.triggerChannelMask;
  }

  /** Raw byte reader on top of the session's latin1 stream. Call only inside exclusive(). */
  private reader(): Reader {
    const s = this.session;
    const bytes: number[] = [];
    let notify: (() => void) | null = null;
    let closedReason: string | null = null;
    const offRx = s.rx.on((t) => {
      for (let i = 0; i < t.length; i++) bytes.push(t.charCodeAt(i) & 0xff);
      notify?.();
    });
    const offClosed = s.closed.on((r) => {
      closedReason = r;
      notify?.();
    });
    return {
      bytes,
      wait(done, o) {
        return new Promise<void>((resolve, reject) => {
          let overall: ReturnType<typeof setTimeout> | undefined;
          let idle: ReturnType<typeof setTimeout> | undefined;
          let seen = bytes.length;
          const finish = (e?: Error) => {
            notify = null;
            clearTimeout(overall);
            clearTimeout(idle);
            o.signal?.removeEventListener("abort", onAbort);
            e ? reject(e) : resolve();
          };
          const onAbort = () => finish(new AbortedError());
          const armIdle = () => {
            if (!o.idle) return;
            clearTimeout(idle);
            idle = setTimeout(() => finish(new SumpError(`Device stopped sending (got ${bytes.length} bytes)`)), o.idle);
          };
          const check = () => {
            if (closedReason !== null) return finish(new AbortedError(`Port closed: ${closedReason}`));
            if (bytes.length !== seen) {
              seen = bytes.length;
              o.onData?.();
              armIdle();
            }
            if (done(bytes)) finish();
          };
          if (o.signal?.aborted) return reject(new AbortedError());
          o.signal?.addEventListener("abort", onAbort, { once: true });
          if (o.timeout && o.timeout > 0)
            overall = setTimeout(
              () => finish(new TimeoutError(`SUMP reply (got ${bytes.length} bytes)`, String.fromCharCode(...bytes.slice(-64)))),
              o.timeout,
            );
          notify = check;
          check();
        });
      },
      close() {
        notify = null;
        offRx();
        offClosed();
      },
    };
  }

  /** Wait until the line has been quiet for `quietMs` (bounded by `maxMs`). */
  private async drain(quietMs = 120, maxMs = 1500) {
    const r = this.reader();
    try {
      const t0 = Date.now();
      for (;;) {
        const n = r.bytes.length;
        await new Promise((res) => setTimeout(res, quietMs));
        if (r.bytes.length === n || Date.now() - t0 > maxMs) break;
      }
    } finally {
      r.close();
      this.session.flush();
    }
  }

  private async send(...chunks: Uint8Array[]) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) buf.set(c, o), (o += c.length);
    await this.session.write(buf);
  }

  /** Five resets: backs out of any half-received long command, cancels a capture. */
  private resetBytes() {
    return new Uint8Array(5).fill(SUMP.RESET);
  }

  /** Send the SUMP reset sequence (also cancels a running capture). */
  reset(): Promise<void> {
    return this.session.exclusive(async () => {
      await this.send(this.resetBytes());
      await this.drain();
    });
  }

  /** Query the device ID. The JTAGulator answers "1ALS". */
  identify(o: { timeout?: number; signal?: AbortSignal } = {}): Promise<string> {
    return this.session.exclusive(async () => {
      const r = this.reader();
      try {
        this.session.flush();
        await this.send(this.resetBytes(), new Uint8Array([SUMP.ID]));
        await r.wait((b) => b.length >= 4, { timeout: o.timeout ?? 1500, signal: o.signal });
        return String.fromCharCode(...r.bytes.slice(-4));
      } finally {
        r.close();
        this.session.flush();
      }
    });
  }

  /** Query and parse the metadata block (0x04). */
  metadata(o: { timeout?: number; signal?: AbortSignal } = {}): Promise<Record<string, string | number>> {
    return this.session.exclusive(async () => {
      const r = this.reader();
      try {
        this.session.flush();
        await this.send(this.resetBytes(), new Uint8Array([SUMP.META]));
        let parsed: ReturnType<typeof parseMetadata> = null;
        await r.wait((b) => (parsed = parseMetadata(b)) !== null, { timeout: o.timeout ?? 2000, signal: o.signal });
        return parsed!.meta;
      } finally {
        r.close();
        this.session.flush();
      }
    });
  }

  /**
   * Read the current level of all 24 channels (0x06). All groups are enabled
   * first since the reply format follows the group-disable flags.
   */
  snapshot(o: { timeout?: number; signal?: AbortSignal } = {}): Promise<number> {
    return this.session.exclusive(async () => {
      const r = this.reader();
      try {
        this.session.flush();
        await this.send(long(SUMP.FLAGS, flagsForGroups(0b111)), new Uint8Array([SUMP.INPUT]));
        await r.wait((b) => b.length >= 3, { timeout: o.timeout ?? 1000, signal: o.signal });
        const b = r.bytes;
        return (b[0] | (b[1] << 8) | (b[2] << 16)) >>> 0;
      } finally {
        r.close();
        this.session.flush();
      }
    });
  }

  /** Run one capture. */
  capture(opts: CaptureOptions): Promise<Capture> {
    const wantsPre = !!(opts.trigger?.mask && this.opts.preTrigger && opts.preTriggerSamples);
    const rle = !!(opts.rle && this.opts.rle && !wantsPre);
    // Pre-trigger rings and RLE entries are one long each: at most 1024.
    const count = clampSamples(opts.samples, wantsPre || rle ? SUMP_LIMITS.maxSamples : this.maxSamples);
    const wantPre = opts.trigger?.mask && this.opts.preTrigger ? (opts.preTriggerSamples ?? 0) : 0;
    const pre = Math.min(count - SUMP_LIMITS.sampleStep, Math.max(0, Math.round(wantPre / 4) * 4));
    // Pre-trigger capture polls the trigger in software: the firmware enforces a
    // longer sample period (PRE_MIN_CLOCKS_WAIT).
    const rate = planSampleRate(
      pre
        ? Math.min(opts.sampleRateHz, SUMP_LIMITS.preTriggerMaxRateHz)
        : rle
          ? Math.min(opts.sampleRateHz, SUMP_LIMITS.rleMaxRateHz)
          : opts.sampleRateHz,
    );
    const groups = groupsForChannels(opts.channels);
    if (!groups) throw new SumpError("No channel group enabled");
    const trig = opts.trigger && opts.trigger.mask ? opts.trigger : undefined;
    const tmask = this.triggerChannelMask;
    const stages = opts.stages?.length ? opts.stages.slice(0, 4) : trig ? [{ ...trig, start: true }] : [];
    if (opts.stages?.length && pre) throw new SumpError("Pre-trigger samples need a single-stage trigger");
    if (stages.some((st) => st.mask & ~tmask))
      throw new SumpError("This firmware can only trigger on CH0-7 (update to ID Tracker 1.3 for all channels)");
    const triggered = stages.some((st) => st.mask);
    const bps = popcount3(groups);
    const expectBytes = count * bps;
    const n = count / 4 - 1;
    const d = (count - pre) / 4 - 1;
    const cmds = [
      this.resetBytes(),
      long(SUMP.FLAGS, flagsForGroups(groups) | (rle ? 0x100 : 0)),
      long(SUMP.DIV, rate.divider),
      long(SUMP.CNT, (n & 0xffff) | ((d & 0xffff) << 16)),
      ...[0, 1, 2, 3].flatMap((i) => {
        const st = stages[i];
        // Unused stages: empty mask. A stage's "start" flag is bit 27 (byte 4 bit 3);
        // without stages, stage 1 starts an untriggered capture at once.
        return [
          long(SUMP.TRIG_MASK[i], st ? st.mask & tmask : 0),
          long(SUMP.TRIG_VAL[i], st ? st.value & st.mask & tmask : 0),
          long(SUMP.TRIG_CONF[i], (st ? st.start : i === 0) ? 0x08000000 : 0),
        ];
      }),
      new Uint8Array([SUMP.RUN]),
    ];
    const timeout =
      opts.timeoutMs ??
      // An RLE capture lasts until the buffer fills, which depends on the signal.
      (triggered || rle ? 0 : captureDurationMs(rate.actualHz, count) + transferDurationMs(count, groups) + 3000);

    return this.session.exclusive(async () => {
      const r = this.reader();
      try {
        this.session.flush();
        await this.send(...cmds);
        await r.wait((b) => b.length >= expectBytes, {
          timeout,
          // Once samples flow, they come back to back.
          idle: 2000,
          signal: opts.signal,
          onData: () => opts.onProgress?.(Math.min(1, r.bytes.length / expectBytes)),
        });
        return {
          sampleRateHz: rate.actualHz,
          samples: rle ? decodeRle(r.bytes, count, groups) : unpackSamples(r.bytes, count, groups),
          // With RLE the top channel of the highest enabled group carries the count flag.
          channelMask: rle ? groupMaskToChannelMask(groups) & ~(1 << (31 - Math.clz32(groupMaskToChannelMask(groups)))) : groupMaskToChannelMask(groups),
          triggerIndex: triggered ? pre : null,
          capturedAt: Date.now(),
        } satisfies Capture;
      } catch (e) {
        r.close();
        // Cancel the capture (the firmware drops the samples) and discard stragglers.
        await this.session.write(this.resetBytes()).catch(() => {});
        await this.drain().catch(() => {});
        throw e;
      } finally {
        r.close();
        this.session.flush();
      }
    });
  }
}
