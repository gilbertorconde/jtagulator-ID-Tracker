import { describe, expect, it } from "vitest";
import { decodeDpidr, decodeJtag, findPart, knownPartCount } from "../src/lib/core/idcode";

describe("known parts table", () => {
  it("has a few hundred sourced entries", () => {
    expect(knownPartCount).toBeGreaterThan(400);
  });

  it("matches FPGA IDCODEs regardless of the version nibble", () => {
    for (const raw of [0x0362d093, 0x1362d093, 0xf362d093]) {
      expect(findPart(raw, "jtag")).toMatchObject({ name: "XC7A35", vendor: "Xilinx (AMD)", source: "openFPGALoader" });
    }
    expect(decodeJtag(0x41111043).part).toBe("LFE5U-25 (ECP5)");
  });

  it("prefers an exact match over a masked one and links the source", () => {
    const p = findPart(0x4ba00477, "jtag");
    expect(p?.name).toBe("ARM cortex A9");
    expect(p?.sourceUrl).toMatch(/^https:\/\/github.com\/trabucayre\/openFPGALoader/);
  });

  it("names ARM debug ports from OpenOCD and falls back to the ARM spec", () => {
    expect(decodeDpidr(0x6ba02477).part).toMatch(/stm32h7x/);
    // An ARM SW-DP value nobody lists still gets a generic name.
    expect(decodeDpidr(0x9bc11477).part).toBe("ARM CoreSight debug port");
    expect(decodeJtag(0x7ba00477).part).toBe("ARM CoreSight JTAG-DP");
  });

  it("returns null for unknown parts", () => {
    expect(findPart(0x12345679, "jtag")).toBeNull();
    expect(decodeJtag(0x12345679).part).toBeNull();
  });
});
