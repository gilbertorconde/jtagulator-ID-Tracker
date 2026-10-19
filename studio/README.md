# JTAGulator Studio

JTAGulator Studio is a desktop frontend for the [JTAGulator](https://jtagulator.com). It works with the stock firmware and with ID Tracker, and is built with Tauri v2, Svelte 5 and TypeScript.

The app talks to the firmware's text menu over USB serial at 115200 8N1. It answers every prompt from the form values and turns the firmware's text output into structured results.

## Features

- **JTAG**: combined, IDCODE, BYPASS (with known pins) and RTCK scans, plus reading device IDs, a BYPASS test, IR/DR discovery, the EXTEST pin mapper and OpenOCD mode.
- **SWD**: pinout scan, plus reading and decoding the DPIDR.
- **UART**: active scan, passive TXD scan that measures the baud rate, and a passthrough terminal.
- **GPIO**: read all channels, monitor them live with a change log, or drive them as outputs.
- **Logic analyzer**: OLS/SUMP capture client with a 24-channel waveform viewer, triggers (all 24 channels and pre-trigger capture on ID Tracker 1.3), UART, SPI and I2C decoders, and VCD and CSV export.
- **Scan all**: runs any set of scans one after another.
- **Chip ID decoding**: IDCODE and DPIDR values are decoded in the app against the 1,953-entry JEP106 manufacturer table, plus a list of known part numbers.
- **Target profile**: stores known pins, channel labels and every finding for the board you're testing. It saves automatically and exports as JSON or a Markdown report.
- **Scripts**: sandboxed JavaScript that runs in a Web Worker and uses the same API as the UI.
  - `uart.expect` waits for target output.
  - Scripts are stored as files in the app data folder.
  - A **macro recorder** turns UI actions into a script.
- **Firmware page**: shows the installed version, loads firmware into RAM for a test run or programs the EEPROM, checks GitHub releases for updates, and checks for or writes the manufacturer database. It uses a built-in Propeller loader (`src/lib/firmware/loader.ts`), so no external tools are needed.
- **Device terminal**: raw view of the firmware's own menu.
- **Simulator**: a built-in software JTAGulator with a fake target, so you can try everything without hardware.

## Develop

```sh
pnpm install
pnpm tauri dev          # desktop app
pnpm dev                # browser only (simulator, or Web Serial in Chrome)
pnpm test               # API + logic analyzer tests against the simulator
pnpm check              # svelte-check
pnpm tauri build        # installers
npx vitest run --config hw/vitest.config.ts   # against a real JTAGulator (JTAGULATOR_PORT, default /dev/ttyUSB0)
scripts/build-firmware.sh                     # rebuild bundled firmware images (needs OpenSpin)
```

The hardware tests need nothing wired to the channels. They load firmware into RAM only, so the installed firmware is never changed.

On Linux you need `webkit2gtk-4.1` installed. Opening the serial port resets the Propeller through DTR, so the app waits briefly before it syncs to the command prompt.

## Layout

| Path | Contents |
| --- | --- |
| `src/lib/core` | Serial transports, session and expect engine, output parser, `JTAGulator` API, IDCODE decoding |
| `src/lib/sim` | Firmware simulator |
| `src/lib/logic` | SUMP client, decoders, export |
| `src/lib/scripting` | Shared call registry (used by the UI, scripts and recorder), worker runtime, script library |
| `src/lib/ui` | Components and views |
| `src-tauri` | Serial port, file access, OpenOCD process runner |

To rebuild `src/lib/data/jep106.json` from `../eepromupdate/jep106.inc`, run `pnpm gen:jep106`.
