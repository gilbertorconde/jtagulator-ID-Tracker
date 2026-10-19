import type { JtagIdcode, SwdDpidr } from "./idcode";

export type Menu = "main" | "jtag" | "uart" | "gpio" | "swd";

/** Operating mode the firmware is in (persisted in EEPROM across resets). */
export type DeviceMode = "normal" | "sump" | "ocd" | "unknown";

export const MAX_CHANNELS = 24;

export interface ChannelRange {
  start: number;
  end: number;
}

/** "Bring channels LOW before each permutation" (pulses possible reset lines). */
export interface PinsLow {
  lowMs: number;
  highMs: number;
}

export interface ScanOptions extends ChannelRange {
  pinsLow?: PinsLow | false;
}

export interface JtagPins {
  tdi: number;
  tdo: number;
  tck: number;
  tms: number;
}

/** Known pins for a partial BYPASS scan. `null`/missing = unknown. */
export type PartialJtagPins = Partial<Record<keyof JtagPins, number | null>>;

export interface DeviceIdEntry {
  index: number;
  idcode: JtagIdcode;
  /** Manufacturer name reported by the firmware's EEPROM database, if shown. */
  firmwareManufacturer?: string;
}

export interface JtagFinding {
  kind: "jtag";
  tdi: number | null;
  tdo: number;
  tck: number;
  tms: number;
  trst: number[];
  devices: DeviceIdEntry[];
  deviceCount?: number;
}

export interface RtckFinding {
  kind: "rtck";
  tck: number;
  rtck: number;
}

export interface SwdFinding {
  kind: "swd";
  swdio: number;
  swclk: number;
  dpidr: SwdDpidr | null;
  firmwareManufacturer?: string;
}

export interface UartFinding {
  kind: "uart";
  txd: number;
  rxd: number | null;
  baud: number;
  ascii?: string;
  hex?: number[];
}

export interface UartTxdFinding {
  kind: "uart-txd";
  txd: number;
  measuredBaud: number;
  bestFit: number | null;
}

export interface ExtestFinding {
  kind: "extest";
  channel: number;
  bit: number;
}

export interface IrdrFinding {
  kind: "irdr";
  ir: number;
  irBits: string;
  dr: number;
}

export type Finding =
  | JtagFinding
  | RtckFinding
  | SwdFinding
  | UartFinding
  | UartTxdFinding
  | ExtestFinding
  | IrdrFinding;

export type OpEvent =
  | { type: "phase"; phase: "configuring" | "running" | "done" }
  | { type: "permutations"; count: number }
  | { type: "progress"; ticks: number; fraction: number | null }
  | { type: "result"; id: number; finding: Finding }
  | { type: "message"; level: "info" | "warn" | "error"; text: string };

export interface OpContext {
  signal?: AbortSignal;
  onEvent?: (e: OpEvent) => void;
}

export interface ScanResult<F extends Finding = Finding> {
  findings: F[];
  permutations: number | null;
  aborted: boolean;
  messages: string[];
  transcript: string;
  durationMs: number;
}
