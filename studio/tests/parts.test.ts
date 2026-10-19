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

  it("links each part to its source", () => {
    expect(findPart(0x0362d093, "jtag")?.sourceUrl).toMatch(/^https:\/\/github.com\/trabucayre\/openFPGALoader/);
  });

  it("doesn't name generic ARM debug ports after one board", () => {
    // 0x4BA00477 is used by Cortex-A9 and by Cortex-M chips such as STM32F4.
    const p = findPart(0x4ba00477, "jtag");
    expect(p?.name).toBe("ARM debug port");
    expect(p?.seenOn).toContain("stm32f4x");
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
