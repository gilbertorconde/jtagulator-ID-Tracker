// Target profiles: what we know about the board under test, and the shareable
// .jtarget file format (export, validated import, merge).
import type { Finding } from "../core/types";

/** What we know about the board under test, prefilled into forms. */
export interface TargetProfile {
  id: string;
  updatedAt: number;
  name: string;
  notes: string;
  voltage: number | null;
  jtag: { tdi: number | null; tdo: number | null; tck: number | null; tms: number | null; trst: number | null; rtck: number | null };
  swd: { swdio: number | null; swclk: number | null };
  uart: { txd: number | null; rxd: number | null; baud: number | null };
  range: { start: number; end: number };
  /** Every finding, newest first, de-duplicated. */
  findings: { at: number; op: string; finding: Finding }[];
  channelNames: Record<number, string>;
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const blankTarget = (): TargetProfile => ({
  id: newId(),
  updatedAt: Date.now(),
  name: "Untitled target",
  notes: "",
  voltage: null,
  jtag: { tdi: null, tdo: null, tck: null, tms: null, trst: null, rtck: null },
  swd: { swdio: null, swclk: null },
  uart: { txd: null, rxd: null, baud: null },
  range: { start: 0, end: 7 },
  findings: [],
  channelNames: {},
});

/** Identity of a finding, for de-duplication. */
export function findingKey(f: Finding): string {
  switch (f.kind) {
    case "jtag":
      return `jtag:${f.tdi}:${f.tdo}:${f.tck}:${f.tms}:${f.devices.map((d) => d.idcode.raw).join(",")}`;
    case "swd":
      return `swd:${f.swdio}:${f.swclk}:${f.dpidr?.raw}`;
    case "uart":
      return `uart:${f.txd}:${f.rxd}:${f.baud}`;
    case "uart-txd":
      return `txd:${f.txd}:${f.bestFit}`;
    case "rtck":
      return `rtck:${f.tck}:${f.rtck}`;
    case "extest":
      return `extest:${f.channel}:${f.bit}`;
    case "irdr":
      return `irdr:${f.ir}:${f.dr}`;
  }
}

// ------------------------------------------------------------- .jtarget file

export const JTARGET_FORMAT = "jtagulator-target";
export const JTARGET_VERSION = 1;
const FINDING_KINDS = new Set(["jtag", "rtck", "swd", "uart", "uart-txd", "extest", "irdr"]);

/** A target as a .jtarget file (JSON). */
export function serializeTarget(t: TargetProfile, app = "JTAGulator Studio"): string {
  return JSON.stringify({ format: JTARGET_FORMAT, version: JTARGET_VERSION, exportedBy: app, exportedAt: new Date().toISOString(), target: t }, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A channel number 0-23, or null. */
const pin = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? (v as number) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 100_000) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Read a .jtarget file (or the plain profile JSON older versions saved).
 * Unknown fields are dropped, bad values reset to "unknown", and findings of
 * unknown kinds skipped, so a file from a newer or hand-edited version still loads.
 */
export function parseTarget(text: string): { target: TargetProfile; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not a target file: it isn't valid JSON");
  }
  if (isObj(data) && data.format === JTARGET_FORMAT) {
    if (typeof data.version !== "number" || data.version > JTARGET_VERSION)
      throw new Error(`This target file is format version ${String(data.version)}; this app reads up to version ${JTARGET_VERSION}. Update JTAGulator Studio.`);
    data = data.target;
  }
  if (!isObj(data) || !isObj(data.jtag) || !Array.isArray(data.findings)) throw new Error("Not a JTAGulator Studio target file");
  const d = data;
  const sub = (k: string) => (isObj(d[k]) ? (d[k] as Record<string, unknown>) : {});
  const j = sub("jtag");
  const s = sub("swd");
  const u = sub("uart");
  const r = sub("range");
  const b = blankTarget();
  const findings: TargetProfile["findings"] = [];
  let skipped = 0;
  for (const f of d.findings as unknown[]) {
    if (isObj(f) && isObj(f.finding) && FINDING_KINDS.has(f.finding.kind as string)) {
      findings.push({ at: num(f.at) ?? 0, op: str(f.op, 200), finding: f.finding as unknown as Finding });
    } else skipped++;
  }
  const channelNames: Record<number, string> = {};
  for (const [k, v] of Object.entries(sub("channelNames"))) {
    const ch = pin(Number(k));
    if (ch !== null && typeof v === "string" && v.trim()) channelNames[ch] = v.slice(0, 200);
  }
  const start = pin(r.start) ?? b.range.start;
  const end = pin(r.end) ?? b.range.end;
  return {
    target: {
      id: typeof d.id === "string" && d.id ? d.id.slice(0, 64) : b.id,
      updatedAt: num(d.updatedAt) ?? Date.now(),
      name: str(d.name, 200).trim() || b.name,
      notes: str(d.notes),
      voltage: num(d.voltage),
      jtag: { tdi: pin(j.tdi), tdo: pin(j.tdo), tck: pin(j.tck), tms: pin(j.tms), trst: pin(j.trst), rtck: pin(j.rtck) },
      swd: { swdio: pin(s.swdio), swclk: pin(s.swclk) },
      uart: { txd: pin(u.txd), rxd: pin(u.rxd), baud: num(u.baud) },
      range: start <= end ? { start, end } : { start: end, end: start },
      findings: findings.sort((x, y) => y.at - x.at).slice(0, 500),
      channelNames,
    },
    skipped,
  };
}

/**
 * Merge an imported target into an existing one. What the existing target
 * already knows wins; the import fills in the gaps. Findings are combined
 * without duplicates. Returns the merged target and every value that disagreed.
 */
export function mergeTargets(base: TargetProfile, incoming: TargetProfile): { target: TargetProfile; conflicts: string[] } {
  const conflicts: string[] = [];
  const pick = <T>(label: string, a: T | null, b: T | null): T | null => {
    if (a !== null && b !== null && a !== b) conflicts.push(`${label}: kept ${String(a)}, file has ${String(b)}`);
    return a ?? b;
  };
  const group = <G extends Record<string, number | null>>(name: string, a: G, b: G): G =>
    Object.fromEntries(Object.keys(a).map((k) => [k, pick(`${name} ${k.toUpperCase()}`, a[k], b[k])])) as G;
  const voltage = pick("Voltage", base.voltage, incoming.voltage);
  const jtag = group("JTAG", base.jtag, incoming.jtag);
  const swd = group("SWD", base.swd, incoming.swd);
  const uart = group("UART", base.uart, incoming.uart);
  const channelNames = { ...base.channelNames };
  for (const [k, v] of Object.entries(incoming.channelNames)) {
    const ch = Number(k);
    if (!channelNames[ch]) channelNames[ch] = v;
    else if (channelNames[ch] !== v) conflicts.push(`CH${ch} label: kept "${channelNames[ch]}", file has "${v}"`);
  }
  const seen = new Set(base.findings.map((f) => findingKey(f.finding)));
  const added = incoming.findings.filter((f) => !seen.has(findingKey(f.finding)));
  const notes = !incoming.notes.trim() || base.notes.includes(incoming.notes.trim()) ? base.notes : base.notes.trim() ? `${base.notes.trimEnd()}\n\n${incoming.notes.trim()}` : incoming.notes;
  return {
    target: {
      ...base,
      updatedAt: Date.now(),
      notes,
      voltage,
      jtag,
      swd,
      uart,
      findings: [...base.findings, ...added].sort((x, y) => y.at - x.at).slice(0, 500),
      channelNames,
    },
    conflicts,
  };
}
