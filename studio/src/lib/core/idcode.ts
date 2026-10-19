// Decoding of JTAG IDCODE (IEEE 1149.1) and ARM SWD DPIDR values.
import jep106 from "../data/jep106.json";

const NAMES = jep106 as string[];

/** JEP106 manufacturer for a bank (continuation-code count) and 7-bit code. */
export function jep106Name(bank: number, code: number): string | null {
  if (code < 1 || code > 126) return null;
  return NAMES[bank * 126 + code - 1] ?? null;
}

const hex = (v: number, digits: number) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(digits, "0");

export interface JtagIdcode {
  kind: "jtag";
  raw: number;
  hex: string;
  version: number;
  partNumber: number;
  /** 11-bit manufacturer identity field (bits 11..1). */
  manufacturerId: number;
  bank: number;
  code: number;
  manufacturer: string | null;
  part: string | null;
  valid: boolean;
}

export interface SwdDpidr {
  kind: "swd";
  raw: number;
  hex: string;
  revision: number;
  partNo: number;
  min: boolean;
  /** DP architecture version (1 = ADIv5 DPv1, 2 = DPv2, 3 = ADIv6). */
  version: number;
  designerId: number;
  bank: number;
  code: number;
  designer: string | null;
  part: string | null;
  valid: boolean;
}

// Well-known IDCODEs / DPIDRs, keyed by value with the version nibble masked off.
const KNOWN_JTAG: Record<number, string> = {
  0x0ba00477: "ARM CoreSight JTAG-DP (Cortex-M3/M4/M7, Cortex-A)",
  0x0ba01477: "ARM CoreSight SW-DP / JTAG-DP",
  0x0ba02477: "ARM CoreSight JTAG-DP (DPv2)",
  0x06430041: "STM32F1xx (XL density) boundary scan",
  0x06413041: "STM32F4xx boundary scan",
  0x06414041: "STM32F1xx (high density) boundary scan",
  0x06410041: "STM32F1xx (medium density) boundary scan",
  0x06412041: "STM32F1xx (low density) boundary scan",
  0x06418041: "STM32F1xx (connectivity line) boundary scan",
  0x0362d093: "Xilinx Artix-7 XC7A35T",
  0x03631093: "Xilinx Artix-7 XC7A100T",
  0x03636093: "Xilinx Artix-7 XC7A200T",
  0x03727093: "Xilinx Zynq-7000 XC7Z020",
  0x03722093: "Xilinx Zynq-7000 XC7Z010",
};

const KNOWN_DPIDR: Record<number, string> = {
  0x0ba01477: "ARM SW-DP v1 (Cortex-M3/M4)",
  0x0ba02477: "ARM SW-DP v2 (e.g. Cortex-M7)",
  0x0bc11477: "ARM SW-DP v1 MINDP (Cortex-M0/M0+)",
  0x0bc12477: "ARM SW-DP v2 MINDP (Cortex-M0+, e.g. RP2040)",
  0x0be12477: "ARM SW-DP v2 (Cortex-M23/M33)",
  0x0bb11477: "ARM SW-DP v1 (Cortex-M0)",
};

const lookup = (table: Record<number, string>, raw: number) =>
  table[(raw & 0x0fffffff) >>> 0] ?? null;

export function decodeJtag(raw: number): JtagIdcode {
  raw >>>= 0;
  const manufacturerId = (raw >>> 1) & 0x7ff;
  const bank = (raw >>> 8) & 0xf;
  const code = (raw >>> 1) & 0x7f;
  return {
    kind: "jtag",
    raw,
    hex: hex(raw, 8),
    version: raw >>> 28,
    partNumber: (raw >>> 12) & 0xffff,
    manufacturerId,
    bank,
    code,
    manufacturer: jep106Name(bank, code),
    part: lookup(KNOWN_JTAG, raw),
    valid: (raw & 1) === 1 && raw !== 0xffffffff,
  };
}

export function decodeDpidr(raw: number): SwdDpidr {
  raw >>>= 0;
  const designerId = (raw >>> 1) & 0x7ff;
  const bank = (raw >>> 8) & 0xf;
  const code = (raw >>> 1) & 0x7f;
  return {
    kind: "swd",
    raw,
    hex: hex(raw, 8),
    revision: raw >>> 28,
    partNo: (raw >>> 20) & 0xff,
    min: ((raw >>> 16) & 1) === 1,
    version: (raw >>> 12) & 0xf,
    designerId,
    bank,
    code,
    designer: jep106Name(bank, code),
    part: lookup(KNOWN_DPIDR, raw),
    valid: (raw & 1) === 1 && raw !== 0xffffffff,
  };
}

export const formatHex = hex;

/** Bit fields for rendering an IDCODE as labeled segments. */
export function jtagFields(raw: number) {
  raw >>>= 0;
  const bits = (hi: number, lo: number) =>
    ((raw >>> lo) & ((1 << (hi - lo + 1)) - 1)).toString(2).padStart(hi - lo + 1, "0");
  return [
    { label: "Version", range: "31..28", bits: bits(31, 28) },
    { label: "Part number", range: "27..12", bits: bits(27, 12) },
    { label: "Manufacturer", range: "11..1", bits: bits(11, 1) },
    { label: "1", range: "0", bits: bits(0, 0) },
  ];
}

export function dpidrFields(raw: number) {
  raw >>>= 0;
  const bits = (hi: number, lo: number) =>
    ((raw >>> lo) & ((1 << (hi - lo + 1)) - 1)).toString(2).padStart(hi - lo + 1, "0");
  return [
    { label: "Revision", range: "31..28", bits: bits(31, 28) },
    { label: "PartNo", range: "27..20", bits: bits(27, 20) },
    { label: "Res", range: "19..17", bits: bits(19, 17) },
    { label: "MIN", range: "16", bits: bits(16, 16) },
    { label: "Version", range: "15..12", bits: bits(15, 12) },
    { label: "Designer", range: "11..1", bits: bits(11, 1) },
    { label: "RAO", range: "0", bits: bits(0, 0) },
  ];
}
