// A software model of the JTAGulator firmware's serial UI (JTAGulator.spin) wired
// to a virtual target board. It reproduces the prompts, echo behavior, output
// formats and progress characters closely enough to develop and test the app
// without hardware.
import jep106 from "../data/jep106.json";

const CR = "\r";
const LF = "\n";
const CAN = 0x18;
const PROP_SDA = 29;
const MAX_CHAN = 24;

export interface SimTarget {
  jtag?: {
    tdi: number;
    tdo: number;
    tck: number;
    tms: number;
    trst?: number;
    idcodes: number[];
    irLength: number;
    /** DR length per instruction; anything missing is BYPASS (1 bit). */
    drLengths?: Record<number, number>;
    extest?: number;
    /** Boundary scan register bit -> JTAGulator channel it drives. */
    bsrMap?: Record<number, number>;
    bsrLength?: number;
  };
  rtck?: { tck: number; rtck: number };
  swd?: { swdio: number; swclk: number; dpidr: number };
  uart?: { txd: number; rxd: number; baud: number; reply: string };
  /** Base level of the channels when read as inputs. */
  gpio?: number;
}

export const DEFAULT_TARGET: SimTarget = {
  jtag: {
    tdi: 3,
    tdo: 5,
    tck: 2,
    tms: 4,
    trst: 7,
    idcodes: [0x4ba00477, 0x06413041],
    irLength: 4,
    drLengths: { 0x0: 32, 0x1: 32, 0x2: 32, 0x3: 32, 0x8: 35, 0xa: 35, 0xb: 35, 0xe: 32 },
    extest: 0x0,
    bsrLength: 64,
    bsrMap: { 10: 12, 23: 13, 40: 14 },
  },
  rtck: { tck: 2, rtck: 6 },
  swd: { swdio: 9, swclk: 8, dpidr: 0x2ba01477 },
  uart: { txd: 16, rxd: 17, baud: 115200, reply: "\r\nU-Boot 2016.09 (Mar 03 2021)\r\n=> " },
  gpio: 0xff0f3c,
};

const BAUDS = [300, 600, 1200, 1800, 2400, 3600, 4800, 7200, 9600, 14400, 19200, 28800, 31250, 38400, 57600, 76800, 115200, 153600, 230400, 250000, 307200];

const STR = {
  initHeader:
    CR + LF + LF +
    "                                    UU  LLL\r\n" +
    " JJJ  TTTTTTT AAAAA  GGGGGGGGGGG   UUUU LLL   AAAAA TTTTTTTT OOOOOOO  RRRRRRRRR\r\n" +
    " JJJJ TTTTTTT AAAAAA GGGGGGG       UUUU LLL  AAAAAA TTTTTTTT OOOOOOO  RRRRRRRR\r\n" +
    " JJJJ  TTTT  AAAAAAA GGG      UUU  UUUU LLL  AAA AAA   TTT  OOOO OOO  RRR RRR\r\n" +
    " JJJJ  TTTT  AAA AAA GGG  GGG UUUU UUUU LLL AAA  AAA   TTT  OOO  OOO  RRRRRRR\r\n" +
    " JJJJ  TTTT  AAA  AA GGGGGGGGG UUUUUUUU LLLLLLLL AAAA  TTT OOOOOOOOO  RRR RRR\r\n" +
    "  JJJ  TTTT AAA   AA GGGGGGGGG UUUUUUUU LLLLLLLLL AAA  TTT OOOOOOOOO  RRR RRR\r\n" +
    "  JJJ  TT                  GGG             AAA                         RR RRR\r\n" +
    " JJJ                        GG             AA                              RRR\r\n" +
    "JJJ                          G             A                                 RR\r\n\n\n" +
    "           Welcome to JTAGulator. Press 'H' for available commands.\r\n" +
    "         Warning: Use of this tool may affect target system behavior!",
  version:
    "\r\nJTAGulator FW PinHound 1.4 (simulated)\r\nDesigned by Joe Grand, Grand Idea Studio, Inc.\r\nID database: Weiao (Chaoschaos1024)\r\nMain: jtagulator.com\r\nSource: github.com/gilbertorconde/pinhound",
  menuMain:
    "\r\nTarget Interfaces:\r\nJ   JTAG\r\nU   UART\r\nG   GPIO\r\nS   SWD\r\nA   All (GPIO, JTAG, SWD, UART)\r\n\nGeneral Commands:\r\nV   Set target I/O voltage\r\nI   Display version information\r\nH   Display available commands",
  menuJTAG:
    "\r\nJTAG Commands:\r\nJ   Identify JTAG pinout (Combined Scan)\r\nI   Identify JTAG pinout (IDCODE Scan)\r\nB   Identify JTAG pinout (BYPASS Scan)\r\nR   Identify RTCK (adaptive clocking)\r\nD   Get Device ID(s)\r\nT   Test BYPASS (TDI to TDO)\r\nY   Instruction/Data Register (IR/DR) discovery\r\nP   Pin mapper (EXTEST Scan)\r\nO   OpenOCD interface",
  menuUART: "\r\nUART Commands:\r\nU   Identify UART pinout\r\nT   Identify UART pinout (TXD only, continuous)\r\nP   UART passthrough",
  menuGPIO:
    "\r\nGPIO Commands:\r\nR   Read all channels (input, one shot)\r\nC   Read all channels (input, continuous)\r\nW   Write all channels (output)\r\nL   Logic analyzer (OLS/SUMP)",
  menuSWD: "\r\nSWD Commands:\r\nI   Identify SWD pinout (IDCODE Scan)\r\nD   Get Device ID",
  menuShared: "\r\n\nGeneral Commands:\r\nV   Set target I/O voltage\r\nH   Display available commands\r\nM   Return to main menu",
  pressSpaceBegin: "\r\nPress spacebar to begin (any other key besides Enter to abort)...",
  pressSpaceContinue: "Press spacebar to continue (any other key to abort)...",
  jtagulating: "\r\nJTAGulating! Press any key to abort...\r\n",
  devicesDetected: "Number of devices detected: ",
  unknownPin: "\r\nEnter X for any unknown pin.",
  scanComplete: " scan complete.",
  idcodeDisplayComplete: "\r\nIDCODE listing complete.",
  irLength: "Instruction Register (IR) length: ",
  uartPinout: "\r\nNote: UART pin naming is from the target's perspective.",
  swdWarning:
    "\r\nWarning: The JTAGulator's front-end circuitry is incompatible w/\r\nmany SWD-based target devices. Detection results may be affected.\r\nVisit github.com/grandideastudio/jtagulator/wiki/Hardware-Modifications\r\nfor details.\r\n",
  modeWarning:
    "\r\nWarning: This mode persists through JTAGulator resets, power cycles,\r\nand firmware updates. It can only be exited manually by the user.\r\n",
  sumpNote: "\r\n\nNote: Switch to analyzer software and use Openbench Logic Sniffer driver @ 115.2kbps\r\n",
  ocdNote: '\r\n\nExample: openocd -f interface/buspirate.cfg -c "transport select jtag; buspirate port /dev/ttyUSB0"\r\n',
  spacer: "\r\n\n-----",
  errTargetIO: "\r\nTarget I/O voltage must be defined!",
  errRange: "\r\nValue out of range!",
  errCollision: "\r\nPin numbers must be unique!",
  errNoDevice: "\r\nNo target device(s) found!",
  errTooMany: "\r\nMore than one device detected in the chain!",
  errJTAGAborted: "\r\nJTAG combined scan aborted!",
  errIDCODEAborted: "\r\nIDCODE scan aborted!",
  errBYPASSAborted: "\r\nBYPASS scan aborted!",
  errRTCKAborted: "\r\nRTCK scan aborted!",
  errUARTAborted: "\r\nUART scan aborted!",
  errEXTESTAborted: "\r\nPin mapper aborted!",
  errDiscoveryAborted: "\r\nIR/DR discovery aborted!",
};

class Abort extends Error {}

const bin = (v: number, n: number) => ((v >>> 0) & (n >= 32 ? 0xffffffff : (1 << n) - 1)).toString(2).padStart(n, "0");
const hexs = (v: number, n: number) => (v >>> 0).toString(16).toUpperCase().padStart(n, "0").slice(-n);
const field = (v: number, hi: number, lo: number) => (v >>> lo) & (hi - lo + 1 >= 32 ? 0xffffffff : (1 << (hi - lo + 1)) - 1);
const roundUp = (n: number) => Math.ceil(n / 4) * 4;

/** Handler for the logic analyzer (SUMP) binary protocol while in that mode. */
export interface SumpHandler {
  feed(b: number, out: (bytes: Uint8Array) => void): void;
  reset?(): void;
}

export type SimMode = "normal" | "sump" | "ocd";

export class SimFirmware {
  target: SimTarget;
  /** Iterations per yield are scaled so a full scan takes about this long. */
  scanSeconds = 3;
  sump: SumpHandler | null = null;

  private input: number[] = [];
  private inputWaiter: (() => void) | null = null;
  private out: (bytes: Uint8Array) => void = () => {};
  private running = false;
  private generation = 0;
  private mode: SimMode = "normal";
  private persistedMode: SimMode = "normal";

  // Firmware globals (JTAGulator.spin VAR section)
  private vTargetIO = -1;
  private persistedVTarget = -1;
  private idMenu = 0;
  private chStart = 0;
  private chEnd = 0;
  private pinsLow = 0;
  private pinsLowDelay = 100;
  private pinsHighDelay = 100;
  private j = { tdi: 0, tdo: 0, tck: 0, tms: 0 };
  private jPinsKnown = 0;
  private jIgnoreReg = 1;
  private jIR = 0;
  private jDRFill = 0;
  private jLoopPause = 0;
  private u = { txd: 0, rxd: 0, baud: 0 };
  private uSTR: number[] = [];
  private uHex = 0;
  private uPrintable = 0;
  private uPinsKnown = 0;
  private uWaitDelay = 10;
  private uBaudIgnore = 0;
  private uLocalEcho = 0;
  private gWriteValue = 0xffffff;
  private gOut: number | null = null;
  private swdClk = 0;
  private swdIo = 0;

  constructor(target: SimTarget = DEFAULT_TARGET) {
    this.target = structuredClone(target);
  }

  /** Connect the simulated USB serial line. */
  attach(out: (bytes: Uint8Array) => void) {
    this.out = out;
  }

  /** Power-on / DTR reset. */
  reset() {
    this.generation++;
    this.input = [];
    this.wake();
    this.running = false;
    this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    this.main(gen).catch((e) => {
      if (!(e instanceof Abort)) console.error("sim firmware crashed", e);
    });
  }

  /** Bytes from the PC. */
  write(data: Uint8Array) {
    for (const b of data) {
      if (this.mode === "sump") this.sumpByte(b);
      else if (this.mode === "ocd") this.ocdByte(b);
      else this.input.push(b);
    }
    this.wake();
  }

  /** Current level of every channel as seen by the JTAGulator. */
  channels(t = Date.now()): number {
    if (this.gOut !== null) return this.gOut;
    let v = this.target.gpio ?? 0xffffff;
    // A UART TX line idles high and toggles while "printing" a boot log.
    const u = this.target.uart;
    if (u && Math.floor(t / 700) % 3 === 0) v ^= (Math.floor(t / 90) & 1) << u.txd;
    // A slow heartbeat on CH0.
    v = (v & ~1) | (Math.floor(t / 1000) & 1);
    return v & 0xffffff;
  }

  // ---------------------------------------------------------------- plumbing

  private wake() {
    const w = this.inputWaiter;
    this.inputWaiter = null;
    w?.();
  }

  private print(s: string) {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    this.out(b);
  }

  private dec(n: number) {
    this.print(String(n));
  }

  private async rx(gen: number): Promise<number> {
    for (;;) {
      if (gen !== this.generation) throw new Abort();
      if (this.input.length) return this.input.shift()!;
      await new Promise<void>((r) => (this.inputWaiter = r));
    }
  }

  private rxEmpty() {
    return this.input.length === 0;
  }

  private rxFlush() {
    this.input = [];
  }

  private async pause(ms: number, gen: number) {
    await new Promise((r) => setTimeout(r, ms));
    if (gen !== this.generation) throw new Abort();
  }

  /** PropSerial.CharIn: read a key, echo printable/CR/LF, otherwise ".". */
  private async charIn(gen: number) {
    const c = await this.rx(gen);
    if (c === 13 || c === 10 || (c >= 0x20 && c <= 0x7e)) this.print(String.fromCharCode(c));
    else this.print(".");
    return c;
  }

  /** PropSerial.StrInMax: CR-terminated line with echo and backspace. */
  private async strIn(gen: number, max: number): Promise<string> {
    let s = "";
    for (;;) {
      const c = await this.rx(gen);
      if (c === 13) {
        if (s.length < max) this.print(CR);
        return s;
      }
      if (c === 8) {
        if (s.length) {
          s = s.slice(0, -1);
          this.print("\b \b");
        }
      } else if (s.length < max && c !== 10) {
        this.print(String.fromCharCode(c));
        s += String.fromCharCode(c);
      }
    }
  }

  private async getPin(gen: number): Promise<number> {
    const s = await this.strIn(gen, 8);
    if (s === "") return -1;
    if (s[0] === "X" || s[0] === "x") return s.length > 1 ? -3 : -2;
    return this.parseDec(s);
  }

  private async getDecimal(gen: number): Promise<number> {
    const s = await this.strIn(gen, 8);
    if (s === "") return -1;
    return this.parseDec(s);
  }

  private parseDec(s: string) {
    let v = 0;
    for (const ch of s) {
      if (ch >= "0" && ch <= "9") v = v * 10 + (ch.charCodeAt(0) - 48);
      else if (ch === "." || ch === ",") continue;
      else return -3;
    }
    return v;
  }

  /** y/N style question. Returns the new flag or null on invalid input. */
  private async askYN(gen: number, text: string, cur: number, yes = "Y", no = "N"): Promise<number | null> {
    this.print(text);
    this.print(cur === 0 ? `${yes.toLowerCase()}/${no}]: ` : `${yes}/${no.toLowerCase()}]: `);
    const s = await this.strIn(gen, 8);
    if (s.length > 1) return this.print(STR.errRange), null;
    if (s === "") return cur;
    const c = s.toUpperCase();
    if (c === no) return 0;
    if (c === yes) return 1;
    this.print(STR.errRange);
    return null;
  }

  private async waitForSpace(gen: number, err: string): Promise<boolean> {
    this.print(STR.pressSpaceBegin);
    for (;;) {
      const c = await this.rx(gen);
      if (c === 10 || c === 13) continue;
      if (c !== 32) {
        this.print(err);
        return false;
      }
      return true;
    }
  }

  // ------------------------------------------------------------------ program

  private async main(gen: number) {
    this.mode = this.persistedMode;
    if (this.mode === "sump" || this.mode === "ocd") {
      this.vTargetIO = this.persistedVTarget;
      // Waits for the PC in binary mode; leaving it returns to the menu loop.
      await new Promise<void>((r) => (this.exitBinary = r));
      if (gen !== this.generation) return;
      this.idMenu = this.mode === "sump" ? 3 : 1;
      this.finishBinary();
    } else {
      this.setDefaults();
      await this.charIn(gen);
      this.print(STR.initHeader);
    }
    for (;;) {
      this.print("\r\n\n" + ["", "JTAG", "UART", "GPIO", "SWD"][this.idMenu] + "> ");
      const cmd = await this.strIn(gen, 8);
      if (cmd.length !== 1) {
        this.print("\r\n? Press 'H' for available commands.");
        continue;
      }
      await this.dispatch(gen, cmd.toUpperCase());
      if (this.mode !== "normal") {
        await new Promise<void>((r) => (this.exitBinary = r));
        if (gen !== this.generation) return;
        this.finishBinary();
      }
    }
  }

  private exitBinary: (() => void) | null = null;

  private finishBinary() {
    const was = this.mode;
    this.mode = "normal";
    this.persistedMode = "normal";
    this.input = [];
    this.print(was === "sump" ? "\r\nLogic analyzer mode complete." : "\r\nOpenOCD mode complete.");
  }

  private setDefaults() {
    this.vTargetIO = -1;
    this.j = { tdi: 0, tdo: 0, tck: 0, tms: 0 };
  }

  private needVoltage() {
    if (this.vTargetIO === -1) {
      this.print(STR.errTargetIO);
      return false;
    }
    return true;
  }

  private async dispatch(gen: number, c: string) {
    const m = this.idMenu;
    const shared = async () => {
      if (c === "V") return this.setVoltage(gen);
      if (c === "H") return this.help();
      if (c === "M") return void (this.idMenu = 0);
      this.print("\r\n? Press 'H' for available commands.");
    };
    if (m === 0) {
      if (c === "J") this.idMenu = 1;
      else if (c === "U") this.idMenu = 2;
      else if (c === "G") this.idMenu = 3;
      else if (c === "S") this.idMenu = 4;
      else if (c === "A") {
        if (!this.needVoltage()) return;
        this.readIO();
        this.print(STR.spacer);
        await this.idcodeScan(gen, 1);
        this.print(STR.spacer);
        await this.idcodeScan(gen, 0);
        this.print(STR.spacer);
        await this.bypassScan(gen);
        this.print(STR.spacer);
        await this.rtckScan(gen);
        this.print(STR.spacer);
        await this.swdScan(gen);
        this.print(STR.spacer);
        await this.uartScanTxd(gen);
        this.print(STR.spacer);
        await this.uartScan(gen);
      } else if (c === "V") await this.setVoltage(gen);
      else if (c === "I") this.print(STR.version);
      else if (c === "H") this.help();
      else this.print("\r\n? Press 'H' for available commands.");
      return;
    }
    const table: Record<number, Record<string, () => Promise<unknown> | void>> = {
      1: {
        J: () => this.idcodeScan(gen, 1),
        I: () => this.idcodeScan(gen, 0),
        B: () => this.bypassScan(gen),
        R: () => this.rtckScan(gen),
        D: () => this.idcodeKnown(gen),
        T: () => this.bypassKnown(gen),
        Y: () => this.opcodeDiscovery(gen),
        P: () => this.extestScan(gen),
        O: () => this.openOcd(gen),
      },
      2: { U: () => this.uartScan(gen), T: () => this.uartScanTxd(gen), P: () => this.uartPassthrough(gen) },
      3: { R: () => this.readIO(), C: () => this.monitorIO(gen), W: () => this.writeIO(gen), L: () => this.logic(gen) },
      4: { I: () => this.swdScan(gen), D: () => this.swdKnown(gen) },
    };
    const fn = table[m]?.[c];
    if (fn) {
      if (!this.needVoltage()) return;
      await fn();
    } else await shared();
  }

  private help() {
    this.print([STR.menuMain, STR.menuJTAG, STR.menuUART, STR.menuGPIO, STR.menuSWD][this.idMenu]);
    if (this.idMenu !== 0) this.print(STR.menuShared);
  }

  private voltageText() {
    return this.vTargetIO === -1 ? "Undefined" : `${Math.floor(this.vTargetIO / 10)}.${this.vTargetIO % 10}`;
  }

  private async setVoltage(gen: number) {
    this.print("\r\nCurrent target I/O voltage: " + this.voltageText());
    this.print("\r\nEnter new target I/O voltage (1.4 - 3.3, 0 for off): ");
    let v = await this.getDecimal(gen);
    if (v === 2) v = 20;
    if (v === 3) v = 30;
    if (v === 0) {
      this.vTargetIO = -1;
      this.print("\r\nTarget I/O voltage off.");
    } else if (v < 14 || v > 33) this.print(STR.errRange);
    else {
      this.vTargetIO = v;
      this.print("\r\nNew target I/O voltage set: " + this.voltageText());
      this.print("\r\nWarning: Ensure VADJ is NOT connected to target!");
    }
  }

  // -------------------------------------------------------------- scan support

  private async getChannels(gen: number, min: number): Promise<boolean> {
    this.print("\r\nEnter starting channel [" + this.chStart + "]: ");
    let xs = await this.getDecimal(gen);
    if (xs === -1) xs = this.chStart;
    if (xs < 0 || xs > MAX_CHAN - 1) return this.print(STR.errRange), false;
    this.print("\r\nEnter ending channel [" + (this.chEnd < xs ? xs : this.chEnd) + "]: ");
    let xe = await this.getDecimal(gen);
    if (xe === -1) xe = this.chEnd < xs ? xs : this.chEnd;
    if (xe < xs + min - 1 || xe > MAX_CHAN - 1) return this.print(STR.errRange), false;
    this.chStart = xs;
    this.chEnd = xe;
    return true;
  }

  private async getSettings(gen: number): Promise<boolean> {
    const v = await this.askYN(gen, "\r\n\nBring channels LOW before each permutation? [", this.pinsLow);
    if (v === null) return false;
    this.pinsLow = v;
    if (v === 1) {
      this.print("\r\nEnter length of time for channels to remain LOW (in ms, 1 - 1000) [" + this.pinsLowDelay + "]: ");
      let x = await this.getDecimal(gen);
      if (x !== -1) {
        if (x < 1 || x > 1000) return this.print(STR.errRange), false;
        this.pinsLowDelay = x;
      }
      this.print("\r\nEnter length of time after channels return HIGH before proceeding (in ms, 1 - 1000) [" + this.pinsHighDelay + "]: ");
      x = await this.getDecimal(gen);
      if (x !== -1) {
        if (x < 1 || x > 1000) return this.print(STR.errRange), false;
        this.pinsHighDelay = x;
      }
    }
    return true;
  }

  private permutations(n: number, r: number) {
    let v = 1;
    for (let i = n - r + 1; i <= n; i++) v *= i;
    this.print("\r\nPossible permutations: " + v);
    return v;
  }

  /** Paces long loops so a scan of `total` iterations takes about scanSeconds. */
  private pacer(total: number, gen: number) {
    const yields = Math.max(1, Math.round(this.scanSeconds * 200));
    const every = Math.max(1, Math.round(total / yields));
    let i = 0;
    return async () => {
      if (++i % every === 0) await this.pause(5, gen);
      return !this.rxEmpty();
    };
  }

  private progress(ctr: number, mod: number, char: boolean) {
    if (char && ctr % mod === 0) this.print("-");
  }

  private displayJtagPins() {
    this.print("\r\nTDI: " + (this.j.tdi >= MAX_CHAN ? "N/A" : this.j.tdi));
    this.print("\r\nTDO: " + this.j.tdo);
    this.print("\r\nTCK: " + this.j.tck);
    this.print("\r\nTMS: " + this.j.tms);
    this.print("\r\n");
  }

  private shortName(bank: number, code: number) {
    const n = (jep106 as string[])[bank * 126 + code - 1] ?? "";
    return n.slice(0, 16);
  }

  private displayDeviceId(value: number, num: number, details: number, jtag: boolean) {
    value >>>= 0;
    if (value === 0xffffffff || (value & 1) !== 1) return;
    if (details >= 1) this.print("\r\n\n");
    this.print("Device ID #" + num + ": ");
    if (jtag) {
      this.print(`${bin(field(value, 31, 28), 4)} ${bin(field(value, 27, 12), 16)} ${bin(field(value, 11, 1), 11)} ${bin(value & 1, 1)}`);
    } else {
      this.print(
        `${bin(field(value, 31, 28), 4)} ${bin(field(value, 27, 20), 8)} ${bin(field(value, 19, 17), 3)} ${bin(field(value, 15, 12), 4)} ${bin(field(value, 11, 1), 11)} ${bin(value & 1, 1)}`,
      );
    }
    this.print(" (0x" + hexs(value, 8) + ")");
    const name = () => "\r\n-> Manufacturer : " + this.shortName(field(value, 11, 8), field(value, 7, 1));
    if (details === 1) {
      this.print("\r\n-> Manufacturer ID: 0x" + hexs(field(value, 11, 1), 3));
      this.print(name());
      this.print("\r\n-> Part Number: 0x" + hexs(field(value, 27, 12), 4));
      this.print("\r\n-> Version: 0x" + hexs(field(value, 31, 28), 1));
    } else if (details === 2) {
      this.print("\r\n-> DPIDR: 0x" + hexs(value, 8));
      this.print("\r\n-> Designer: 0x" + hexs(field(value, 11, 1), 3));
      this.print(name());
      this.print("\r\n-> Revision: 0x" + hexs(field(value, 31, 28), 1));
      this.print("\r\n-> Part Num: 0x" + hexs(field(value, 27, 20), 2));
      this.print("\r\n-> ADI Version: v5." + (field(value, 15, 12) - 1));
    }
    this.print("\r\n");
  }

  private jtagMatches(tdo: number, tck: number, tms: number) {
    const t = this.target.jtag;
    return !!t && tdo === t.tdo && tck === t.tck && tms === t.tms;
  }

  private jtagIds(): number[] {
    return this.target.jtag?.idcodes ?? [];
  }

  // ---------------------------------------------------------------------- JTAG

  private async idcodeScan(gen: number, type: 0 | 1) {
    const n = () => this.chEnd - this.chStart + 1;
    if (!(await this.getChannels(gen, type === 0 ? 3 : 4))) return;
    this.permutations(n(), type === 0 ? 3 : 4);
    if (!(await this.getSettings(gen))) return;
    const err = type === 0 ? STR.errIDCODEAborted : STR.errJTAGAborted;
    if (!(await this.waitForSpace(gen, err))) return;
    this.print(STR.jtagulating);
    const t = this.target.jtag;
    const { chStart: s, chEnd: e } = this;
    const step = this.pacer(n() * (n() - 1) * (n() - 2), gen);
    let num = 0;
    let ctr = 0;
    const found = { tdi: 0, tdo: 0, tck: 0, tms: 0 };
    const mod = this.pinsLow ? 1 : 100;
    const aborted = () => {
      this.cleanup(num, type === 0 ? { ...found, tdi: 0 } : found);
      this.print(err);
      this.rxFlush();
    };
    for (let tdo = s; tdo <= e; tdo++)
      for (let tck = s; tck <= e; tck++) {
        if (tck === tdo) continue;
        for (let tms = s; tms <= e; tms++) {
          if (tms === tck || tms === tdo) continue;
          if (await step()) return aborted();
          if (this.pinsLow) await this.pause(Math.min(5, this.pinsLowDelay + this.pinsHighDelay), gen);
          let match = false;
          if (this.jtagMatches(tdo, tck, tms) && t) {
            this.j = { tdi: PROP_SDA, tdo, tck, tms };
            if (type === 0) {
              this.displayJtagPins();
              num++;
              Object.assign(found, { tdo, tck, tms });
              this.jPinsKnown = 1;
              this.jtagIds().forEach((id, i) => this.displayDeviceId(id, i + 1, 0, true));
              match = true;
            } else {
              for (let tdi = s; tdi <= e; tdi++) {
                if (tdi === tms || tdi === tck || tdi === tdo) continue;
                if (await step()) return aborted();
                if (tdi === t.tdi) {
                  this.j = { tdi, tdo, tck, tms };
                  this.displayJtagPins();
                  num++;
                  Object.assign(found, { tdi, tdo, tck, tms });
                  this.jPinsKnown = 1;
                  match = true;
                  this.jtagIds().forEach((id, i) => this.displayDeviceId(id, i + 1, 0, true));
                  break;
                }
                this.progress(++ctr, mod, true);
              }
            }
            if (match) {
              for (let trst = s; trst <= e; trst++) {
                if ([tms, tck, tdo, this.j.tdi].includes(trst)) continue;
                if (await step()) return aborted();
                if (trst === t.trst) this.print("TRST#: " + trst + "\r\n");
                ++ctr;
              }
              this.print("\r\n");
            }
          }
          this.progress(++ctr, mod, true);
        }
      }
    if (num === 0) {
      this.print(STR.errNoDevice);
      this.jPinsKnown = 0;
    }
    this.cleanup(num, type === 0 ? { ...found, tdi: 0 } : found);
    this.print(type === 0 ? "\r\nIDCODE" : "\r\nJTAG combined");
    this.print(STR.scanComplete);
  }

  private cleanup(num: number, f: { tdi: number; tdo: number; tck: number; tms: number }) {
    this.j = num === 0 ? { tdi: 0, tdo: 0, tck: 0, tms: 0 } : { ...f };
  }

  private async partialJtag(gen: number): Promise<{ tdi: number; tdo: number; tck: number; tms: number } | null> {
    const out = { tdi: 0, tdo: 0, tck: 0, tms: 0 };
    for (const k of ["tdi", "tdo", "tck", "tms"] as const) {
      this.print(`\r\nEnter ${k.toUpperCase()} pin [${this.j[k]}]: `);
      let v = await this.getPin(gen);
      if (v === -1) v = this.j[k];
      if (v < -2 || v > this.chEnd) return this.print(STR.errRange), null;
      out[k] = v;
    }
    const known = Object.values(out).filter((v) => v !== -2);
    if (new Set(known).size !== known.length) return this.print(STR.errCollision), null;
    this.j = { ...out };
    return out;
  }

  private async bypassScan(gen: number) {
    if (!(await this.getChannels(gen, 4))) return;
    const s = this.chStart;
    const e = this.chEnd;
    const r: Record<string, [number, number]> = { tdi: [s, e], tdo: [s, e], tck: [s, e], tms: [s, e] };
    let num = 4;
    const known = await this.askYN(gen, "\r\nAre any pins already known? [", this.jPinsKnown);
    if (known === null) return;
    this.jPinsKnown = known;
    if (known === 1) {
      this.print(STR.unknownPin);
      const p = await this.partialJtag(gen);
      if (!p) return;
      for (const k of ["tdi", "tdo", "tms", "tck"] as const) {
        if (p[k] !== -2) {
          r[k] = [p[k], p[k]];
          num--;
        } else this.j[k] = 0;
      }
    }
    this.permutations(e - s + 1 - (4 - num), num);
    if (!(await this.getSettings(gen))) return;
    if (!(await this.waitForSpace(gen, STR.errBYPASSAborted))) return;
    this.print(STR.jtagulating);
    const t = this.target.jtag;
    const size = (k: string) => r[k][1] - r[k][0] + 1;
    const step = this.pacer(size("tdi") * size("tdo") * size("tck") * size("tms"), gen);
    const mod = this.pinsLow ? 1 : 10;
    let n = 0;
    let ctr = 0;
    let found = { tdi: 0, tdo: 0, tck: 0, tms: 0 };
    for (let tdi = r.tdi[0]; tdi <= r.tdi[1]; tdi++)
      for (let tdo = r.tdo[0]; tdo <= r.tdo[1]; tdo++) {
        if (tdo === tdi) continue;
        for (let tck = r.tck[0]; tck <= r.tck[1]; tck++) {
          if (tck === tdo || tck === tdi) continue;
          for (let tms = r.tms[0]; tms <= r.tms[1]; tms++) {
            if (tms === tck || tms === tdo || tms === tdi) continue;
            if (await step()) {
              this.cleanup(n, found);
              this.print(STR.errBYPASSAborted);
              return this.rxFlush();
            }
            if (t && tdi === t.tdi && tdo === t.tdo && tck === t.tck && tms === t.tms) {
              this.j = { tdi, tdo, tck, tms };
              this.displayJtagPins();
              n++;
              found = { tdi, tdo, tck, tms };
              this.jPinsKnown = 1;
              for (let trst = s; trst <= e; trst++) {
                if ([tms, tck, tdo, tdi].includes(trst)) continue;
                if (trst === t.trst) this.print("TRST#: " + trst + "\r\n");
                ++ctr;
              }
              this.print(STR.devicesDetected + t.idcodes.length + "\r\n");
            }
            this.progress(++ctr, mod, true);
          }
        }
      }
    if (n === 0) {
      this.print(STR.errNoDevice);
      this.jPinsKnown = 0;
    }
    this.cleanup(n, found);
    this.print("\r\nBYPASS" + STR.scanComplete);
  }

  private async rtckScan(gen: number) {
    if (!(await this.getChannels(gen, 2))) return;
    let [ts, te] = [this.chStart, this.chEnd];
    let num = 2;
    const known = await this.askYN(gen, "\r\nIs TCK already known? [", this.jPinsKnown);
    if (known === null) return;
    if (known === 1) {
      this.print("\r\nEnter X if pin is unknown.");
      this.print("\r\nEnter TCK pin [" + this.j.tck + "]: ");
      let x = await this.getPin(gen);
      if (x === -1) x = this.j.tck;
      if (x < -2 || x > this.chEnd) return this.print(STR.errRange);
      if (x !== -2) {
        ts = te = x;
        num--;
      }
    }
    this.permutations(this.chEnd - this.chStart + 1 - (2 - num), num);
    if (!(await this.getSettings(gen))) return;
    if (!(await this.waitForSpace(gen, STR.errRTCKAborted))) return;
    this.print(STR.jtagulating);
    const step = this.pacer((te - ts + 1) * (this.chEnd - this.chStart + 1), gen);
    let n = 0;
    let ctr = 0;
    for (let tck = ts; tck <= te; tck++)
      for (let rt = this.chStart; rt <= this.chEnd; rt++) {
        if (tck === rt) continue;
        if (await step()) {
          this.print(STR.errRTCKAborted);
          return this.rxFlush();
        }
        const t = this.target.rtck;
        if (t && t.tck === tck && t.rtck === rt) {
          n++;
          this.print("\r\nTCK: " + tck + "\r\nRTCK: " + rt + "\r\n");
        }
        this.progress(++ctr, this.pinsLow ? 1 : 10, true);
      }
    if (n === 0) this.print(STR.errNoDevice);
    this.print("\r\nRTCK" + STR.scanComplete);
  }

  private async setJtag(gen: number, getTDI: boolean): Promise<boolean> {
    const out = { ...this.j };
    if (getTDI) {
      this.print("\r\nEnter TDI pin [" + this.j.tdi + "]: ");
      let v = await this.getDecimal(gen);
      if (v === -1) v = this.j.tdi;
      if (v < 0 || v > MAX_CHAN - 1) return this.print(STR.errRange), false;
      out.tdi = v;
    } else {
      this.print("\r\nTDI not needed to retrieve Device ID.\r\n");
      out.tdi = PROP_SDA;
    }
    for (const k of ["tdo", "tck", "tms"] as const) {
      this.print(`\r\nEnter ${k.toUpperCase()} pin [${this.j[k]}]: `);
      let v = await this.getDecimal(gen);
      if (v === -1) v = this.j[k];
      if (v < 0 || v > MAX_CHAN - 1) return this.print(STR.errRange), false;
      out[k] = v;
    }
    if (new Set([out.tdi, out.tdo, out.tck, out.tms]).size !== 4) return this.print(STR.errCollision), false;
    this.j = out;
    return true;
  }

  private chainLength(withTdi: boolean): number {
    const t = this.target.jtag;
    if (!t || !this.jtagMatches(this.j.tdo, this.j.tck, this.j.tms)) return 0;
    if (withTdi && this.j.tdi !== t.tdi) return 0;
    return t.idcodes.length;
  }

  private async idcodeKnown(gen: number) {
    const xtdi = this.j.tdi;
    if (!(await this.setJtag(gen, false))) return;
    if (this.chainLength(false)) this.jtagIds().forEach((id, i) => this.displayDeviceId(id, i + 1, 1, true));
    this.j.tdi = xtdi;
    this.print(STR.idcodeDisplayComplete);
  }

  private async bypassKnown(gen: number) {
    if (!(await this.setJtag(gen, true))) return;
    const n = this.chainLength(true);
    this.print("\r\n" + STR.devicesDetected + n);
    if (n === 0) {
      this.print(STR.errNoDevice);
      this.jPinsKnown = 0;
      return;
    }
    const pattern = (Math.random() * 0x100000000) >>> 0;
    this.print("\r\nPattern in to TDI:    " + bin(pattern, 32));
    this.print("\r\nPattern out from TDO: " + bin(pattern, 32));
    this.print("\r\nMatch!");
  }

  private async opcodeDiscovery(gen: number) {
    if (!(await this.setJtag(gen, true))) return;
    const v = await this.askYN(gen, "\r\nIgnore single-bit Data Registers? [", this.jIgnoreReg);
    if (v === null) return;
    this.jIgnoreReg = v;
    const n = this.chainLength(true);
    if (n === 0) return this.print(STR.errNoDevice);
    if (n > 1) return this.print(STR.errTooMany);
    this.print("\r\n");
    const t = this.target.jtag!;
    const ir = t.irLength;
    this.print(STR.irLength + ir);
    const max = 2 ** ir - 1;
    this.print("\r\nPossible instructions: " + (max + 1));
    if (!(await this.waitForSpace(gen, STR.errDiscoveryAborted))) return;
    this.print(STR.jtagulating);
    const step = this.pacer(max + 1, gen);
    let ctr = 0;
    let gap = 0;
    for (let op = 0; op <= max; op++) {
      if (await step()) {
        this.print(STR.errDiscoveryAborted);
        return this.rxFlush();
      }
      const dr = t.drLengths?.[op] ?? 1;
      if (dr > 1 || this.jIgnoreReg === 0) {
        if (gap > 1 && this.jIgnoreReg === 1) this.print("-\r\n");
        this.print("IR: " + this.binary(op, ir) + "(0x" + hexs(op, roundUp(ir) >> 2) + ") -> DR: " + dr + "\r\n");
        gap = 0;
      }
      ctr++;
      gap++;
      this.progress(ctr, 8, this.jIgnoreReg === 1);
    }
    this.print("\r\nIR/DR discovery complete.");
  }

  private binary(v: number, len: number) {
    if (len < 8) return bin(v, len) + " ";
    let s = "";
    const mod = len % 8;
    if (mod) s += bin(v >>> 8, mod) + " ";
    for (let c = len - mod - 8; c >= 0; c -= 8) s += bin(v >>> c, 8) + " ";
    return s;
  }

  private async extestScan(gen: number) {
    if (!(await this.setJtag(gen, true))) return;
    const n = this.chainLength(true);
    if (n === 0) return this.print(STR.errNoDevice);
    if (n > 1) return this.print(STR.errTooMany);
    const t = this.target.jtag!;
    const ir = t.irLength;
    this.print("\r\n" + STR.irLength + ir);
    this.print("\r\n\nEnter EXTEST instruction (in hex) [" + hexs(this.jIR, roundUp(ir) >> 2) + "]: ");
    const s = await this.strIn(gen, 8);
    let xir: number;
    if (s === "") xir = this.jIR & (2 ** ir - 1);
    else {
      if (s.length > roundUp(ir) >> 2 || !/^[0-9a-fA-F]+$/.test(s)) return this.print(STR.errRange);
      xir = parseInt(s, 16);
    }
    this.jIR = xir;
    const dr = xir === t.extest ? (t.bsrLength ?? 0) : (t.drLengths?.[xir] ?? 1);
    this.print("\r\nBoundary Scan Register length: " + (dr === 0 ? "N/A" : dr));
    if (dr === 0 || dr === 1) return this.print(STR.errRange);
    const fill = await this.askYN(gen, "\r\n\nFill Boundary Scan Register with HIGH or LOW? [", this.jDRFill, "H", "L");
    if (fill === null) return;
    this.jDRFill = fill;
    const pause = await this.askYN(gen, "\r\n\nPause after successful detection? [", this.jLoopPause);
    if (pause === null) return;
    this.jLoopPause = pause;
    if (!(await this.waitForSpace(gen, STR.errEXTESTAborted))) return;
    this.print(STR.jtagulating);
    const map = xir === t.extest ? (t.bsrMap ?? {}) : {};
    let exit = false;
    while (!exit) {
      for (let bit = 0; bit < dr; bit++) {
        if (!this.rxEmpty()) {
          exit = true;
          break;
        }
        await this.pause(4, gen);
        this.print("-");
        const ch = map[bit];
        if (ch !== undefined && ![this.j.tdi, this.j.tdo, this.j.tck, this.j.tms].includes(ch)) {
          this.print("\r\nCH" + ch + " -> Register bit: " + bit + "\r\n");
          if (this.jLoopPause === 1) {
            this.print(STR.pressSpaceContinue);
            if ((await this.charIn(gen)) !== 32) {
              exit = true;
              break;
            }
            this.print("\r\n");
          }
        }
      }
      if (!exit) this.print("|");
    }
    this.rxFlush();
    this.print("\r\nPin mapper complete.");
  }

  private async openOcd(gen: number) {
    this.print(STR.modeWarning);
    if (!(await this.setJtag(gen, true))) return;
    this.persistedMode = "ocd";
    this.persistedVTarget = this.vTargetIO;
    this.print("\r\nEntering OpenOCD mode! Press Ctrl-X to exit...");
    this.print(STR.ocdNote);
    this.mode = "ocd";
    this.input = [];
  }

  private ocdByte(b: number) {
    if (b === CAN) {
      const exit = this.exitBinary;
      this.exitBinary = null;
      exit?.();
      return;
    }
    if (b === 0x00) this.print("BBIO1");
    else if (b === 0x06) this.print("OCD1");
  }

  // ---------------------------------------------------------------------- UART

  private async setUart(gen: number, askBaud: boolean): Promise<boolean> {
    this.print("\r\nEnter TXD pin [" + this.u.txd + "]: ");
    let tx = await this.getPin(gen);
    if (tx === -1) tx = this.u.txd;
    if (tx < -2 || tx > MAX_CHAN - 1) return this.print(STR.errRange), false;
    this.print("\r\nEnter RXD pin [" + this.u.rxd + "]: ");
    let rx = await this.getPin(gen);
    if (rx === -1) rx = this.u.rxd;
    if (rx < -2 || rx > MAX_CHAN - 1) return this.print(STR.errRange), false;
    if (tx === rx) return this.print(STR.errCollision), false;
    this.u.txd = tx;
    this.u.rxd = rx;
    if (askBaud) {
      this.print("\r\nEnter baud rate [" + this.u.baud + "]: ");
      let b = await this.getDecimal(gen);
      if (b === -1) b = this.u.baud;
      if (b < BAUDS[0] || b > BAUDS[BAUDS.length - 1]) return this.print(STR.errRange), false;
      this.u.baud = b;
    }
    return true;
  }

  private async uartScan(gen: number) {
    this.print(STR.uartPinout);
    let num = 2;
    if (!(await this.getChannels(gen, num))) return;
    let [txs, txe, rxs, rxe] = [this.chStart, this.chEnd, this.chStart, this.chEnd];
    const known = await this.askYN(gen, "\r\nAre any pins already known? [", this.uPinsKnown);
    if (known === null) return;
    this.uPinsKnown = known;
    if (known === 1) {
      this.print(STR.unknownPin);
      if (!(await this.setUart(gen, false))) return;
      if (this.u.txd !== -2) {
        txs = txe = this.u.txd;
        num--;
      } else this.u.txd = 0;
      if (this.u.rxd !== -2) {
        rxs = rxe = this.u.rxd;
        num--;
      } else this.u.rxd = 0;
    }
    this.permutations(this.chEnd - this.chStart + 1 - (2 - num), num);
    this.print("\r\nEnter text string to output (prefix with \\x for hex) [");
    if (this.uSTR.length === 0 && this.uHex === 0) this.print("CR");
    else if (this.uHex === 0) this.print(String.fromCharCode(...this.uSTR));
    else this.print("\\x" + this.uSTR.map((b) => hexs(b, 2)).join(""));
    this.print("]: ");
    const str = await this.strIn(gen, 34);
    if (str.length) {
      if (/[^\x20-\x7e]/.test(str)) return this.print(STR.errRange);
      if (str.startsWith("\\x")) {
        if (str.length === 2 || str.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(str.slice(2))) return this.print(STR.errRange);
        this.uSTR = (str.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16));
        this.uHex = this.uSTR.length;
      } else {
        if (str.length > 16) return this.print(STR.errRange);
        this.uHex = 0;
        this.uSTR = [...str].map((c) => c.charCodeAt(0));
      }
    }
    this.print("\r\nEnter delay before checking for target response (in ms, 0 - 1000) [" + this.uWaitDelay + "]: ");
    const d = await this.getDecimal(gen);
    if (d !== -1) {
      if (d < 0 || d > 1000) return this.print(STR.errRange);
      this.uWaitDelay = d;
    }
    const pr = await this.askYN(gen, "\r\n\nIgnore non-printable characters? [", this.uPrintable);
    if (pr === null) return;
    this.uPrintable = pr;
    if (!(await this.getSettings(gen))) return;
    if (!(await this.waitForSpace(gen, STR.errUARTAborted))) return;
    this.print(STR.jtagulating);
    const step = this.pacer((txe - txs + 1) * (rxe - rxs + 1) * BAUDS.length, gen);
    let n = 0;
    let ctr = 0;
    let found = { txd: 0, rxd: 0, baud: 0 };
    const t = this.target.uart;
    for (let tx = txs; tx <= txe; tx++) {
      for (let rx = rxs; rx <= rxe; rx++) {
        if (rx === tx) continue;
        for (const baud of BAUDS) {
          if (await step()) {
            this.uartCleanup(n, found);
            this.print(STR.errUARTAborted);
            return this.rxFlush();
          }
          if (t && t.txd === tx && t.rxd === rx && t.baud === baud) {
            const data = [...t.reply].slice(0, 16).map((c) => c.charCodeAt(0));
            const printable = data.every((b) => (b >= 0x20 && b <= 0x7e) || b === 13 || b === 10);
            if (!this.uPrintable || printable) {
              this.print("\r\nTXD: " + tx + "\r\nRXD: " + rx + "\r\nBaud: " + baud + "\r\n");
              this.print("Data: " + data.map((b) => (b < 0x20 || b > 0x7e ? "." : String.fromCharCode(b))).join(""));
              this.print(" [ " + data.map((b) => hexs(b, 2) + " ").join("") + "]\r\n");
            }
            n++;
            this.uPinsKnown = 1;
            found = { txd: tx, rxd: rx, baud };
          }
        }
        this.progress(++ctr, 1, true);
      }
    }
    if (n === 0) {
      this.print(STR.errNoDevice);
      this.uPinsKnown = 0;
    }
    this.uartCleanup(n, found);
    this.print("\r\nUART" + STR.scanComplete);
  }

  private uartCleanup(n: number, f: { txd: number; rxd: number; baud: number }) {
    this.u = n === 0 ? { txd: 0, rxd: 0, baud: 0 } : { ...f };
  }

  private async uartScanTxd(gen: number) {
    this.print(STR.uartPinout);
    if (!(await this.getChannels(gen, 1))) return;
    const v = await this.askYN(gen, "\r\n\nIgnore non-standard baud rates? [", this.uBaudIgnore);
    if (v === null) return;
    this.uBaudIgnore = v;
    if (!(await this.waitForSpace(gen, STR.errUARTAborted))) return;
    this.print("\r\nNote: This scan will continuously monitor all channels for UART\r\nactivity until aborted.");
    this.print(STR.jtagulating);
    const t = this.target.uart;
    let n = 0;
    let ticks = 0;
    let found = { txd: 0, baud: 0 };
    while (this.rxEmpty()) {
      await this.pause(50, gen);
      if (++ticks % 4 === 0) this.print("-");
      if (t && t.txd >= this.chStart && t.txd <= this.chEnd && ticks % 30 === 10) {
        const measured = Math.round(t.baud * (1 + (Math.random() - 0.5) * 0.02));
        this.print("\r\nTXD: " + t.txd + "\r\nBaud (Measured): " + measured + "\r\nBaud (Best Fit): " + t.baud + "\r\n");
        n++;
        found = { txd: t.txd, baud: t.baud };
      }
    }
    if (n === 0) this.uPinsKnown = 0;
    this.uartCleanup(n, { txd: found.txd, rxd: 0, baud: found.baud });
    this.rxFlush();
    this.print("\r\nUART TXD" + STR.scanComplete);
  }

  private async uartPassthrough(gen: number) {
    this.print(STR.uartPinout);
    this.print("\r\nEnter X to disable either pin, if desired.");
    if (!(await this.setUart(gen, true))) return;
    const echo = await this.askYN(gen, "\r\nEnable local echo? [", this.uLocalEcho);
    if (echo === null) return;
    this.uLocalEcho = echo;
    this.print("\r\nEntering UART passthrough! Press Ctrl-X to exit...\r\n");
    const t = this.target.uart;
    const connected = !!t && this.u.txd === t.txd && this.u.rxd === t.rxd && this.u.baud === t.baud;
    let lineBuf = "";
    const respond = (l: string) => {
      const cmd = l.trim();
      let out = "";
      if (cmd === "") out = "";
      else if (cmd === "help" || cmd === "?") out = "bdinfo  - print Board Info structure\r\nboot    - boot default\r\nmd      - memory display\r\nprintenv- print environment variables\r\nversion - print monitor version\r\n";
      else if (cmd === "version") out = "U-Boot 2016.09 (Mar 03 2021 - 10:12:44 +0800)\r\n";
      else if (cmd === "printenv") out = "baudrate=115200\r\nbootcmd=bootm 0x9f020000\r\nbootdelay=1\r\nethaddr=00:aa:bb:cc:dd:ee\r\n";
      else if (cmd.startsWith("md")) out = "9f020000: 27051956 4f1a3c55 61c2b5a0 00b9a7c8    '.V.O.<Ua.......\r\n";
      else out = `Unknown command '${cmd.split(" ")[0]}' - try 'help'\r\n`;
      return out + "=> ";
    };
    if (connected) this.print("\r\n=> ");
    for (;;) {
      const c = await this.rx(gen);
      if (c === CAN) break;
      if (this.uLocalEcho) this.print(c === 13 || c === 10 || (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : ".");
      if (!connected) continue;
      if (c === 13) {
        this.print("\r\n" + respond(lineBuf));
        lineBuf = "";
      } else if (c === 8 || c === 0x7f) {
        if (lineBuf) {
          lineBuf = lineBuf.slice(0, -1);
          this.print("\b \b");
        }
      } else if (c >= 0x20 && c < 0x7f) {
        lineBuf += String.fromCharCode(c);
        this.print(String.fromCharCode(c));
      }
    }
    if (this.u.txd >= MAX_CHAN) this.u.txd = 0;
    else if (this.u.rxd >= MAX_CHAN) this.u.rxd = 0;
    this.print("\r\nUART passthrough complete.");
  }

  // ---------------------------------------------------------------------- GPIO

  private ioLine(v: number) {
    return "\r\nCH23..CH0: " + [16, 8, 0].map((s) => bin(v >>> s, 8) + " ").join("") + " (0x" + hexs(v, 6) + ")";
  }

  private readIO() {
    this.print("\r");
    this.print(this.ioLine(this.channels()));
  }

  private async monitorIO(gen: number) {
    this.print("\r\nReading all channels! Press any key to abort...\r\n");
    let prev = -1;
    while (this.rxEmpty()) {
      const v = this.channels();
      if (v !== prev) {
        prev = v;
        this.print(this.ioLine(v));
      }
      await this.pause(20, gen);
    }
    this.rxFlush();
  }

  private async writeIO(gen: number) {
    this.print("\r\nEnter value to output (in hex) [" + hexs(this.gWriteValue, 6) + "]: ");
    const s = await this.strIn(gen, 8);
    let v = this.gWriteValue;
    if (s !== "") {
      if (s.length > 6 || !/^[0-9a-fA-F]+$/.test(s)) return this.print(STR.errRange);
      v = parseInt(s, 16);
    }
    this.gWriteValue = v;
    this.gOut = v;
    this.print(this.ioLine(v));
    this.print("\r\nPress any key when done...");
    await this.charIn(gen);
    this.gOut = null;
  }

  private async logic(gen: number) {
    void gen;
    this.print(STR.modeWarning);
    this.persistedMode = "sump";
    this.persistedVTarget = this.vTargetIO;
    this.print("\r\nEntering logic analyzer mode! Press Ctrl-X to exit...");
    this.print(STR.sumpNote);
    this.mode = "sump";
    this.input = [];
    this.sump?.reset?.();
  }

  private sumpByte(b: number) {
    if (b === CAN) {
      const exit = this.exitBinary;
      this.exitBinary = null;
      exit?.();
      return;
    }
    if (this.sump) this.sump.feed(b, (bytes) => this.out(bytes));
    else if (b === 0x02) this.print("1ALS");
  }

  // ----------------------------------------------------------------------- SWD

  private async swdScan(gen: number) {
    this.print(STR.swdWarning);
    if (!(await this.getChannels(gen, 2))) return;
    const n = this.chEnd - this.chStart + 1;
    this.permutations(n, 2);
    if (!(await this.getSettings(gen))) return;
    if (!(await this.waitForSpace(gen, STR.errIDCODEAborted))) return;
    this.print(STR.jtagulating);
    const step = this.pacer(n * (n - 1), gen);
    let num = 0;
    let ctr = 0;
    let found = { clk: 0, io: 0 };
    const t = this.target.swd;
    for (let clk = this.chStart; clk <= this.chEnd; clk++)
      for (let io = this.chStart; io <= this.chEnd; io++) {
        if (io === clk) continue;
        if (await step()) {
          this.swdCleanup(num, found);
          this.print(STR.errIDCODEAborted);
          return this.rxFlush();
        }
        if (t && t.swclk === clk && t.swdio === io) {
          this.print("\r\nSWDIO: " + io + "\r\nSWCLK: " + clk + "\r\n");
          num++;
          found = { clk, io };
          this.displayDeviceId(t.dpidr, 1, 0, false);
          this.print("\r\n");
        }
        this.progress(++ctr, this.pinsLow ? 1 : 30, true);
      }
    if (num === 0) this.print(STR.errNoDevice);
    this.swdCleanup(num, found);
    this.print("\r\nIDCODE" + STR.scanComplete);
  }

  private swdCleanup(num: number, f: { clk: number; io: number }) {
    if (num === 0) [this.swdClk, this.swdIo] = [0, 0];
    else [this.swdClk, this.swdIo] = [f.clk, f.io];
  }

  private async swdKnown(gen: number) {
    this.print(STR.swdWarning);
    this.print("\r\nEnter SWDIO pin [" + this.swdIo + "]: ");
    let io = await this.getDecimal(gen);
    if (io === -1) io = this.swdIo;
    if (io < 0 || io > MAX_CHAN - 1) return this.print(STR.errRange);
    this.print("\r\nEnter SWCLK pin [" + this.swdClk + "]: ");
    let clk = await this.getDecimal(gen);
    if (clk === -1) clk = this.swdClk;
    if (clk < 0 || clk > MAX_CHAN - 1) return this.print(STR.errRange);
    if (io === clk) return this.print(STR.errCollision);
    this.swdIo = io;
    this.swdClk = clk;
    const t = this.target.swd;
    if (t && t.swdio === io && t.swclk === clk) this.displayDeviceId(t.dpidr, 1, 2, false);
    else this.print(STR.errNoDevice);
    this.print(STR.idcodeDisplayComplete);
  }
}
