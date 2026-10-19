// Decoding of JTAG IDCODE (IEEE 1149.1) and ARM SWD DPIDR values.
import jep106 from "../data/jep106.json";
import parts from "../data/parts.json";

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

// Known IDCODE / DPIDR values (src/lib/data/parts.json, built by scripts/gen-parts.mjs
// from openFPGALoader, UrJTAG and OpenOCD, plus hand-added entries).
interface PartEntry {
  id: string;
  mask: string;
  name: string;
  vendor: string;
  family: string;
  kind: "jtag" | "swd" | "any";
  source: string;
  seenOn?: string[];
}

export interface KnownPart {
  name: string;
  vendor: string;
  family: string;
  source: string;
  sourceUrl: string | null;
  /** For shared IDs (ARM debug ports): every OpenOCD target that uses it. */
  seenOn: string[];
}

const PARTS_DATA = parts as { sources: Record<string, string>; parts: PartEntry[] };
const PARTS = PARTS_DATA.parts.map((p) => {
  const mask = parseInt(p.mask, 16) >>> 0;
  let bits = 0;
  for (let m = mask; m; m >>>= 1) bits += m & 1;
  return { ...p, value: (parseInt(p.id, 16) & mask) >>> 0, maskN: mask, bits };
});

/** The most specific known part for an ID (exact matches beat version-masked ones). */
export function findPart(raw: number, kind: "jtag" | "swd"): KnownPart | null {
  raw >>>= 0;
  let best: (typeof PARTS)[number] | null = null;
  for (const p of PARTS) {
    if (p.kind !== "any" && p.kind !== kind) continue;
    if (((raw & p.maskN) >>> 0) !== p.value) continue;
    if (!best || p.bits > best.bits) best = p;
  }
  if (!best) return null;
  return {
    name: best.name,
    vendor: best.vendor,
    family: best.family,
    source: best.source,
    sourceUrl: PARTS_DATA.sources[best.source] ?? null,
    seenOn: best.seenOn ?? [],
  };
}

/** Number of known IDs in the table. */
export const knownPartCount = PARTS.length;

/** Generic names from the ARM debug interface spec when no specific part is known. */
function armDebugPort(raw: number, kind: "jtag" | "swd"): string | null {
  if ((raw & 0xfff) !== 0x477) return null;
  const partno = (raw >>> 12) & 0xffff;
  if (kind === "jtag" && (partno & 0xfff0) === 0xba00) return "ARM CoreSight JTAG-DP";
  if (kind === "swd") return "ARM CoreSight debug port";
  return null;
}

function partLabel(raw: number, kind: "jtag" | "swd"): string | null {
  const p = findPart(raw, kind);
  if (p) return p.family ? `${p.name} (${p.family})` : p.name;
  return armDebugPort(raw, kind);
}

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
    part: partLabel(raw, "jtag"),
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
    part: partLabel(raw, "swd"),
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
