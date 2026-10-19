import { describe, expect, it } from "vitest";
import type { Finding } from "../src/lib/core/types";
import { blankTarget, mergeTargets, parseTarget, serializeTarget, type TargetProfile } from "../src/lib/target/profile";

const uart = (baud: number): Finding => ({ kind: "uart", txd: 4, rxd: 5, baud, data: "", ascii: "" }) as unknown as Finding;
const rtck: Finding = { kind: "rtck", tck: 1, rtck: 6 } as Finding;

function sample(): TargetProfile {
  return {
    ...blankTarget(),
    id: "board-a",
    name: "Router X",
    notes: "J3 near the SoC",
    voltage: 3.3,
    jtag: { tdi: 0, tdo: 1, tck: 2, tms: 3, trst: null, rtck: null },
    uart: { txd: 4, rxd: 5, baud: 115200 },
    findings: [{ at: 2000, op: "uartScan", finding: uart(115200) }],
    channelNames: { 0: "TP12", 4: "J3-2" },
  };
}

describe(".jtarget files", () => {
  it("round-trips a target", () => {
    const t = sample();
    const text = serializeTarget(t);
    expect(JSON.parse(text)).toMatchObject({ format: "jtagulator-target", version: 1 });
    const { target, skipped } = parseTarget(text);
    expect(skipped).toBe(0);
    expect(target).toEqual(t);
  });

  it("reads the plain profile JSON older versions saved", () => {
    expect(parseTarget(JSON.stringify(sample())).target.name).toBe("Router X");
  });

  it("cleans bad values and skips unknown findings", () => {
    const raw = {
      ...sample(),
      jtag: { tdi: 99, tdo: "1", tck: 2.5, tms: -1, trst: 7, rtck: null, evil: 1 },
      channelNames: { 30: "nope", 2: "  ", 3: "ok" },
      findings: [{ at: 1, op: "x", finding: { kind: "mystery" } }, { at: 5, op: "rtck", finding: rtck }, "junk"],
      extra: "dropped",
    };
    const { target, skipped } = parseTarget(JSON.stringify(raw));
    expect(target.jtag).toEqual({ tdi: null, tdo: null, tck: null, tms: null, trst: 7, rtck: null });
    expect(target.channelNames).toEqual({ 3: "ok" });
    expect(target.findings.map((f) => f.finding.kind)).toEqual(["rtck"]);
    expect(skipped).toBe(2);
    expect("extra" in target).toBe(false);
  });

  it("refuses files from a newer format and things that aren't targets", () => {
    expect(() => parseTarget(JSON.stringify({ format: "jtagulator-target", version: 9, target: sample() }))).toThrow(/version 9/);
    expect(() => parseTarget("{")).toThrow(/valid JSON/);
    expect(() => parseTarget(JSON.stringify({ hello: 1 }))).toThrow(/Not a JTAGulator Studio target/);
  });
});

describe("merging targets", () => {
  it("keeps what the current target knows, fills gaps and reports conflicts", () => {
    const base = sample();
    const file: TargetProfile = {
      ...blankTarget(),
      name: "Router X (Ana)",
      notes: "UART console at 115200, root shell",
      voltage: 1.8,
      jtag: { tdi: 0, tdo: 1, tck: 2, tms: 3, trst: 8, rtck: 6 },
      swd: { swdio: 10, swclk: 11 },
      findings: [
        { at: 2000, op: "uartScan", finding: uart(115200) },
        { at: 3000, op: "rtckScan", finding: rtck },
      ],
      channelNames: { 0: "TP7", 8: "TRST" },
    };
    const { target, conflicts } = mergeTargets(base, file);
    expect(target.id).toBe("board-a");
    expect(target.name).toBe("Router X");
    expect(target.voltage).toBe(3.3);
    expect(target.jtag).toEqual({ tdi: 0, tdo: 1, tck: 2, tms: 3, trst: 8, rtck: 6 });
    expect(target.swd).toEqual({ swdio: 10, swclk: 11 });
    expect(target.findings.map((f) => f.op)).toEqual(["rtckScan", "uartScan"]);
    expect(target.channelNames).toEqual({ 0: "TP12", 4: "J3-2", 8: "TRST" });
    expect(target.notes).toBe("J3 near the SoC\n\nUART console at 115200, root shell");
    expect(conflicts).toEqual(['Voltage: kept 3.3, file has 1.8', 'CH0 label: kept "TP12", file has "TP7"']);
  });

  it("merging the same file twice changes nothing more", () => {
    const once = mergeTargets(sample(), sample()).target;
    const twice = mergeTargets(once, sample()).target;
    expect({ ...twice, updatedAt: 0 }).toEqual({ ...once, updatedAt: 0 });
    expect(once.findings.length).toBe(1);
  });
});
