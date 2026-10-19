import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { describeCell, instructionNames, matchesIdcode, opcodeOf, parseBsdl } from "../src/lib/bsdl/parser";

const demo = parseBsdl(fs.readFileSync(new URL("../examples/SIM_DEMO_CHIP.bsd", import.meta.url), "utf8"));

describe("BSDL parser", () => {
  it("reads the entity, lengths and IDCODE", () => {
    expect(demo.entity).toBe("SIM_DEMO_CHIP");
    expect(demo.irLength).toBe(4);
    expect(demo.bsrLength).toBe(64);
    expect(demo.cells).toHaveLength(64);
    expect(demo.idcodeBits).toBe("XXXX0110010000010011000001000001");
    expect(matchesIdcode(demo, 0x06413041)).toBe(true);
    expect(matchesIdcode(demo, 0x56413041)).toBe(true); // version is X
    expect(matchesIdcode(demo, 0x06413043)).toBe(false);
  });

  it("reads opcodes, including several per instruction and X bits", () => {
    expect(opcodeOf(demo, "EXTEST")).toBe(0);
    expect(instructionNames(demo, 0b0010, 4).sort()).toEqual(["PRELOAD", "SAMPLE"]);
    expect(instructionNames(demo, 0b1111, 4)).toEqual(["BYPASS"]);
    expect(instructionNames(demo, 0b0101, 4)).toEqual(["BYPASS"]); // 0XX1
    expect(instructionNames(demo, 0b0100, 4)).toEqual([]);
  });

  it("describes boundary cells with package pins and control cells", () => {
    expect(describeCell(demo, 10)?.label).toBe("PA0 (pin 10), output3");
    expect(describeCell(demo, 11)?.label).toBe("controls PA0 (pin 10), control");
    expect(describeCell(demo, 12)?.label).toBe("PA0 (pin 10), input");
    expect(describeCell(demo, 5)?.label).toBe("internal, internal");
    expect(describeCell(demo, 99)).toBeNull();
    expect(demo.pinMaps.TQFP48.VDD).toEqual(["24", "48"]);
  });

  it("ignores comments, keeps strings and rejects non-BSDL text", () => {
    const b = parseBsdl(`-- header -- with dashes
entity X is attribute INSTRUCTION_LENGTH of X : entity is 2; -- trailing
attribute INSTRUCTION_OPCODE of X : entity is "BYPASS (11)," & -- note
 "EXTEST (00)"; end X;`);
    expect(b.irLength).toBe(2);
    expect(b.opcodes).toEqual({ BYPASS: ["11"], EXTEST: ["00"] });
    expect(() => parseBsdl("hello world")).toThrow(/Not a BSDL file/);
  });
});
