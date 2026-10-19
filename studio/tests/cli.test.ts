import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../cli/main";

/** Run the CLI against the simulator and capture its output. */
async function cli(...argv: string[]) {
  let out = "";
  let err = "";
  const code = await main(["--sim", ...argv], { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err, json: () => JSON.parse(out) };
}

describe("jtagulator-cli on the simulator", () => {
  it("prints help and the version", async () => {
    expect((await cli("--help")).out).toContain("Usage: jtagulator-cli");
    expect((await cli("--version")).out).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it("reads info and sets the voltage", async () => {
    expect((await cli("info")).out).toContain("ID Tracker 1.4 (simulated)");
    const r = await cli("--json", "voltage", "3.3");
    expect(r.json()).toEqual({ voltage: 3.3 });
  });

  it("finds the simulated JTAG pinout and its devices", async () => {
    const r = await cli("-v", "3.3", "--json", "scan", "jtag", "--start", "0", "--end", "7");
    expect(r.code).toBe(0);
    const f = r.json().findings[0];
    expect([f.tdi, f.tdo, f.tck, f.tms]).toEqual([3, 5, 2, 4]);
    const ids = await cli("-v", "3.3", "ids", "jtag", "--tdo", "5", "--tck", "2", "--tms", "4");
    expect(ids.out).toContain("0x4BA00477");
    expect(ids.out).toContain("0x06413041");
  });

  it("finds SWD and checks BYPASS", async () => {
    expect((await cli("-v", "3.3", "scan", "swd", "--end", "9")).out).toMatch(/SWDIO CH9, SWCLK CH8/);
    const b = await cli("-v", "3.3", "--json", "bypass", "--tdi", "3", "--tdo", "5", "--tck", "2", "--tms", "4");
    expect(b.json()).toMatchObject({ match: true, devices: 2 });
  });

  it("runs a script with the app's API", async () => {
    const file = path.join(os.tmpdir(), `jtag-cli-${process.pid}.js`);
    fs.writeFileSync(file, `const r = await jtag.deviceIds({ tdo: 5, tck: 2, tms: 4 });\nlog("devices", r.devices.length);\nreturn r.devices.map((d) => hex(d.idcode.raw));`);
    const r = await cli("-v", "3.3", "run", file);
    fs.rmSync(file);
    expect(r.out).toBe('devices 2\n[\n  "0x4BA00477",\n  "0x06413041"\n]\n');
  });

  it("explains mistakes with exit code 2", async () => {
    const noV = await cli("scan", "jtag");
    expect(noV.code).toBe(2);
    expect(noV.err).toMatch(/Set the target voltage first/);
    expect((await cli("scan", "nope")).code).toBe(2);
    expect((await cli("--start", "x", "-v", "3.3", "scan", "jtag")).err).toMatch(/whole number/);
    expect((await cli("frobnicate")).err).toMatch(/Unknown command/);
    expect((await cli("--bogus")).code).toBe(2);
    const fw = await cli("firmware", "install");
    expect(fw.err).toMatch(/--yes/);
  });

  it("reports errors as JSON with --json", async () => {
    const r = await cli("--json", "ids", "jtag", "--tdo", "5", "--tck", "2", "--tms", "4");
    expect(r.code).toBe(1);
    expect(r.json().error).toMatch(/voltage/i);
  });
});
