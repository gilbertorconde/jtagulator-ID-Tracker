// Streaming parser for the firmware's human-readable output. Feed it raw text as
// it arrives; it reports progress ticks and findings as soon as they're complete
// enough to show.
import { decodeDpidr, decodeJtag } from "./idcode";
import type { Finding, JtagFinding, SwdFinding, UartFinding } from "./types";

export type ParseMode = "jtag" | "rtck" | "swd" | "uart" | "uart-txd" | "irdr" | "extest" | "none";

export interface ParserCallbacks {
  onTick?: (ticks: number) => void;
  onPass?: (passes: number) => void;
  onFinding?: (id: number, f: Finding) => void;
  onLine?: (line: string) => void;
  onPermutations?: (n: number) => void;
  onMessage?: (level: "info" | "warn" | "error", text: string) => void;
}

const ERRORS: [RegExp, "warn" | "error"][] = [
  [/^No target device\(s\) found!$/, "warn"],
  [/^Value out of range!$/, "error"],
  [/^Pin numbers must be unique!$/, "error"],
  [/^Target I\/O voltage must be defined!$/, "error"],
  [/^More than one device detected in the chain!$/, "error"],
  [/^EEPROM not responding!$/, "error"],
  [/aborted!$/, "warn"],
];

export class OutputParser {
  ticks = 0;
  passes = 0;
  findings: Finding[] = [];
  messages: { level: "info" | "warn" | "error"; text: string }[] = [];
  permutations: number | null = null;
  /** Extra values seen in the output (IR length, BSR length, pattern match, ...). */
  values: Record<string, string> = {};

  private line = "";
  /** True while the current line has only progress characters in it. */
  private progressOnly = true;
  private current: Finding | null = null;
  private currentId = -1;
  private nextId = 0;
  private lastSwd: SwdFinding | null = null;

  constructor(public mode: ParseMode, private cb: ParserCallbacks = {}) {}

  feed(text: string) {
    for (const ch of text) {
      if (ch === "\n") {
        this.endLine();
        continue;
      }
      if (ch === "\r") continue;
      if (this.progressOnly && (ch === "-" || ch === "|")) {
        // Dashes are only progress when they aren't the start of "-> ..." detail lines.
        this.line += ch;
        continue;
      }
      if (this.progressOnly && ch === ">" && this.line.endsWith("-")) {
        // It was "->": give back the dash we were about to count.
        this.line += ch;
        this.progressOnly = false;
        continue;
      }
      if (this.progressOnly && this.line.length) this.commitProgress();
      this.progressOnly = false;
      this.line += ch;
    }
    // Count progress on partial lines so the bar moves while the scan runs. A trailing
    // dash is held back: it may be the start of a "->" detail line split across chunks.
    if (this.progressOnly && this.line.length > 1) this.commitProgress(true);
  }

  private commitProgress(keepLast = false) {
    const held = keepLast && this.line.endsWith("-") ? "-" : "";
    if (held) this.line = this.line.slice(0, -1);
    for (const c of this.line) {
      if (c === "-") this.ticks++;
      else if (c === "|") this.passes++;
    }
    if (this.line.includes("-")) this.cb.onTick?.(this.ticks);
    if (this.line.includes("|")) this.cb.onPass?.(this.passes);
    this.line = held;
  }

  private endLine() {
    if (this.progressOnly) {
      this.commitProgress();
    } else {
      const l = this.line.trim();
      if (l) this.handle(l);
    }
    this.line = "";
    this.progressOnly = true;
  }

  /** Flush the trailing partial line and any finding in progress. */
  finish() {
    this.endLine();
    this.flush();
  }

  private emit(f: Finding, id = this.currentId) {
    this.cb.onFinding?.(id, f);
  }

  private start(f: Finding) {
    this.flush();
    this.current = f;
    this.currentId = this.nextId++;
    this.findings.push(f);
  }

  private flush() {
    if (this.current) this.emit(this.current);
    this.current = null;
  }

  private handle(l: string) {
    this.cb.onLine?.(l);

    let m: RegExpMatchArray | null;
    if ((m = l.match(/^Possible permutations: (\d+)/))) {
      this.permutations = +m[1];
      this.cb.onPermutations?.(this.permutations);
      return;
    }
    for (const [re, level] of ERRORS) {
      if (re.test(l)) {
        this.messages.push({ level, text: l });
        this.cb.onMessage?.(level, l);
        return;
      }
    }
    if ((m = l.match(/^Instruction Register \(IR\) length: (\S+)/))) this.values.irLength = m[1];
    if ((m = l.match(/^Possible instructions: (\d+)/))) this.values.instructions = m[1];
    if ((m = l.match(/^Boundary Scan Register length: (\S+)/))) this.values.bsrLength = m[1];
    if ((m = l.match(/^Pattern in to TDI:\s+([01]+)/))) this.values.patternIn = m[1];
    if ((m = l.match(/^Pattern out from TDO:\s+([01]+)/))) this.values.patternOut = m[1];
    if (/^(No )?Match!$/.test(l)) this.values.match = l === "Match!" ? "yes" : "no";
    if ((m = l.match(/^Number of devices detected: (\d+)/))) {
      this.values.deviceCount = m[1];
      if (this.current?.kind === "jtag") {
        this.current.deviceCount = +m[1];
        this.emit(this.current);
      }
      return;
    }

    switch (this.mode) {
      case "jtag":
        return this.jtag(l);
      case "rtck":
        return this.rtck(l);
      case "swd":
        return this.swd(l);
      case "uart":
      case "uart-txd":
        return this.uart(l);
      case "irdr":
        if ((m = l.match(/^IR: ([01 ]+)\(0x([0-9A-Fa-f]+)\) -> DR: (\d+)/))) {
          this.start({ kind: "irdr", irBits: m[1].replace(/\s+/g, ""), ir: parseInt(m[2], 16), dr: +m[3] });
          this.flush();
        }
        return;
      case "extest":
        if ((m = l.match(/^CH(\d+) -> Register bit: (\d+)/))) {
          this.start({ kind: "extest", channel: +m[1], bit: +m[2] });
          this.flush();
        }
        return;
    }
  }

  private jtag(l: string) {
    let m: RegExpMatchArray | null;
    const cur = this.current?.kind === "jtag" ? (this.current as JtagFinding) : null;
    if ((m = l.match(/^TDI: (\d+|N\/A)$/))) {
      this.start({ kind: "jtag", tdi: m[1] === "N/A" ? null : +m[1], tdo: -1, tck: -1, tms: -1, trst: [], devices: [] });
    } else if (cur && (m = l.match(/^(TDO|TCK|TMS): (\d+)$/))) {
      cur[m[1].toLowerCase() as "tdo" | "tck" | "tms"] = +m[2];
      if (m[1] === "TMS") this.emit(cur);
    } else if ((m = l.match(/^Device ID #(\d+): .*\(0x([0-9A-Fa-f]{8})\)/))) {
      let f = cur;
      if (!f) {
        // "Get Device ID(s)" prints IDs without a pinout header.
        this.start({ kind: "jtag", tdi: null, tdo: -1, tck: -1, tms: -1, trst: [], devices: [] });
        f = this.current as JtagFinding;
      }
      f.devices.push({ index: +m[1], idcode: decodeJtag(parseInt(m[2], 16)) });
      this.emit(f);
    } else if (cur && (m = l.match(/^-> Manufacturer ?: ?(.*)$/))) {
      const d = cur.devices[cur.devices.length - 1];
      if (d) d.firmwareManufacturer = m[1].trim();
      this.emit(cur);
    } else if (cur && (m = l.match(/^TRST#: (\d+)$/))) {
      cur.trst.push(+m[1]);
      this.emit(cur);
    }
  }

  private rtck(l: string) {
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^TCK: (\d+)$/))) {
      this.start({ kind: "rtck", tck: +m[1], rtck: -1 });
    } else if (this.current?.kind === "rtck" && (m = l.match(/^RTCK: (\d+)$/))) {
      this.current.rtck = +m[1];
      this.flush();
    }
  }

  private swd(l: string) {
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^SWDIO: (\d+)$/))) {
      this.start({ kind: "swd", swdio: +m[1], swclk: -1, dpidr: null });
      this.lastSwd = this.current as SwdFinding;
    } else if (this.current?.kind === "swd" && (m = l.match(/^SWCLK: (\d+)$/))) {
      this.current.swclk = +m[1];
      this.emit(this.current);
    } else if ((m = l.match(/^Device ID #\d+: .*\(0x([0-9A-Fa-f]{8})\)/))) {
      let f = this.current?.kind === "swd" ? this.current : null;
      if (!f) {
        // "Get Device ID" (known pinout) prints the ID without a pinout header.
        this.start({ kind: "swd", swdio: -1, swclk: -1, dpidr: null });
        f = this.current as SwdFinding;
        this.lastSwd = f;
      }
      f.dpidr = decodeDpidr(parseInt(m[1], 16));
      this.emit(f);
    } else if (this.lastSwd && (m = l.match(/^-> Manufacturer ?: ?(.*)$/))) {
      this.lastSwd.firmwareManufacturer = m[1].trim();
      this.emit(this.lastSwd, this.findings.indexOf(this.lastSwd));
    }
  }

  private uart(l: string) {
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^TXD: (\d+)$/))) {
      if (this.mode === "uart-txd") this.start({ kind: "uart-txd", txd: +m[1], measuredBaud: 0, bestFit: null });
      else this.start({ kind: "uart", txd: +m[1], rxd: null, baud: 0 });
      return;
    }
    const cur = this.current;
    if (cur?.kind === "uart") {
      if ((m = l.match(/^RXD: (\d+)$/))) cur.rxd = +m[1];
      else if ((m = l.match(/^Baud: (\d+)$/))) cur.baud = +m[1];
      else if ((m = l.match(/^Data: (.*) \[ ((?:[0-9A-Fa-f]{2} )*)\]$/))) {
        const u = cur as UartFinding;
        u.ascii = m[1];
        u.hex = m[2].trim() ? m[2].trim().split(/\s+/).map((h) => parseInt(h, 16)) : [];
        this.flush();
      }
    } else if (cur?.kind === "uart-txd") {
      if ((m = l.match(/^Baud \(Measured\): (\d+)$/))) cur.measuredBaud = +m[1];
      else if ((m = l.match(/^Baud \(Best Fit\): (\d+|N\/A)$/))) {
        cur.bestFit = m[1] === "N/A" ? null : +m[1];
        this.flush();
      }
    }
  }
}

/** Parse "CH23..CH0: 11111111 11111111 11111111  (0xFFFFFF)". */
export function parseGpioLine(l: string): number | null {
  const m = l.match(/CH23\.\.CH0: [01 ]+\(0x([0-9A-Fa-f]{6})\)/);
  return m ? parseInt(m[1], 16) : null;
}
