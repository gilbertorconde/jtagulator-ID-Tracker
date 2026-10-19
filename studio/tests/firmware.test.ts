import { describe, expect, it } from "vitest";
import { compareVersions, parseProbe } from "../src/lib/firmware/manager";
import { describeImage, encodeLong, prepareImage } from "../src/lib/firmware/loader";

describe("firmware helpers", () => {
  it("parses the probe line", () => {
    const full = parseProbe("JTS-PROBE flag=5A mode=-1 vtarget=-1 amd=AMD arm=ARM_Ltd st=STMicroelectroni end");
    expect(full).toEqual({ flag: 0x5a, complete: true, samples: { amd: "AMD", arm: "ARM Ltd", st: "STMicroelectroni" }, mode: -1 });
    const empty = parseProbe("JTS-PROBE flag=FF mode=0 vtarget=0 amd=________________ arm=________________ st=________________ end");
    expect(empty?.complete).toBe(false);
    expect(empty?.samples).toEqual({ amd: null, arm: null, st: null });
  });

  it("compares versions numerically", () => {
    expect(compareVersions("1.12", "1.3")).toBe(1);
    expect(compareVersions("1.3", "1.3.0")).toBe(0);
    expect(compareVersions("1.2", "1.3")).toBe(-1);
  });

  it("encodes longs for the boot ROM (3 bits per byte)", () => {
    const b = encodeLong(0xffffffff);
    expect(b).toHaveLength(11);
    expect(b.slice(0, 10).every((x) => x === 0xff - 0x24)).toBe(true); // 0x92|1|8|0x40 = 0xdb
    expect(b[10]).toBe(0xfb);
    expect(encodeLong(0)).toEqual([...Array(10).fill(0x92), 0xf2]);
  });

  it("rejects files that aren't Propeller images and trims .eeprom images", () => {
    expect(() => prepareImage(new Uint8Array(64))).toThrow(/Propeller/);
    const img = new Uint8Array(0x8000);
    const dv = new DataView(img.buffer);
    dv.setUint32(0, 80_000_000, true);
    dv.setUint16(6, 0x10, true);
    dv.setUint16(8, 0x100, true);
    expect(prepareImage(img).length).toBe(0x100);
    expect(describeImage(img).firmware).toBeNull();
  });
});
