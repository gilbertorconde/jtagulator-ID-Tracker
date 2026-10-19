// BSDL (IEEE 1149.1 Boundary-Scan Description Language) parser: the subset that
// matters for identifying a chip and reading boundary-scan results.
//
// A BSDL file is VHDL: an entity with `attribute <NAME> of <entity> : entity is <value>;`
// statements whose values are numbers or string literals joined with `&`, plus
// `constant <PKG> : PIN_MAP_STRING := "...";` package pin maps.

export interface BsdlCell {
  /** Cell number; cell 0 is next to TDO. Matches the JTAGulator pin mapper's bit. */
  num: number;
  /** Cell type, e.g. BC_1. */
  cell: string;
  /** Port name, or "*" for cells without a port (internal or control). */
  port: string;
  /** input, output2, output3, bidir, control, controlr, internal, clock, observe_only. */
  function: string;
  safe: string;
  /** For output3/bidir cells: the control cell, its disabling value and result. */
  control?: number;
  disval?: string;
  disresult?: string;
}

export interface BsdlFile {
  entity: string;
  /** Default physical pin map (generic PHYSICAL_PIN_MAP), when given. */
  pinMapName: string | null;
  irLength: number | null;
  /** Instruction name → opcodes as bit strings (MSB first, may contain X). */
  opcodes: Record<string, string[]>;
  /** IDCODE register as a 32-character bit string (MSB first, X = don't care). */
  idcodeBits: string | null;
  bsrLength: number | null;
  cells: BsdlCell[];
  /** Package name → port → package pins. */
  pinMaps: Record<string, Record<string, string[]>>;
}

export class BsdlError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "BsdlError";
  }
}

/** Remove "--" comments (outside string literals). */
function stripComments(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inStr = !inStr;
    if (!inStr && c === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "\n") inStr = false; // strings never span lines in BSDL
    out += c;
  }
  return out;
}

/** The value of `"a" & "b" & ...` (or a bare number / identifier). */
function joinStrings(expr: string): string {
  const parts = [...expr.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  return parts.length ? parts.join("") : expr.trim();
}

export function parseBsdl(text: string): BsdlFile {
  const src = stripComments(text.replace(/\r\n?/g, "\n"));
  const entity = src.match(/\bentity\s+(\w+)\s+is\b/i)?.[1];
  if (!entity) throw new BsdlError("Not a BSDL file: no entity declaration");

  const attrs = new Map<string, string>();
  for (const m of src.matchAll(/\battribute\s+(\w+)\s+of\s+(\w+)\s*:\s*\w+\s+is\s+([\s\S]*?);/gi)) {
    if (m[2].toLowerCase() === entity.toLowerCase()) attrs.set(m[1].toUpperCase(), m[3]);
  }
  const num = (k: string) => {
    const v = attrs.get(k);
    const n = v ? parseInt(joinStrings(v), 10) : NaN;
    return Number.isFinite(n) ? n : null;
  };

  const opcodes: Record<string, string[]> = {};
  const op = attrs.get("INSTRUCTION_OPCODE");
  if (op) {
    for (const m of joinStrings(op).matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
      opcodes[m[1].toUpperCase()] = m[2].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    }
  }

  let idcodeBits: string | null = null;
  const id = attrs.get("IDCODE_REGISTER");
  if (id) {
    const bits = joinStrings(id).replace(/\s+/g, "").toUpperCase();
    if (/^[01X]{32}$/.test(bits)) idcodeBits = bits;
  }

  const cells: BsdlCell[] = [];
  const br = attrs.get("BOUNDARY_REGISTER");
  if (br) {
    for (const m of joinStrings(br).matchAll(/(\d+)\s*\(([^)]*)\)/g)) {
      const f = m[2].split(",").map((s) => s.trim());
      if (f.length < 4) continue;
      const cell: BsdlCell = { num: +m[1], cell: f[0], port: f[1], function: f[2].toLowerCase(), safe: f[3] };
      if (f.length >= 7) {
        cell.control = +f[4];
        cell.disval = f[5];
        cell.disresult = f[6];
      }
      cells.push(cell);
    }
    cells.sort((a, b) => a.num - b.num);
  }

  const pinMaps: Record<string, Record<string, string[]>> = {};
  for (const m of src.matchAll(/\bconstant\s+(\w+)\s*:\s*PIN_MAP_STRING\s*:=\s*([\s\S]*?);/gi)) {
    const map: Record<string, string[]> = {};
    // Entries: PORT:PIN or PORT:(PIN, PIN, ...), separated by commas.
    for (const e of joinStrings(m[2]).matchAll(/(\w+)\s*:\s*(\([^)]*\)|[^,]+)/g)) {
      map[e[1]] = e[2].replace(/[()]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    }
    pinMaps[m[1]] = map;
  }
  const generic = src.match(/PHYSICAL_PIN_MAP\s*:\s*string\s*:=\s*"([^"]*)"/i)?.[1] ?? null;

  return {
    entity,
    pinMapName: generic,
    irLength: num("INSTRUCTION_LENGTH"),
    opcodes,
    idcodeBits,
    bsrLength: num("BOUNDARY_LENGTH"),
    cells,
    pinMaps,
  };
}

// ----------------------------------------------------------------- helpers

/** Does a 32-bit IDCODE match the file's IDCODE register (X bits ignored)? */
export function matchesIdcode(b: BsdlFile, raw: number): boolean {
  if (!b.idcodeBits) return false;
  const bits = (raw >>> 0).toString(2).padStart(32, "0");
  for (let i = 0; i < 32; i++) if (b.idcodeBits[i] !== "X" && b.idcodeBits[i] !== bits[i]) return false;
  return true;
}

const fitsOpcode = (pattern: string, value: number, len: number) => {
  if (pattern.length !== len) return false;
  const bits = value.toString(2).padStart(len, "0");
  for (let i = 0; i < len; i++) if (pattern[i] !== "X" && pattern[i] !== bits[i]) return false;
  return true;
};

/** Instruction names whose opcode matches an IR value. */
export function instructionNames(b: BsdlFile, ir: number, irLength: number): string[] {
  return Object.entries(b.opcodes)
    .filter(([, ops]) => ops.some((p) => fitsOpcode(p, ir, irLength)))
    .map(([n]) => n);
}

/** Numeric opcode of an instruction (X bits as 0), or null. */
export function opcodeOf(b: BsdlFile, name: string): number | null {
  const p = b.opcodes[name.toUpperCase()]?.[0];
  return p ? parseInt(p.replace(/X/g, "0"), 2) : null;
}

/** The pin map to use: the generic's default, else the only/first one. */
export function defaultPinMap(b: BsdlFile): Record<string, string[]> | null {
  if (b.pinMapName && b.pinMaps[b.pinMapName]) return b.pinMaps[b.pinMapName];
  const first = Object.values(b.pinMaps)[0];
  return first ?? null;
}

export interface CellInfo {
  cell: BsdlCell;
  /** Package pins of the cell's port (or of the ports it controls). */
  pins: string[];
  /** For control cells: the output cells (and their ports) they enable. */
  controls: BsdlCell[];
  /** One line for the UI, e.g. "PA9 (pin 68), output3". */
  label: string;
}

/** What a boundary-register bit (pin mapper result) is in this chip. */
export function describeCell(b: BsdlFile, bit: number): CellInfo | null {
  const cell = b.cells.find((c) => c.num === bit);
  if (!cell) return null;
  const pinMap = defaultPinMap(b);
  const pinsOf = (port: string) => (pinMap && port !== "*" ? (pinMap[port.replace(/\(\d+\)$/, "")] ?? []) : []);
  const controls = cell.function.startsWith("control") ? b.cells.filter((c) => c.control === cell.num) : [];
  const ports = controls.length ? [...new Set(controls.map((c) => c.port))] : [cell.port];
  const pins = ports.flatMap(pinsOf);
  const what = controls.length ? `controls ${ports.join(", ")}` : cell.port === "*" ? "internal" : cell.port;
  const label = `${what}${pins.length ? ` (pin ${pins.join(", ")})` : ""}, ${cell.function}`;
  return { cell, pins, controls, label };
}
