# Scripting

The **Scripts** page runs JavaScript against the JTAGulator, using the same functions as the UI, so anything you can click you can also automate. Scripts run in a sandboxed Web Worker: they reach the device only through the functions below, not the UI, files or the network. Every function is async.

```js
// Set the voltage, find the JTAG pinout, then read every IDCODE.
await device.setVoltage(3.3);
const scan = await jtag.scan({ start: 0, end: 7 });
if (!scan.findings.length) {
  log("No JTAG found on CH0-7");
  return;
}
const p = scan.findings[0];
const ids = await jtag.deviceIds({ tdo: p.tdo, tck: p.tck, tms: p.tms });
for (const d of ids.devices) log(`#${d.index} ${d.idcode.hex} ${d.idcode.manufacturer ?? "unknown"}`);
```

- **Macro recorder.** Click **Record macro**, use the UI, then stop: your actions become a script.
- **Library.** Scripts are saved as files in the app's data folder. Examples cover finding JTAG, trying every interface, interrupting U-Boot and sweeping voltages for SWD.
- **Return values** are shown when the script finishes. `Ctrl+Enter` runs the script.
- **Command line.** `pinhound run script.js` runs the same scripts from a terminal (see [Command-line tool](/studio/cli)).

## Device functions

<!--@include: ./_api-reference.md-->

## Sessions and helpers

| Function | What it does |
| :--- | :--- |
| `uart.passthrough({ txd, rxd, baud })` | Open the target console. Returns a handle for the functions below. |
| `uart.send(pt, text)` | Send text or bytes to the target. |
| `uart.expect(pt, /regex/, timeoutMs)` | Wait for target output. Returns `{ match, groups, before }`. |
| `uart.read(pt)` | Everything received since the last read or expect. |
| `uart.close(pt)` | Close the console. |
| `gpio.drive(value)` / `gpio.release(h)` | Drive outputs with a 24-bit value until released. |
| `term.send(text)` / `term.expect(/regex/, timeoutMs)` | Raw access to the JTAGulator's own text menu. |
| `target.get()` | Known pins and findings for the current target (app only). |
| `sleep(ms)`, `log(...)`, `hex(n, digits)`, `bytes([..] or "text")` | Utilities. |

Interrupting U-Boot on the target console:

```js
const t = await target.get();
const pt = await uart.passthrough({ txd: t.uart.txd ?? 0, rxd: t.uart.rxd ?? 1, baud: t.uart.baud ?? 115200 });
log("Power-cycle the target now…");
await uart.expect(pt, /Hit any key|autoboot/i, 60000);
await uart.send(pt, " ");
await uart.expect(pt, /=> $/m, 5000);
await uart.send(pt, "printenv\r");
log((await uart.expect(pt, /=> $/m, 5000)).before);
await uart.close(pt);
```
