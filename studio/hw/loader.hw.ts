// Loads programs into RAM only (never EEPROM): the board returns to its own
// firmware on the next reset.
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeImage, loadPropeller } from "../src/lib/firmware/loader";
import { JTAGulator } from "../src/lib/core/jtagulator";
import { Session } from "../src/lib/core/session";
import { latin1 } from "../src/lib/core/transport";
import { TtyTransport } from "./tty-transport";

const PORT = process.env.JTAGULATOR_PORT ?? "/dev/ttyUSB0";
const asset = (n: string) => new Uint8Array(fs.readFileSync(new URL(`../src/lib/firmware/assets/${n}`, import.meta.url)));
let t: TtyTransport;

beforeAll(async () => {
  t = new TtyTransport(PORT);
  await t.open();
});
afterAll(async () => {
  // Reset back into the board's own firmware.
  await t.setDtr(true);
  await new Promise((r) => setTimeout(r, 10));
  await t.setDtr(false);
  await t.close();
});

describe("Propeller loader (RAM only)", () => {
  it("describes bundled images", () => {
    expect(describeImage(asset("jtagulator.binary"))).toMatchObject({ idTracker: true, version: "1.3" });
  });

  it("runs the EEPROM probe from RAM", async () => {
    let out = "";
    const unsub = t.onData((d) => (out += latin1(d)));
    const phases: string[] = [];
    const r = await loadPropeller(t, asset("eeprom-probe.binary"), "ram", (p) => phases.push(p.phase));
    await new Promise((res) => setTimeout(res, 1500));
    unsub();
    console.log("chip version", r.chipVersion, phases.filter((p, i) => phases[i - 1] !== p).join(","));
    console.log("probe output:", JSON.stringify(out.slice(-200)));
    expect(r.chipVersion).toBe(1);
    expect(out).toMatch(/JTS-PROBE flag=[0-9A-F]{2} .* end/);
  });

  it("runs ID Tracker 1.3 from RAM and the API talks to it", async () => {
    await loadPropeller(t, asset("jtagulator.binary"), "ram");
    const s = new Session(t);
    await s.connect();
    const dev = new JTAGulator(s);
    expect(await dev.sync()).toBe("normal");
    const info = await dev.info();
    console.log("RAM firmware:", info.firmware);
    expect(info.version).toBe("1.3");
  });
});
