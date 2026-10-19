// Builds src/lib/data/jep106.json from the firmware's EEPROM database
// (eepromupdate/jep106.inc). Entry N (0-based) is bank floor(N/126), code (N%126)+1,
// the same layout the firmware's report_manufacturer_name() reads from EEPROM.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = new URL("../../eepromupdate/jep106.inc", import.meta.url);
const out = new URL("../src/lib/data/jep106.json", import.meta.url);

const names = [];
for (const line of readFileSync(src, "latin1").split(/\r?\n/)) {
  const m = line.match(/byte\s+"([^"]*)",0'(.*)$/);
  if (!m) continue;
  const full = m[2].trim() || m[1].trim();
  names.push(full);
}
mkdirSync(new URL("../src/lib/data/", import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify(names) + "\n");
console.log(`jep106.json: ${names.length} manufacturers`);
