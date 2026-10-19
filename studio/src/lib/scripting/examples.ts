// Starter scripts seeded into an empty library.
export const EXAMPLES: { name: string; code: string }[] = [
  {
    name: "Find JTAG and read IDs",
    code: `// Set the voltage, find the JTAG pinout, then read every IDCODE.
await device.setVoltage(3.3);

const scan = await jtag.scan({ start: 0, end: 7 });
if (!scan.findings.length) {
  log("No JTAG found on CH0-7");
  return;
}
const p = scan.findings[0];
log(\`TDI=\${p.tdi} TDO=\${p.tdo} TCK=\${p.tck} TMS=\${p.tms}\`);

const ids = await jtag.deviceIds({ tdo: p.tdo, tck: p.tck, tms: p.tms });
for (const d of ids.devices) {
  log(\`#\${d.index} \${d.idcode.hex}  \${d.idcode.manufacturer ?? "unknown"}\`);
}
`,
  },
  {
    name: "Try every interface",
    code: `// Runs JTAG, SWD and UART discovery over the same channels and prints a summary.
const range = { start: 0, end: 7 };
await device.setVoltage(3.3);

const results = {
  jtag: (await jtag.scan(range)).findings,
  swd: (await swd.scan(range)).findings,
  uartTxd: (await uart.txdScan({ ...range, durationMs: 5000 })).findings,
};
for (const [k, v] of Object.entries(results)) log(\`\${k}: \${v.length} found\`);
return results;
`,
  },
  {
    name: "Interrupt U-Boot autoboot",
    code: `// Opens the target console, waits for the U-Boot countdown and stops it.
const t = await target.get();
const pt = await uart.passthrough({ txd: t.uart.txd ?? 0, rxd: t.uart.rxd ?? 1, baud: t.uart.baud ?? 115200 });

log("Power-cycle the target now…");
await uart.expect(pt, /Hit any key|autoboot/i, 60000);
await uart.send(pt, " ");
await uart.expect(pt, /=> $/m, 5000);

await uart.send(pt, "printenv\\r");
const env = await uart.expect(pt, /=> $/m, 5000);
log(env.before);
await uart.close(pt);
`,
  },
  {
    name: "Voltage sweep for SWD",
    code: `// Some targets only answer at their own I/O level. Try SWD at each common voltage.
for (const v of [1.8, 2.5, 3.3]) {
  await device.setVoltage(v);
  const r = await swd.scan({ start: 0, end: 7 });
  log(\`\${v} V: \${r.findings.length} SWD pinout(s)\`);
  if (r.findings.length) return r.findings;
}
`,
  },
];
