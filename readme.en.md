<div align="center">

🌍 **Language** / **语言选择**

[![中文](https://img.shields.io/badge/中文-red?style=for-the-badge)](readme.md)
[![English](https://img.shields.io/badge/English-blue?style=for-the-badge)](readme.en.md)

</div>

---

# 🔍 JTAGulator-ID-Tracker

**Enhanced JTAGulator firmware with a 2,000+ chip-manufacturer ID database, plus JTAGulator Studio, a desktop and browser app for driving it**

*Hardware security testing · JTAG/SWD/UART interface discovery · Automatic chip manufacturer identification*

---

## 📖 Table of Contents

- [Overview](#overview)
- [✨ Features](#-features)
- [🖥️ JTAGulator Studio](#️-jtagulator-studio)
- [🧩 Hardware Requirements](#-hardware-requirements)
- [📦 Flashing Guide](#-flashing-guide)
- [🔧 Screenshots](#-screenshots)
- [📊 Manufacturer Database](#-manufacturer-database)
- [🎯 Use Cases](#-use-cases)
- [🤝 Contributing](#-contributing)
- [⚠️ Notes and Warnings](#️-notes-and-warnings)
- [📄 License](#-license)

---

## Overview

**JTAGulator-ID-Tracker** is enhanced firmware for the open-source **[JTAGulator](https://github.com/grandideastudio/jtagulator)**. Joe Grand ([@joegrand](https://github.com/joegrand)) designed the JTAGulator as a hardware security tool for finding on-chip debug interfaces on embedded devices.

### About the original JTAGulator

- **Purpose**: finds JTAG, SWD, UART and other debug interfaces automatically
- **MCU**: Parallax Propeller P8X32A
- **Storage**: 24LC512 EEPROM (64 KB) for program and data
- **Uses**: hardware security research, reverse engineering, device diagnostics

### What this project adds

1. **Firmware**: the stock firmware uses only half of the EEPROM (32 KB). This firmware uses all 64 KB and stores a chip manufacturer database there. JTAG and SWD scans then show the manufacturer name next to each ID.
2. **JTAGulator Studio** (`studio/`): a graphical frontend that replaces the serial terminal. See [below](#️-jtagulator-studio).

---

## ✨ Features

| Feature | Original JTAGulator | ID Tracker |
| :--- | :--- | :--- |
| **EEPROM usage** | 50% (32 KB / 64 KB) | **100% (64 KB / 64 KB)** |
| **Manufacturer ID database** | None | **2,000+ manufacturers** |
| **JTAG scan** | Pinout only | **Pinout + manufacturer name** |
| **SWD scan** | Pinout only | **Pinout + manufacturer name** |
| **Database updates** | None | **Flash once, keep forever** |
| **Graphical frontend** | None (serial terminal) | **JTAGulator Studio** |

### Highlights

1. **Manufacturer identification**: names the chip manufacturer for ARM, MIPS, PowerPC and other architectures.
2. **No extra lookups**: the manufacturer name is shown during the scan.
3. **Broad coverage**: the major vendors plus many smaller ones.
4. **Backward compatible**: every original JTAGulator feature still works.

---

## 🖥️ JTAGulator Studio

<div align="center">
<img src="image/studio-jtag.png" alt="JTAGulator Studio: JTAG scan" width="90%">
<p><em>A JTAG scan in JTAGulator Studio: pinout, TRST#, and each IDCODE decoded with its manufacturer</em></p>
</div>

JTAGulator Studio is a desktop app, built with Tauri, that also runs in a browser. It drives the JTAGulator's own serial menu: it answers each prompt from your form inputs and shows the results as structured cards instead of terminal text. It works with ID Tracker and with the stock firmware.

### What it does

| Area | Features |
| :--- | :--- |
| **JTAG** | Combined / IDCODE / BYPASS / RTCK scans (BYPASS can use pins you already know), device IDs, BYPASS test, IR/DR discovery, EXTEST pin mapper, OpenOCD mode |
| **SWD** | Pinout scan, DPIDR read and decode |
| **UART** | Active scan, passive TXD scan with baud rate measurement, built-in terminal for the target console |
| **GPIO** | Read all 24 channels, live monitor with change log, drive outputs |
| **Logic analyzer** | OLS/SUMP capture, 24-channel waveform viewer, UART decoder, measurement markers, VCD/CSV export |
| **Scan all** | Runs any combination of scans one after another over the same channels |
| **Chip IDs** | IDCODE and DPIDR decoded in the app against the 1,953-entry JEP106 table, plus well-known part numbers. This works on stock firmware too. |
| **Target profile** | Known pins, channel labels and all findings for the board under test. Saved automatically; export as JSON or a Markdown report. |
| **Scripts** | Sandboxed JavaScript with the same functions as the UI, including `uart.expect()` for console automation. Includes a script library and a **macro recorder** that turns your clicks into a script. |
| **Device terminal** | Raw view of the firmware menu, always available |
| **Simulator** | A built-in software JTAGulator with a fake target board, so you can try everything without hardware |

<div align="center">
<img src="image/studio-logic.png" alt="JTAGulator Studio: logic analyzer" width="90%">
<p><em>Logic analyzer capture</em></p>
</div>

A script example: find JTAG, then read every IDCODE.

```js
await device.setVoltage(3.3);
const scan = await jtag.scan({ start: 0, end: 7 });
const p = scan.findings[0];
const ids = await jtag.deviceIds({ tdo: p.tdo, tck: p.tck, tms: p.tms });
for (const d of ids.devices) log(d.idcode.hex, d.idcode.manufacturer);
```

### Running it

Requirements: [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io). The desktop app also needs [Rust](https://rustup.rs) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (on Linux, `webkit2gtk-4.1`).

```sh
cd studio
pnpm install

pnpm tauri dev      # desktop app
pnpm dev            # browser at http://localhost:1420
pnpm tauri build    # build installers (.deb, .rpm, AppImage, .msi, .dmg)
```

- **In the browser**: use Chrome or Edge to reach a real JTAGulator. They support Web Serial, which needs `localhost` or HTTPS. Other browsers can only run the simulator.
- **Remote machine**: if the dev server runs on another machine, tunnel the port, e.g. `ssh -L 1420:localhost:1420 <host>`, then open `http://localhost:1420`.
- **Connecting**: pick the serial port (FTDI ports are marked ★), click **Connect**, and set the target voltage in the top bar. Or click **Try the simulator**.

More detail is in [`studio/README.md`](studio/README.md).

---

## 🧩 Hardware Requirements

### Required

- JTAGulator
- Mini USB cable (to the computer)
- Jumper wires (to the target)

### Supported targets

- Any embedded device with a JTAG or SWD interface
- Target I/O levels from 1.4 V to 3.3 V
- UARTs at standard baud rates
- Other devices that support boundary scan

---

## 📦 Flashing Guide

### Step 1: Flash the manufacturer database

**This is the most important step, and you only do it once.**

```text
Using Propeller Tool (or OpenPropeller):
1. Open the eepromupdate folder
2. Set EEPROM_Update.spin as the top-level file
3. Connect the JTAGulator to your computer
4. Compile and load it to EEPROM
```

**While the database is written:**

- Open a serial terminal at 115200 bps, 8 data bits, 1 stop bit, no parity
- Connect to the JTAGulator

<div align="center">
<img src="image/running.png" alt="Writing the database" width="80%">
<p><em>Database write in progress</em></p>
</div>

- **The write takes about 20 minutes.** Progress shows in the terminal.
- The device stops on its own when finished. If it's interrupted, power-cycle and it resumes. Once the write succeeds it won't run again.

<div align="center">
<img src="image/finish.png" alt="Database write complete" width="80%">
<p><em>Database write complete</em></p>
</div>

> 💡 **Tip**: the database survives firmware updates. After this step you can switch firmware versions freely without writing it again.

### Step 2: Flash the main firmware

```text
1. Go back to the project root
2. Set JTAGulator.spin as the top-level file
3. Compile and load it to EEPROM
4. The device is ready after it resets
```

### Serial settings

| Parameter | Value |
| :--- | :--- |
| Baud rate | 115200 |
| Data bits | 8 |
| Stop bits | 1 |
| Parity | None |
| Flow control | None |

You can use JTAGulator Studio or any serial terminal.

---

## 🔧 Screenshots

<div align="center">
<img src="image/jtag.png" alt="JTAG scan result" width="80%">
<p><em>JTAG scan showing the manufacturer name (serial terminal)</em></p>
</div>

<div align="center">
<img src="image/swd.png" alt="SWD scan result" width="80%">
<p><em>SWD scan showing the manufacturer name (serial terminal)</em></p>
</div>

---

## 📊 Manufacturer Database

### Coverage

| Category | Count | Examples |
| :--- | :--- | :--- |
| **Major chip vendors** | 150+ | Intel, ARM, ST, NXP, TI |
| **Asian manufacturers** | 800+ | Mainland China, Taiwan, Korea, Japan |
| **Specialized ICs** | 400+ | Communications, industrial control, automotive |
| **MCU makers** | 600+ | Microcontroller vendors |
| **Other** | 50+ | FPGA and CPLD vendors |

### How lookup works

The database follows the JEDEC **JEP106** manufacturer list, the same list used by the manufacturer field of a JTAG IDCODE and the designer field of an ARM DPIDR. That field holds a bank number (bits 11..8) and a 7-bit code (bits 7..1). The table stores 126 entries per bank, 16 bytes per name, starting at EEPROM address `0x8080`.

> **Fix in this version**: earlier releases looked up JTAG names using the raw 11-bit field as the table index. That gave the wrong name for every manufacturer outside bank 0; for example ARM (`0x43B`) read entry 571 instead of 563. JTAG now uses the same `bank × 126 + code` index as SWD (`JTAGulator.spin`, `Display_Device_ID`).

---

## 🎯 Use Cases

### 1. Hardware security assessment

- Find exposed debug interfaces and judge the risk
- Discover hidden test points and debug ports
- Get a hardware foothold for penetration tests

### 2. Reverse engineering

- Work out the architecture of unknown devices
- Identify the chip manufacturer and likely part
- Gather debug interface details for deeper analysis

### 3. Repair and debugging

- Recover bricked devices
- Reach debug and programming interfaces
- Extract or update firmware

### 4. Learning

- How JTAG and SWD work
- Boundary scan
- Debug interface discovery techniques

---

## 🤝 Contributing

Contributions of every kind are welcome.

### Reporting bugs

Please open an issue when you find a bug.

### Adding manufacturers

Found a manufacturer ID that's missing? Please send:

- The chip's IDCODE value
- The manufacturer's official name
- A source (datasheet or official website)

After editing `eepromupdate/jep106.inc`, run `pnpm gen:jep106` in `studio/` to refresh the app's copy of the table.

---

## ⚠️ Notes and Warnings

### Legal and ethical use

- **Authorized testing only**: make sure you have permission to test the target device.
- **Follow local law**: rules on hardware debugging differ between countries and regions.
- **Respect intellectual property**: don't use this tool for piracy or infringement.

### Technical precautions

1. **Power**: keep the target's power stable to avoid damage.
2. **Wiring**: double-check pin connections to avoid shorts. Connect ground first.
3. **Voltage**: set the target I/O voltage to match the target's logic level. Don't connect VADJ to the target.
4. **ESD**: use ESD protection when handling sensitive devices.
5. **Persistent modes**: logic analyzer and OpenOCD mode stay on through resets and power cycles until you exit them (Ctrl-X, or **Exit mode** in Studio).

### FAQ

**Q: Why does writing the database take 20 minutes?**
A: EEPROM writes are slow, and every page is verified to make sure the data is intact.

**Q: Can more manufacturers be added?**
A: Yes. There's room for roughly one or two hundred more.

**Q: What do I need to flash it?**
A: **Propeller Tool 1.3.2** is recommended for flashing. Any serial terminal works for the database step, and JTAGulator Studio runs on Windows, macOS and Linux.

**Q: How do I know the database was written successfully?**
A: When it's done the terminal shows `Result: Success - Writing completion flag`.

**Q: Do I need ID Tracker firmware to use JTAGulator Studio?**
A: No. Studio works with the stock firmware too, and decodes manufacturer names itself.

---

## 📄 License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The original JTAGulator firmware is distributed under the Creative Commons Attribution 3.0 United States license.

### Acknowledgements

- Joe Grand, for creating the JTAGulator
- Chip manufacturers, for publishing their technical documentation
- Community members, for testing and feedback

---

<div align="center">

### 🌟 If this project helped you, please give it a Star!

*Last updated: October 2026*

</div>
