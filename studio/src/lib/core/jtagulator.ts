// High-level JTAGulator API. Drives the firmware's interactive text menus:
// navigates to the right menu, answers every prompt explicitly from the given
// options, and parses the output into structured findings.
import { OutputParser, parseGpioLine, type ParseMode } from "./parser";
import { AbortedError, Session, sleep, TimeoutError } from "./session";
import { latin1 } from "./transport";
import type {
  DeviceMode,
  ExtestFinding,
  Finding,
  IrdrFinding,
  JtagFinding,
  JtagPins,
  Menu,
  OpContext,
  OpEvent,
  PartialJtagPins,
  PinsLow,
  RtckFinding,
  ScanOptions,
  ScanResult,
  SwdFinding,
  UartFinding,
  UartTxdFinding,
} from "./types";
import { MAX_CHANNELS } from "./types";

const CR = "\r";
const CAN = "\x18";

/** The command prompt: "\r\n\n" + optional menu name + "> ". */
export const PROMPT = /\r\n\n(JTAG|UART|GPIO|SWD)?> $/;

const MENU_KEY: Record<Exclude<Menu, "main">, string> = { jtag: "J", uart: "U", gpio: "G", swd: "S" };

export class DeviceError extends Error {
  constructor(message: string, public transcript = "") {
    super(message);
    this.name = "DeviceError";
  }
}

/** A prompt answer: text to send (CR is appended for line prompts). */
type Answer = string | ((m: RegExpExecArray) => string);

interface Rule {
  re: RegExp;
  answer: Answer;
  /** "line" prompts read a CR-terminated string, "key" prompts read a single key. */
  input: "line" | "key";
  /** After answering, the firmware starts the long-running part. */
  starts?: boolean;
}

const yn = (v: boolean) => (v ? "y" : "n");
const line = (re: RegExp, answer: Answer, starts = false): Rule => ({ re, answer, input: "line", starts });
const key = (re: RegExp, answer: Answer, starts = false): Rule => ({ re, answer, input: "key", starts });

function channelRules(o: ScanOptions): Rule[] {
  checkChannel(o.start, "start");
  checkChannel(o.end, "end");
  if (o.end < o.start) throw new DeviceError(`Ending channel ${o.end} is below starting channel ${o.start}`);
  return [line(/Enter starting channel \[\d+\]: $/, String(o.start)), line(/Enter ending channel \[\d+\]: $/, String(o.end))];
}

function settingsRules(pinsLow: PinsLow | false | undefined): Rule[] {
  const p = pinsLow || null;
  return [
    line(/Bring channels LOW before each permutation\? \[[yYnN]\/[yYnN]\]: $/, yn(!!p)),
    line(/Enter length of time for channels to remain LOW \(in ms, 1 - 1000\) \[\d+\]: $/, String(p?.lowMs ?? 100)),
    line(
      /Enter length of time after channels return HIGH before proceeding \(in ms, 1 - 1000\) \[\d+\]: $/,
      String(p?.highMs ?? 100),
    ),
  ];
}

const SPACE_TO_BEGIN = key(/Press spacebar to begin \(any other key besides Enter to abort\)\.\.\.$/, " ", true);

function pinAnswer(v: number | null | undefined, name: string): string {
  if (v === null || v === undefined) return "x";
  checkChannel(v, name);
  return String(v);
}

function pinRules(pins: Record<string, number | null | undefined>, allowUnknown: boolean): Rule {
  return line(/Enter (TDI|TDO|TCK|TMS|TXD|RXD|SWDIO|SWCLK) pin \[-?\d+\]: $/, (m) => {
    const name = m[1];
    const v = pins[name.toLowerCase()];
    if ((v === undefined || v === null) && !allowUnknown) throw new DeviceError(`Missing ${name} pin`);
    return pinAnswer(v, name);
  });
}

function checkChannel(v: number, name: string) {
  if (!Number.isInteger(v) || v < 0 || v >= MAX_CHANNELS) throw new DeviceError(`${name} must be a channel 0-${MAX_CHANNELS - 1}`);
}

function permutations(n: number, r: number) {
  let v = 1;
  for (let i = n - r + 1; i <= n; i++) v *= i;
  return v;
}

/** Estimate of how many loop iterations each progress dash stands for, and the total. */
interface ProgressModel {
  perTick: number;
  total: number | null;
}

/** Wraps an AbortSignal so ops can also be stopped from code (e.g. duration limits). */
function linkedController(signal?: AbortSignal) {
  const c = new AbortController();
  if (signal) {
    if (signal.aborted) c.abort();
    else signal.addEventListener("abort", () => c.abort(), { once: true });
  }
  return c;
}

/** Firmware version lines of PinHound and of the ID Tracker releases (up to 1.3) it continues. */
export const PINHOUND_FW = /PinHound|ID Tracker/i;

export interface DeviceInfo {
  firmware: string;
  version: string | null;
  lines: string[];
  /** PinHound firmware, or the ID Tracker releases it continues (manufacturer database, logic analyzer fixes). */
  pinhound: boolean;
}

export interface GpioState {
  value: number;
  /** bits[0] is CH0. */
  bits: boolean[];
}

export const gpioBits = (value: number) => Array.from({ length: MAX_CHANNELS }, (_, i) => ((value >>> i) & 1) === 1);

export interface PassthroughHandle {
  write(data: string | Uint8Array): Promise<void>;
  onData(cb: (text: string) => void): () => void;
  /** Leave passthrough (sends Ctrl-X) and return to the UART menu. */
  close(): Promise<void>;
  closed: Promise<void>;
}

export interface GpioWriteHandle {
  value: number;
  /** Stop driving the outputs and return to the menu. */
  release(): Promise<void>;
  released: Promise<void>;
}

export class JTAGulator {
  menu: Menu | null = null;
  mode: DeviceMode = "unknown";
  voltage: number | null = null;
  readonly events = new EventTarget();

  constructor(public readonly session: Session) {}

  private setMenu(m: Menu | null) {
    this.menu = m;
    this.events.dispatchEvent(new CustomEvent("menu", { detail: m }));
  }

  private setVoltage(v: number | null) {
    this.voltage = v;
    this.events.dispatchEvent(new CustomEvent("voltage", { detail: v }));
  }

  private setMode(m: DeviceMode) {
    this.mode = m;
    this.events.dispatchEvent(new CustomEvent("mode", { detail: m }));
  }

  private menuFromPrompt(name: string | undefined): Menu {
    return (name ? name.toLowerCase() : "main") as Menu;
  }

  // ---------------------------------------------------------------- handshake

  /**
   * Bring the firmware to a known state: wake it (it waits for a key after
   * reset), find the command prompt, and detect the persistent SUMP / OpenOCD
   * modes. Returns the detected mode.
   */
  sync(opts: { timeout?: number } = {}): Promise<DeviceMode> {
    return this.session.exclusive(() => this.syncUnlocked(opts.timeout ?? 1500));
  }

  private async syncUnlocked(timeout: number): Promise<DeviceMode> {
    const s = this.session;
    const tryPrompt = async (send: string) => {
      s.flush();
      await s.write(send);
      try {
        const r = await s.expect(PROMPT, { timeout });
        this.setMenu(this.menuFromPrompt(r.match[1]));
        this.setMode("normal");
        return true;
      } catch (e) {
        if (!(e instanceof TimeoutError)) throw e;
        return false;
      }
    };
    const tryBinary = async (send: number[], reply: RegExp) => {
      s.flush();
      await s.write(new Uint8Array(send));
      try {
        await s.expect(reply, { timeout: 500 });
        return true;
      } catch (e) {
        if (!(e instanceof TimeoutError)) throw e;
        return false;
      }
    };
    // The first CR wakes the firmware after reset (it waits for any key), the second
    // gets a fresh prompt.
    if ((await tryPrompt(CR)) || (await tryPrompt(CR))) return "normal";
    // Not the text UI. Probe the persistent binary modes before sending Ctrl-X,
    // which would leave them. OpenOCD (Bus Pirate protocol) answers 0x00 with "BBIO1".
    if (await tryBinary([0x00], /BBIO1/)) return this.setMode("ocd"), "ocd";
    // SUMP answers "query ID" (0x02) with "1ALS".
    if (await tryBinary([0x00, 0x00, 0x00, 0x00, 0x00, 0x02], /1ALS/)) return this.setMode("sump"), "sump";
    // Stuck mid-command: Ctrl-X is never a valid answer, so it backs out to the menu.
    if (await tryPrompt(CAN + CR)) return "normal";
    this.setMode("unknown");
    return "unknown";
  }

  /** Leave the persistent logic analyzer / OpenOCD mode (sends Ctrl-X). */
  exitSpecialMode(): Promise<void> {
    return this.session.exclusive(async () => {
      const s = this.session;
      s.flush();
      await s.write(CAN);
      const r = await s.expect(PROMPT, { timeout: 3000 }).catch(() => null);
      if (r) {
        this.setMenu(this.menuFromPrompt(r.match[1]));
        this.setMode("normal");
      } else {
        await this.syncUnlocked(1500);
      }
    });
  }

  // --------------------------------------------------------------- primitives

  private async ensureSynced() {
    if (this.menu === null) {
      const mode = await this.syncUnlocked(1500);
      if (mode !== "normal") throw new DeviceError(`JTAGulator is in ${mode} mode; exit it first`);
    }
  }

  /** Send a single-letter menu command and wait for the next prompt. */
  private async command(cmd: string, signal?: AbortSignal): Promise<string> {
    const s = this.session;
    s.flush();
    await s.write(cmd + CR);
    const r = await s.expect(PROMPT, { timeout: 5000, signal });
    this.setMenu(this.menuFromPrompt(r.match[1]));
    return r.before;
  }

  private async goto(target: Menu, signal?: AbortSignal) {
    await this.ensureSynced();
    if (this.menu === target) return;
    if (this.menu !== "main") await this.command("M", signal);
    if (target !== "main") await this.command(MENU_KEY[target], signal);
    if (this.menu !== target) throw new DeviceError(`Could not switch to the ${target} menu`);
  }

  /**
   * Run one menu command as a conversation: answer prompts with `rules` until
   * the command prompt comes back. Output is parsed as it streams.
   */
  private async converse(
    menu: Menu | null,
    cmd: string,
    rules: Rule[],
    opts: {
      ctx: OpContext;
      parse?: ParseMode;
      progress?: (p: OutputParser) => ProgressModel;
      onPass?: (passes: number) => void;
      /** Called when the long-running phase starts (after the last prompt). */
      onRunning?: (abort: () => void) => void;
      /** Text that, once seen, means the command entered a raw/streaming mode. */
      handoff?: RegExp;
      stepTimeout?: number;
    },
  ): Promise<{ parser: OutputParser; transcript: string; aborted: boolean; handoff?: boolean }> {
    const { ctx } = opts;
    const s = this.session;
    const emit = (e: OpEvent) => ctx.onEvent?.(e);
    if (ctx.signal?.aborted) throw new AbortedError();
    if (menu) await this.goto(menu, ctx.signal);
    else await this.ensureSynced();

    let model: ProgressModel | null = null;
    const parser = new OutputParser(opts.parse ?? "none", {
      onPermutations: (n) => {
        emit({ type: "permutations", count: n });
      },
      onTick: (ticks) => {
        model ??= opts.progress?.(parser) ?? null;
        const fraction = model?.total ? Math.min(0.99, (ticks * model.perTick) / model.total) : null;
        emit({ type: "progress", ticks, fraction });
      },
      onFinding: (id, finding) => emit({ type: "result", id, finding: structuredClone(finding) }),
      onMessage: (level, text) => emit({ type: "message", level, text }),
      onPass: (n) => opts.onPass?.(n),
    });
    let transcript = "";
    const unsub = s.rx.on((t) => {
      transcript += t;
      parser.feed(t);
    });

    // Where the firmware is waiting: at a line prompt, a key prompt, or busy running.
    let state: "line" | "key" | "running" = "running";
    let aborted = false;
    const abortNow = async () => {
      if (aborted) return;
      aborted = true;
      // Any key aborts a running scan. A line prompt needs a CR to finish reading;
      // Ctrl-X is never a valid answer, so the firmware bails out of the command.
      await s.write(state === "line" ? CAN + CR : CAN).catch(() => {});
    };
    // After aborting, wait for the prompt. If the firmware had just reached a line
    // prompt it is still waiting for CR, so send one.
    const awaitPromptAfterAbort = async () => {
      try {
        return await s.expect(PROMPT, { timeout: 1500 });
      } catch (e) {
        if (!(e instanceof TimeoutError)) throw e;
        await s.write(CR);
        return s.expect(PROMPT, { timeout: 5000 });
      }
    };
    const onAbort = () => void abortNow();
    ctx.signal?.addEventListener("abort", onAbort);

    const unexpected = /\]: $|\? \[[yYnNhHlL]\/[yYnNhHlL]\]: $/;
    const handoff = opts.handoff;
    let handedOff = false;
    const patterns = [PROMPT, ...rules.map((r) => r.re), ...(handoff ? [handoff] : []), unexpected];
    try {
      emit({ type: "phase", phase: "configuring" });
      s.flush();
      await s.write(cmd + CR);
      for (;;) {
        // Once aborted, ignore the signal: we still need to see the prompt come back.
        const r = await s.expect(patterns, {
          timeout: state === "running" ? 0 : (opts.stepTimeout ?? 5000),
          signal: aborted ? undefined : ctx.signal,
        }).catch(async (e) => {
          if (e instanceof AbortedError && s.open && ctx.signal?.aborted) {
            await abortNow();
            return awaitPromptAfterAbort();
          }
          throw e;
        });
        if (r.index === 0 || r.match[0].match(PROMPT)) {
          this.setMenu(this.menuFromPrompt(r.match[1]));
          break;
        }
        const ruleIdx = r.index - 1;
        if (handoff && ruleIdx === rules.length) {
          emit({ type: "phase", phase: "running" });
          handedOff = true;
          break;
        }
        if (ruleIdx >= rules.length) {
          // A prompt we don't have an answer for: back out instead of hanging.
          state = "line";
          await abortNow();
          await awaitPromptAfterAbort().catch(() => {});
          this.setMenu(null);
          throw new DeviceError(`Unexpected prompt: ${r.match.input?.slice(-120).trim()}`, transcript);
        }
        if (aborted) continue;
        const rule = rules[ruleIdx];
        let answer: string;
        try {
          answer = typeof rule.answer === "function" ? rule.answer(r.match) : rule.answer;
        } catch (e) {
          state = rule.input;
          await abortNow();
          await awaitPromptAfterAbort().catch(() => {});
          throw e;
        }
        await s.write(rule.input === "line" ? answer + CR : answer);
        state = "running";
        if (rule.starts) {
          emit({ type: "phase", phase: "running" });
          opts.onRunning?.(() => void abortNow());
        }
        // Single-key prompts in the middle of a run (EXTEST pause) read a key, not a line.
        if (rule.input === "key") state = "running";
      }
    } finally {
      ctx.signal?.removeEventListener("abort", onAbort);
      unsub();
    }
    parser.finish();
    if (handedOff) return { parser, transcript, aborted, handoff: true };
    emit({ type: "phase", phase: "done" });
    return { parser, transcript, aborted };
  }

  private result<F extends Finding>(
    r: { parser: OutputParser; transcript: string; aborted: boolean },
    t0: number,
    kinds?: F["kind"][],
  ): ScanResult<F> {
    const errors = r.parser.messages.filter((m) => m.level === "error");
    if (errors.length && !r.aborted) throw new DeviceError(errors.map((e) => e.text).join(" "), r.transcript);
    const findings = r.parser.findings.filter((f) => !kinds || kinds.includes(f.kind as F["kind"])) as F[];
    return {
      findings,
      permutations: r.parser.permutations,
      aborted: r.aborted || r.parser.messages.some((m) => /aborted!$/.test(m.text)),
      messages: r.parser.messages.map((m) => m.text),
      transcript: r.transcript,
      durationMs: Date.now() - t0,
    };
  }

  /** Run a device operation with exclusive access to the session. */
  private op<T>(fn: () => Promise<T>): Promise<T> {
    return this.session.exclusive(fn);
  }

  // ------------------------------------------------------------------ general

  info(ctx: OpContext = {}): Promise<DeviceInfo> {
    return this.op(async () => {
      await this.ensureSynced();
      // "I" exists only in the main menu.
      await this.goto("main", ctx.signal);
      const text = await this.command("I", ctx.signal);
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && l !== "I");
      const fw = lines.find((l) => /^JTAGulator FW/.test(l)) ?? lines[0] ?? "";
      const v = fw.match(/(\d+\.\d+(?:\.\d+)?)/);
      return { firmware: fw, version: v ? v[1] : null, lines, pinhound: PINHOUND_FW.test(fw) };
    });
  }

  /** Read the current target I/O voltage (null = undefined/off). */
  getVoltage(ctx: OpContext = {}): Promise<number | null> {
    return this.op(async () => {
      const r = await this.converse(null, "V", [line(/Enter new target I\/O voltage \(1\.4 - 3\.3, 0 for off\): $/, "\x18")], { ctx }).catch(
        (e) => {
          if (e instanceof DeviceError) return null;
          throw e;
        },
      );
      const m = r?.transcript.match(/Current target I\/O voltage: (Undefined|\d\.\d)/);
      const v = m && m[1] !== "Undefined" ? parseFloat(m[1]) : null;
      this.setVoltage(v);
      return v;
    });
  }

  /** Set the target I/O voltage, 1.4 - 3.3 V, or 0/null to turn it off. */
  setTargetVoltage(volts: number | null, ctx: OpContext = {}): Promise<number | null> {
    const v = volts ?? 0;
    if (v !== 0 && (v < 1.4 || v > 3.3)) return Promise.reject(new DeviceError("Voltage must be 1.4 - 3.3 V, or 0 for off"));
    return this.op(async () => {
      const r = await this.converse(
        null,
        "V",
        [line(/Enter new target I\/O voltage \(1\.4 - 3\.3, 0 for off\): $/, v === 0 ? "0" : v.toFixed(1))],
        { ctx },
      );
      const t = r.transcript;
      if (/Value out of range!/.test(t)) throw new DeviceError("Voltage out of range", t);
      const m = t.match(/New target I\/O voltage set: (\d\.\d)/);
      const result = m ? parseFloat(m[1]) : null;
      this.setVoltage(result);
      return result;
    });
  }

  /** Show the firmware's help text for a menu. */
  help(menu: Menu = "main", ctx: OpContext = {}): Promise<string> {
    return this.op(async () => {
      await this.goto(menu, ctx.signal);
      return (await this.command("H", ctx.signal)).replace(/^H\r?\n?/, "").trim();
    });
  }

  // --------------------------------------------------------------------- JTAG

  /** Combined IDCODE + BYPASS scan: finds TDI, TDO, TCK, TMS (and TRST#). */
  jtagScan(o: ScanOptions, ctx: OpContext = {}): Promise<ScanResult<JtagFinding>> {
    return this.op(async () => {
      const t0 = Date.now();
      const n = o.end - o.start + 1;
      const r = await this.converse("jtag", "J", [...channelRules(o), ...settingsRules(o.pinsLow), SPACE_TO_BEGIN], {
        ctx,
        parse: "jtag",
        progress: () => ({ perTick: o.pinsLow ? 1 : 100, total: permutations(n, 3) }),
      });
      return this.result<JtagFinding>(r, t0, ["jtag"]);
    });
  }

  /** IDCODE scan: finds TDO, TCK, TMS from devices that reset to IDCODE. */
  idcodeScan(o: ScanOptions, ctx: OpContext = {}): Promise<ScanResult<JtagFinding>> {
    return this.op(async () => {
      const t0 = Date.now();
      const r = await this.converse("jtag", "I", [...channelRules(o), ...settingsRules(o.pinsLow), SPACE_TO_BEGIN], {
        ctx,
        parse: "jtag",
        progress: (p) => ({ perTick: o.pinsLow ? 1 : 100, total: p.permutations }),
      });
      return this.result<JtagFinding>(r, t0, ["jtag"]);
    });
  }

  /** BYPASS scan: finds TDI, TDO, TCK, TMS. Known pins shrink the search. */
  bypassScan(o: ScanOptions & { known?: PartialJtagPins }, ctx: OpContext = {}): Promise<ScanResult<JtagFinding>> {
    return this.op(async () => {
      const t0 = Date.now();
      const known = o.known ?? {};
      const anyKnown = Object.values(known).some((v) => v !== null && v !== undefined);
      const r = await this.converse(
        "jtag",
        "B",
        [
          ...channelRules(o),
          line(/Are any pins already known\? \[[yYnN]\/[yYnN]\]: $/, yn(anyKnown)),
          pinRules(known as Record<string, number | null | undefined>, true),
          ...settingsRules(o.pinsLow),
          SPACE_TO_BEGIN,
        ],
        { ctx, parse: "jtag", progress: (p) => ({ perTick: o.pinsLow ? 1 : 10, total: p.permutations }) },
      );
      return this.result<JtagFinding>(r, t0, ["jtag"]);
    });
  }

  /** Find RTCK (adaptive clocking return), optionally with TCK known. */
  rtckScan(o: ScanOptions & { tck?: number | null }, ctx: OpContext = {}): Promise<ScanResult<RtckFinding>> {
    return this.op(async () => {
      const t0 = Date.now();
      const tckKnown = o.tck !== undefined && o.tck !== null;
      const r = await this.converse(
        "jtag",
        "R",
        [
          ...channelRules(o),
          line(/Is TCK already known\? \[[yYnN]\/[yYnN]\]: $/, yn(tckKnown)),
          pinRules({ tck: o.tck }, true),
          ...settingsRules(o.pinsLow),
          SPACE_TO_BEGIN,
        ],
        { ctx, parse: "rtck", progress: (p) => ({ perTick: o.pinsLow ? 1 : 10, total: p.permutations }) },
      );
      return this.result<RtckFinding>(r, t0, ["rtck"]);
    });
  }

  /** Read the IDCODEs of every device in the chain (pinout known; TDI not needed). */
  getDeviceIds(pins: Omit<JtagPins, "tdi">, ctx: OpContext = {}): Promise<JtagFinding> {
    return this.op(async () => {
      const r = await this.converse("jtag", "D", [pinRules({ ...pins }, false)], { ctx, parse: "jtag" });
      const res = this.result<JtagFinding>(r, Date.now(), ["jtag"]);
      const f = res.findings[0] ?? { kind: "jtag", tdi: null, tdo: pins.tdo, tck: pins.tck, tms: pins.tms, trst: [], devices: [] };
      return { ...f, tdi: null, tdo: pins.tdo, tck: pins.tck, tms: pins.tms };
    });
  }

  /** Shift a random pattern through BYPASS and check it comes back on TDO. */
  testBypass(pins: JtagPins, ctx: OpContext = {}) {
    return this.op(async () => {
      const r = await this.converse("jtag", "T", [pinRules({ ...pins }, false)], { ctx, parse: "jtag" });
      const v = r.parser.values;
      if (r.parser.messages.some((m) => m.level === "error")) throw new DeviceError(r.parser.messages.map((m) => m.text).join(" "));
      return {
        devices: v.deviceCount ? +v.deviceCount : 0,
        patternIn: v.patternIn ?? null,
        patternOut: v.patternOut ?? null,
        match: v.match === "yes",
        transcript: r.transcript,
      };
    });
  }

  /** Discover the DR length behind every instruction (single device in chain). */
  irdrDiscovery(
    o: { pins: JtagPins; ignoreSingleBit?: boolean },
    ctx: OpContext = {},
  ): Promise<ScanResult<IrdrFinding> & { irLength: number | null; instructions: number | null }> {
    return this.op(async () => {
      const t0 = Date.now();
      const ignore = o.ignoreSingleBit ?? true;
      const r = await this.converse(
        "jtag",
        "Y",
        [pinRules({ ...o.pins }, false), line(/Ignore single-bit Data Registers\? \[[yYnN]\/[yYnN]\]: $/, yn(ignore)), SPACE_TO_BEGIN],
        {
          ctx,
          parse: "irdr",
          progress: (p) => ({ perTick: 8, total: p.values.instructions ? +p.values.instructions : null }),
        },
      );
      const ir = r.parser.values.irLength;
      return {
        ...this.result<IrdrFinding>(r, t0, ["irdr"]),
        irLength: ir && ir !== "N/A" ? +ir : null,
        instructions: r.parser.values.instructions ? +r.parser.values.instructions : null,
      };
    });
  }

  /**
   * Pin mapper (EXTEST scan): walks a bit through the Boundary Scan Register
   * and reports which channel each register bit drives. Runs until aborted,
   * `passes` complete walks, or `durationMs` elapses.
   */
  pinMapper(
    o: { pins: JtagPins; instruction?: number; fill?: "high" | "low"; passes?: number; durationMs?: number },
    ctx: OpContext = {},
  ): Promise<ScanResult<ExtestFinding> & { irLength: number | null; bsrLength: number | null }> {
    return this.op(async () => {
      const t0 = Date.now();
      const ctl = linkedController(ctx.signal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const r = await this.converse(
        "jtag",
        "P",
        [
          pinRules({ ...o.pins }, false),
          line(/Enter EXTEST instruction \(in hex\) \[[0-9A-Fa-f]*\]: $/, () =>
            o.instruction === undefined ? "" : o.instruction.toString(16).toUpperCase(),
          ),
          line(/Fill Boundary Scan Register with HIGH or LOW\? \[[hHlL]\/[hHlL]\]: $/, o.fill === "high" ? "h" : "l"),
          line(/Pause after successful detection\? \[[yYnN]\/[yYnN]\]: $/, "n"),
          SPACE_TO_BEGIN,
        ],
        {
          ctx: { ...ctx, signal: ctl.signal },
          parse: "extest",
          onRunning: () => {
            if (o.durationMs) timer = setTimeout(() => ctl.abort(), o.durationMs);
          },
          onPass: (n) => {
            if (o.passes && n >= o.passes) ctl.abort();
          },
        },
      ).finally(() => clearTimeout(timer));
      const v = r.parser.values;
      return {
        ...this.result<ExtestFinding>({ ...r, aborted: false }, t0, ["extest"]),
        irLength: v.irLength && v.irLength !== "N/A" ? +v.irLength : null,
        bsrLength: v.bsrLength && v.bsrLength !== "N/A" ? +v.bsrLength : null,
      };
    });
  }

  /**
   * Switch the JTAGulator into OpenOCD (Bus Pirate protocol) mode with the given
   * pinout. The mode persists across resets until exited with Ctrl-X.
   */
  enterOpenOcd(pins: JtagPins, ctx: OpContext = {}): Promise<void> {
    return this.op(async () => {
      const r = await this.converse("jtag", "O", [pinRules({ ...pins }, false)], {
        ctx,
        handoff: /Entering OpenOCD mode! Press Ctrl-X to exit\.\.\./,
      });
      if (!r.handoff) throw new DeviceError("Device did not enter OpenOCD mode", r.transcript);
      this.setMenu(null);
      this.setMode("ocd");
    });
  }

  // ---------------------------------------------------------------------- UART

  /**
   * Find UART TXD/RXD by sending `text` on every pin pair at every standard
   * baud rate and watching for a response.
   */
  uartScan(
    o: ScanOptions & {
      known?: { txd?: number | null; rxd?: number | null };
      /** ASCII text (sent with a trailing CR), or bytes. Default: just CR. */
      text?: string | Uint8Array;
      delayMs?: number;
      printableOnly?: boolean;
    },
    ctx: OpContext = {},
  ): Promise<ScanResult<UartFinding>> {
    return this.op(async () => {
      const t0 = Date.now();
      const known = o.known ?? {};
      const anyKnown = Object.values(known).some((v) => v !== null && v !== undefined);
      let text = "";
      if (o.text instanceof Uint8Array) {
        if (o.text.length < 1 || o.text.length > 16) throw new DeviceError("UART scan data must be 1-16 bytes");
        text = "\\x" + [...o.text].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
      } else if (o.text) {
        if (o.text.length > 16) throw new DeviceError("UART scan text must be at most 16 characters");
        if (/[^\x20-\x7e]/.test(o.text)) throw new DeviceError("UART scan text must be printable ASCII (use bytes for anything else)");
        text = o.text;
      }
      const delay = o.delayMs ?? 10;
      if (delay < 0 || delay > 1000) throw new DeviceError("Delay must be 0-1000 ms");
      const r = await this.converse(
        "uart",
        "U",
        [
          ...channelRules(o),
          line(/Are any pins already known\? \[[yYnN]\/[yYnN]\]: $/, yn(anyKnown)),
          pinRules(known as Record<string, number | null | undefined>, true),
          // The firmware keeps the last string; an empty answer would reuse it, so
          // we need the default to be CR. Sending CR alone keeps the previous value,
          // which is only correct the first time. "\x0D" sends exactly a CR.
          line(/Enter text string to output \(prefix with \\x for hex\) \[.*\]: $/, text || "\\x0D"),
          line(/Enter delay before checking for target response \(in ms, 0 - 1000\) \[\d+\]: $/, String(delay)),
          line(/Ignore non-printable characters\? \[[yYnN]\/[yYnN]\]: $/, yn(!!o.printableOnly)),
          ...settingsRules(o.pinsLow),
          SPACE_TO_BEGIN,
        ],
        { ctx, parse: "uart", progress: (p) => ({ perTick: 1, total: p.permutations }) },
      );
      return this.result<UartFinding>(r, t0, ["uart"]);
    });
  }

  /**
   * Passive TXD scan: watches every channel for UART-like activity and measures
   * the baud rate. Runs until aborted or `durationMs` elapses.
   */
  uartTxdScan(
    o: { start: number; end: number; ignoreNonStandard?: boolean; durationMs?: number },
    ctx: OpContext = {},
  ): Promise<ScanResult<UartTxdFinding>> {
    return this.op(async () => {
      const t0 = Date.now();
      const ctl = linkedController(ctx.signal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const r = await this.converse(
        "uart",
        "T",
        [
          ...channelRules({ start: o.start, end: o.end }),
          line(/Ignore non-standard baud rates\? \[[yYnN]\/[yYnN]\]: $/, yn(!!o.ignoreNonStandard)),
          SPACE_TO_BEGIN,
        ],
        {
          ctx: { ...ctx, signal: ctl.signal },
          parse: "uart-txd",
          onRunning: () => {
            if (o.durationMs) timer = setTimeout(() => ctl.abort(), o.durationMs);
          },
        },
      ).finally(() => clearTimeout(timer));
      // Stopping this scan is the normal way to end it, not an error.
      return { ...this.result<UartTxdFinding>(r, t0, ["uart-txd"]), aborted: !!ctx.signal?.aborted };
    });
  }

  /**
   * Bridge the PC to the target UART. Resolves once passthrough is active; the
   * session stays locked until the handle is closed.
   */
  async uartPassthrough(
    o: { txd: number | null; rxd: number | null; baud: number; localEcho?: boolean },
    ctx: OpContext = {},
  ): Promise<PassthroughHandle> {
    if (o.txd === null && o.rxd === null) throw new DeviceError("Enable at least one of TXD / RXD");
    const release = await this.session.acquire();
    const s = this.session;
    try {
      const r = await this.converse(
        "uart",
        "P",
        [
          pinRules({ txd: o.txd, rxd: o.rxd }, true),
          line(/Enter baud rate \[\d+\]: $/, String(o.baud)),
          line(/Enable local echo\? \[[yYnN]\/[yYnN]\]: $/, yn(!!o.localEcho)),
        ],
        { ctx, handoff: /Entering UART passthrough! Press Ctrl-X to exit\.\.\.\r\n/ },
      );
      if (!r.handoff) throw new DeviceError(r.parser.messages.map((m) => m.text).join(" ") || "Passthrough did not start", r.transcript);
    } catch (e) {
      release();
      throw e;
    }
    this.setMenu(null);
    let resolveClosed!: () => void;
    const closed = new Promise<void>((r) => (resolveClosed = r));
    let closing = false;
    const listeners = new Set<(t: string) => void>();
    // Any rx text that arrived right after the banner is still in the buffer.
    const early = s.pending();
    s.flush();
    const unsub = s.rx.on((t) => {
      if (!closing) listeners.forEach((l) => l(t));
    });
    const unclose = s.closed.on(() => finish());
    const finish = () => {
      unsub();
      unclose();
      release();
      resolveClosed();
    };
    return {
      write: async (data) => {
        // Ctrl-X would end passthrough; never forward it from user data.
        const b = typeof data === "string" ? data.replaceAll(CAN, "") : data.filter((x) => x !== 0x18);
        await s.write(b);
      },
      onData: (cb) => {
        listeners.add(cb);
        if (early) cb(early);
        return () => listeners.delete(cb);
      },
      close: async () => {
        if (closing) return closed;
        closing = true;
        try {
          await s.write(CAN);
          const r = await s.expect(PROMPT, { timeout: 3000 });
          this.setMenu(this.menuFromPrompt(r.match[1]));
        } finally {
          finish();
        }
      },
      closed,
    };
  }

  // ---------------------------------------------------------------------- GPIO

  /** Read all 24 channels once. */
  gpioRead(ctx: OpContext = {}): Promise<GpioState> {
    return this.op(async () => {
      await this.goto("gpio", ctx.signal);
      const text = await this.command("R", ctx.signal);
      const v = parseGpioLine(text);
      if (v === null) throw new DeviceError(this.firstError(text) ?? "Could not read channels", text);
      return { value: v, bits: gpioBits(v) };
    });
  }

  private firstError(text: string) {
    const m = text.match(/(Target I\/O voltage must be defined!|Value out of range!|EEPROM not responding!)/);
    return m ? m[1] : null;
  }

  /** Continuously report channel changes until aborted or `durationMs` elapses. */
  gpioMonitor(o: { durationMs?: number; onChange?: (s: GpioState) => void } = {}, ctx: OpContext = {}): Promise<GpioState[]> {
    return this.op(async () => {
      const s = this.session;
      await this.goto("gpio", ctx.signal);
      const states: GpioState[] = [];
      let rest = "";
      const unsub = s.rx.on((t) => {
        rest += t;
        let m: RegExpExecArray | null;
        const re = /CH23\.\.CH0: [01 ]+\(0x([0-9A-Fa-f]{6})\)/g;
        let last = 0;
        while ((m = re.exec(rest))) {
          const v = parseInt(m[1], 16);
          const st = { value: v, bits: gpioBits(v) };
          states.push(st);
          o.onChange?.(st);
          last = re.lastIndex;
        }
        rest = rest.slice(last);
      });
      try {
        s.flush();
        await s.write("C" + CR);
        const started = await s.expect([/Press any key to abort\.\.\.\r\n/, PROMPT], { timeout: 5000 });
        if (started.index === 1) {
          this.setMenu(this.menuFromPrompt(started.match[1]));
          throw new DeviceError(this.firstError(started.before) ?? "Monitor did not start", started.before);
        }
        const ctl = linkedController(ctx.signal);
        const timer = o.durationMs ? setTimeout(() => ctl.abort(), o.durationMs) : undefined;
        try {
          await s.expect(PROMPT, { signal: ctl.signal });
        } catch (e) {
          if (!(e instanceof AbortedError) || !s.open) throw e;
          await s.write(" ");
          const r = await s.expect(PROMPT, { timeout: 5000 });
          this.setMenu(this.menuFromPrompt(r.match[1]));
        } finally {
          clearTimeout(timer);
        }
      } finally {
        unsub();
      }
      return states;
    });
  }

  /**
   * Drive all 24 channels with `value` (bit n = CH n). Outputs stay driven
   * until the handle is released (or `holdMs` elapses, if given).
   */
  async gpioWrite(value: number, o: { holdMs?: number } = {}, ctx: OpContext = {}): Promise<GpioWriteHandle> {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new DeviceError("Value must be 0x000000 - 0xFFFFFF");
    const release = await this.session.acquire();
    const s = this.session;
    try {
      const r = await this.converse(
        "gpio",
        "W",
        [line(/Enter value to output \(in hex\) \[[0-9A-Fa-f]+\]: $/, value.toString(16).toUpperCase())],
        { ctx, handoff: /Press any key when done\.\.\./ },
      );
      if (!r.handoff) throw new DeviceError(this.firstError(r.transcript) ?? "Write failed", r.transcript);
    } catch (e) {
      release();
      throw e;
    }
    let done = false;
    let resolveReleased!: () => void;
    const released = new Promise<void>((r) => (resolveReleased = r));
    const doRelease = async () => {
      if (done) return released;
      done = true;
      try {
        await s.write(" ");
        const r = await s.expect(PROMPT, { timeout: 3000 });
        this.setMenu(this.menuFromPrompt(r.match[1]));
      } finally {
        release();
        resolveReleased();
      }
    };
    if (o.holdMs !== undefined) setTimeout(() => void doRelease(), o.holdMs);
    ctx.signal?.addEventListener("abort", () => void doRelease(), { once: true });
    return { value, release: doRelease, released };
  }

  /**
   * Put the JTAGulator in logic analyzer (OLS/SUMP) mode. The serial link then
   * speaks SUMP until Ctrl-X. The mode persists across resets.
   */
  enterLogicAnalyzer(ctx: OpContext = {}): Promise<void> {
    return this.op(async () => {
      const r = await this.converse("gpio", "L", [], {
        ctx,
        handoff: /Entering logic analyzer mode! Press Ctrl-X to exit\.\.\./,
      });
      if (!r.handoff) throw new DeviceError(this.firstError(r.transcript) ?? "Device did not enter logic analyzer mode", r.transcript);
      // Let the note print and the firmware restart its serial port in SUMP mode.
      await sleep(400);
      this.session.flush();
      this.setMenu(null);
      this.setMode("sump");
    });
  }

  // ----------------------------------------------------------------------- SWD

  /** Find SWDIO / SWCLK by reading the DPIDR on every pin pair. */
  swdScan(o: ScanOptions, ctx: OpContext = {}): Promise<ScanResult<SwdFinding>> {
    return this.op(async () => {
      const t0 = Date.now();
      const r = await this.converse("swd", "I", [...channelRules(o), ...settingsRules(o.pinsLow), SPACE_TO_BEGIN], {
        ctx,
        parse: "swd",
        progress: (p) => ({ perTick: o.pinsLow ? 1 : 30, total: p.permutations }),
      });
      return this.result<SwdFinding>(r, t0, ["swd"]);
    });
  }

  /** Read the DPIDR with a known SWD pinout. */
  swdDeviceId(pins: { swdio: number; swclk: number }, ctx: OpContext = {}): Promise<SwdFinding | null> {
    return this.op(async () => {
      const r = await this.converse("swd", "D", [pinRules({ ...pins }, false)], { ctx, parse: "swd" });
      const res = this.result<SwdFinding>(r, Date.now(), ["swd"]);
      const f = res.findings[0];
      return f ? { ...f, swdio: pins.swdio, swclk: pins.swclk } : null;
    });
  }

  // ---------------------------------------------------------------------- misc

  /** Send raw text to the device (no locking; for the terminal). */
  raw(text: string | Uint8Array) {
    return this.session.write(text);
  }

  /** The menu prompt is gone after raw typing; re-sync before the next command. */
  invalidateMenu() {
    this.setMenu(null);
  }
}

export { latin1 };
