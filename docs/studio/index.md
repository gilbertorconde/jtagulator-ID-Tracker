# JTAGulator Studio

JTAGulator Studio is a desktop app for Windows, macOS and Linux that drives the JTAGulator for you. It answers every prompt of the firmware's serial menu from form inputs and shows the results as structured cards instead of terminal text. It works with the stock firmware and with ID Tracker, and also runs in Chrome or Edge.

![A JTAG scan in Studio](/image/studio-jtag.png)

## Pages

| Page | What it does |
| :--- | :--- |
| Overview | Connect, device info, quick links, recent activity |
| Scan all | Runs any set of scans one after another |
| JTAG | Combined, IDCODE, BYPASS and RTCK scans, device IDs, BYPASS test, IR/DR discovery, EXTEST pin mapper, BSDL files, and [OpenOCD with a GDB console](/studio/openocd) |
| SWD | Pinout scan, DPIDR read and decode |
| UART | Active scan, passive TXD scan with baud measurement, and a terminal to the target console |
| GPIO | Read, live monitor with change log, drive outputs |
| Logic analyzer | [24-channel captures](/studio/logic-analyzer) with triggers, decoders and export |
| Scripts | [JavaScript automation](/studio/scripting) with the same functions as the UI, plus a macro recorder |
| Target & findings | [Known pins, labels and results per board](/studio/targets); share them as `.jtarget` files |
| Firmware | Installed version, test-run or install firmware, updates, [manufacturer database](/guide/database) |
| Settings | Theme, safety prompts, simulator speed, and in-app updates |

A built-in **simulator** (a software JTAGulator with a fake target board) lets you try everything without hardware. A [command-line tool](/studio/cli) runs the same scans and scripts from a terminal.

## Installing

Download the installer for your system from the [releases page](https://github.com/gilbertorconde/jtagulator-ID-Tracker/releases). The desktop app checks for new versions at startup (at most once a day) and installs them from **Settings → Updates**; every update is verified against the project's signing key before it is installed.

- **Linux permissions.** Serial ports usually belong to a group (`uucp` on Arch, `dialout` on Debian/Ubuntu). Add yourself with `sudo usermod -aG uucp $USER`, then log in again.
- **Browser.** Run `pnpm dev` in `studio/` and open `http://localhost:1420` in Chrome or Edge to reach a real JTAGulator over Web Serial. Other browsers can only run the simulator.

## Connecting

1. Plug in the JTAGulator. Its port is an FTDI FT232R (`/dev/ttyUSB*` or `COM*`), marked ★ in the port list.
2. Click **Connect**. Opening the port restarts the JTAGulator, so the app waits for it to boot.
3. Set the target I/O voltage in the top bar to the target's logic level before running scans.

If the JTAGulator is in logic analyzer or OpenOCD mode (both survive resets), the app says so and offers **Exit mode**.

![The firmware page](/image/studio-firmware.png)
