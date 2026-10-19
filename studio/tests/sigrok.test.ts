import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toSigrok } from "../src/lib/logic/export";
import type { Capture } from "../src/lib/logic/sump";

/** Files in a store-only ZIP, read through the central directory. */
function unzip(z: Uint8Array): Record<string, Uint8Array> {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const end = z.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out: Record<string, Uint8Array> = {};
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(z.subarray(p + 46, p + 46 + nameLen));
    const local = v.getUint32(p + 42, true);
    const start = local + 30 + v.getUint16(local + 26, true);
    out[name] = z.subarray(start, start + size);
    p += 46 + nameLen;
  }
  return out;
}

const cap: Capture = {
  sampleRateHz: 909_090,
  samples: new Uint32Array(20).map((_, i) => (i * 0x010203) & 0xffffff),
  channelMask: 0xffffff,
  triggerIndex: null,
  capturedAt: 0,
};

describe("sigrok .sr export", () => {
  it("writes version, metadata and 3-byte samples", () => {
    const f = unzip(toSigrok(cap, { names: ["TCK", "TMS"] }));
    expect(Object.keys(f)).toEqual(["version", "metadata", "logic-1-1"]);
    expect(new TextDecoder().decode(f.version)).toBe("2");
    const meta = new TextDecoder().decode(f.metadata);
    expect(meta).toContain("samplerate=909.09 kHz");
    expect(meta).toContain("probe1=TCK\nprobe2=TMS\nprobe3=CH2\n");
    expect(meta).toContain("unitsize=3");
    expect([...f["logic-1-1"].subarray(3, 6)]).toEqual([0x03, 0x02, 0x01]);
    expect(f["logic-1-1"].length).toBe(60);
  });

  // Set SIGROK_CLI to a sigrok-cli binary to check the file with libsigrok itself.
  it.skipIf(!process.env.SIGROK_CLI)("opens in sigrok-cli", () => {
    const file = path.join(os.tmpdir(), `jtagulator-${process.pid}.sr`);
    fs.writeFileSync(file, toSigrok(cap, { names: ["TCK"] }));
    const csv = execFileSync(process.env.SIGROK_CLI!, ["-i", file, "-O", "csv"], { encoding: "utf8" });
    fs.rmSync(file);
    expect(csv).toContain("Samplerate: 909.09 kHz");
    const rows = csv.split("\n").filter((l) => /^[01],/.test(l));
    expect(rows.length).toBe(20);
    expect(rows[1].split(",").map(Number).reduce((v, b, k) => v | (b << k), 0)).toBe(0x010203);
  });
});
