# Command-line tool

`pinhound` runs the same scans, device-ID reads and scripts as Studio from a terminal, on the same code. Use it for automation, CI and quick checks; `--json` gives machine-readable output, and `--sim` uses the built-in simulator instead of hardware.

## Installing

It needs [Node.js](https://nodejs.org) 20 or later and [pnpm](https://pnpm.io):

```sh
cd studio
pnpm install
pnpm build:cli                         # -> dist-cli/pinhound.mjs
node dist-cli/pinhound.mjs --help
```

## Commands

| Command | What it does |
| :--- | :--- |
| `ports` | List serial ports (JTAGulators first, marked `*`) |
| `info` | Firmware version and target voltage |
| `voltage [volts\|off]` | Read or set the target I/O voltage |
| `scan jtag\|idcode\|bypass\|rtck\|swd\|uart\|txd` | Discovery scan over `--start`..`--end` (default CH0–7) |
| `ids jtag --tdo N --tck N --tms N` | Read every IDCODE with a known pinout |
| `ids swd --swdio N --swclk N` | Read the DPIDR |
| `bypass --tdi N --tdo N --tck N --tms N` | Check TDI/TDO with a BYPASS shift |
| `gpio read` / `gpio monitor --duration MS` / `gpio write VALUE --hold MS` | Read, watch or drive the channels |
| `run SCRIPT.js` | Run a script with the [scripting API](/studio/scripting) |
| `firmware install [FILE] --yes` | Program firmware into EEPROM (bundled PinHound firmware by default) |
| `firmware test [FILE]` | Load firmware into RAM only, until the next reset |
| `firmware probe` | Check the manufacturer database (reads only) |
| `firmware db --yes` | Write the manufacturer database (about 20 minutes) |
| `exit-mode` | Leave logic analyzer or OpenOCD mode |

| Option | Meaning |
| :--- | :--- |
| `-p, --port PATH` | Serial port (default: the first FTDI FT232R port) |
| `-v, --voltage V` | Set the target voltage before the command |
| `--start N`, `--end N` | Scan range |
| `--pins-low` | Pulse channels LOW before each permutation |
| `--known tck=2,tms=4` | Known pins for `bypass` and `uart` scans |
| `--duration MS`, `--text TEXT` | TXD scan / monitor duration; text the UART scan sends |
| `--json` | One JSON document on stdout (errors as `{"error": ...}`) |
| `--sim` | Use the simulator |
| `-y, --yes` | Confirm commands that write the EEPROM |

Opening the port restarts the JTAGulator, which clears the target voltage, so pass `-v` with every command that drives the target. `Ctrl-C` stops a running scan; a second `Ctrl-C` quits. Exit codes: 0 success, 1 failure or nothing found, 2 usage error.

## Examples

```sh
pinhound -v 3.3 scan jtag --start 0 --end 7
pinhound -v 3.3 --json ids jtag --tdo 5 --tck 2 --tms 4 | jq '.devices[].idcode.hex'
pinhound -v 1.8 scan swd --end 11
pinhound -v 3.3 run find-everything.js
pinhound firmware probe
```
