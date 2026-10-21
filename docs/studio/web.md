# Web version

PinHound Studio also runs in a browser, with nothing to install: **[open the web app](https://gilbertorconde.github.io/pinhound/app/){target="_self"}**.

It is the same app as the desktop version, connecting to the JTAGulator through the browser's Web Serial API. It always runs the latest version.

## Browsers

| Browser | Works with a JTAGulator |
| :--- | :--- |
| Chrome, Edge, Opera (desktop) | Yes |
| Firefox, Safari | No: no Web Serial. The simulator works. |
| Phones and tablets | No. The simulator works. |

In a browser without Web Serial, the app says so at the top of the page.

## What needs the desktop app

Everything else works in the browser: every scan, the UART terminal, the logic analyzer with all decoders and exports, scripts, targets, BSDL files, installing firmware and writing the manufacturer database.

| Feature | Why |
| :--- | :--- |
| Launching OpenOCD and GDB | A web page can't start programs on your computer. The OpenOCD panel can still enter OpenOCD mode and save a `.cfg` file. |
| In-app updates | Not needed: the page is always the latest version. |

Firmware releases are offered from a copy kept on this site, because a browser page can't download GitHub release files directly. Firmware from another repository has to be downloaded and installed with **From file**.

Scripts, targets and settings are stored in the browser, separately from the desktop app's.

[Download the desktop app](https://github.com/gilbertorconde/pinhound/releases/latest) for Windows, macOS or Linux.
