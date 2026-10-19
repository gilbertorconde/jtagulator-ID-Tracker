// Builds src/lib/data/parts.json, the table of known IDCODE / DPIDR values.
//
//   node scripts/gen-parts.mjs --urjtag <urjtag checkout> --openocd <openocd checkout>
//
// Sources (all public):
//   openFPGALoader src/part.hpp     FPGA/CPLD IDCODEs (fetched)
//   UrJTAG urjtag/data/*/PARTS      JTAG parts by manufacturer + part number
//   OpenOCD tcl/target/*.cfg        ARM debug port IDs used per target ("seen on")
// Entries in src/lib/data/parts-extra.json (hand-added, each with its own source)
// are merged in and win over imported ones.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const here = new URL("..", import.meta.url).pathname;
const out = join(here, "src/lib/data/parts.json");
const extraFile = join(here, "src/lib/data/parts-extra.json");
const hex = (v) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
const parts = new Map(); // key: id/mask

function add(p) {
  const key = `${p.id}/${p.mask}`;
  if (!parts.has(key)) parts.set(key, p);
}

const VENDOR = {
  xilinx: "Xilinx (AMD)", altera: "Intel (Altera)", lattice: "Lattice", gowin: "Gowin", efinix: "Efinix",
  anlogic: "Anlogic", colognechip: "Cologne Chip", microchip: "Microchip", achronix: "Achronix",
};

// 1. openFPGALoader
const hpp = await (await fetch("https://raw.githubusercontent.com/trabucayre/openFPGALoader/master/src/part.hpp")).text();
for (const m of hpp.matchAll(/\{\s*(0x[0-9a-fA-F]{8}),\s*\{\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/g)) {
  const raw = parseInt(m[1], 16) >>> 0;
  const versionless = raw >>> 28 === 0;
  add({
    id: hex(raw),
    mask: versionless ? "0x0FFFFFFF" : "0xFFFFFFFF",
    name: m[4].toUpperCase(),
    vendor: VENDOR[m[2].toLowerCase()] ?? m[2],
    family: m[3],
    kind: "jtag",
    source: "openFPGALoader",
  });
}
for (const m of hpp.matchAll(/\{\s*(0x[0-9a-fA-F]{8}),\s*\{\s*"([^"]+)",\s*\d+\s*\}\s*\}/g)) {
  const raw = parseInt(m[1], 16) >>> 0;
  if (raw === 0xfffffffe) continue;
  add({ id: hex(raw), mask: "0xFFFFFFFF", name: m[2], vendor: "", family: "", kind: "any", source: "openFPGALoader" });
}

// 2. UrJTAG
const urjtag = arg("--urjtag");
if (urjtag) {
  const data = join(urjtag, "urjtag/data");
  const mfrs = new Map();
  for (const l of readFileSync(join(data, "MANUFACTURERS"), "utf8").split("\n")) {
    const m = l.match(/^([01]{11})\s+(\S+)\s+(.+?)\s*(#.*)?$/);
    if (m && m[2] !== "0") mfrs.set(m[1], { dir: m[2], name: m[3].replace(/\s+/g, " ").trim() });
  }
  for (const [bits, mfr] of mfrs) {
    const file = join(data, mfr.dir, "PARTS");
    if (!existsSync(file)) continue;
    for (const l of readFileSync(file, "utf8").split("\n")) {
      const m = l.match(/^([01]{16})\s+(\S+)\s+(.+?)\s*(#.*)?$/);
      if (!m) continue;
      const raw = ((parseInt(m[1], 2) << 12) | (parseInt(bits, 2) << 1) | 1) >>> 0;
      add({ id: hex(raw), mask: "0x0FFFFFFF", name: m[3].trim(), vendor: mfr.name, family: "", kind: "jtag", source: "UrJTAG" });
    }
  }
}

// 3. OpenOCD: ARM debug port IDs per target
const openocd = arg("--openocd");
if (openocd) {
  const dir = join(openocd, "tcl/target");
  const seen = new Map();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".cfg"))) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/(?:TAPID\s+|-expected-id\s+|-dp-id\s+)(0x[0-9a-fA-F]{8})/g)) {
      const raw = parseInt(m[1], 16) >>> 0;
      if ((raw & 0xfff) !== 0x477) continue; // ARM (JEP106 bank 4, code 0x3B) debug ports only
      const k = hex(raw);
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(f.replace(/\.cfg$/, ""));
    }
  }
  for (const [id, files] of seen) {
    const list = [...files].sort();
    add({
      id,
      mask: "0xFFFFFFFF",
      name: "ARM debug port",
      vendor: "ARM",
      family: `seen on ${list.slice(0, 5).join(", ")}${list.length > 5 ? ` and ${list.length - 5} more` : ""}`,
      kind: "any",
      source: "OpenOCD",
    });
  }
}

// 4. Hand-added entries win.
const extra = existsSync(extraFile) ? JSON.parse(readFileSync(extraFile, "utf8")).parts : [];
for (const p of extra) parts.set(`${p.id}/${p.mask}`, p);

const list = [...parts.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
writeFileSync(
  out,
  JSON.stringify(
    {
      sources: {
        openFPGALoader: "https://github.com/trabucayre/openFPGALoader/blob/master/src/part.hpp",
        UrJTAG: "https://sourceforge.net/p/urjtag/git/ci/master/tree/urjtag/data/",
        OpenOCD: "https://github.com/openocd-org/openocd/tree/master/tcl/target",
      },
      parts: list,
    },
    null,
    1,
  ) + "\n",
);
console.log(`parts.json: ${list.length} entries`);
