# Commands overview


In a serial terminal, type `h` or `H` for help in the current menu. Commands are one letter followed by Enter.

### Main menu

- **`J`**: enter the **JTAG** menu (interface discovery and interaction).
- **`U`**: enter the **UART** menu (serial port discovery and passthrough).
- **`G`**: enter the **GPIO** menu (inputs, outputs and the logic analyzer).
- **`S`**: enter the **SWD** menu (Serial Wire Debug discovery).
- **`A`**: run all scans (GPIO, JTAG, SWD and UART) one after another.
- **`V`**: set the target I/O voltage (1.4 V – 3.3 V). **Do this before any scan**; scans refuse to run without it.
- **`I`**: show the firmware version.
- **`H`**: show the available commands.

### In every submenu

- **`V`**: set the target I/O voltage.
- **`H`**: show the commands of this menu.
- **`M`**: return to the main menu.

### Special keys

- **Any key** stops a running scan.
- **`Ctrl+X`** leaves UART passthrough, logic analyzer mode and OpenOCD mode. Logic analyzer and OpenOCD mode survive resets and power cycles, so if the device seems unresponsive, press `Ctrl+X` first.

