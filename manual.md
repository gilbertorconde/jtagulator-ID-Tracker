# JTAGulator User Manual

## 0x00 Introduction

The JTAGulator is an open-source, all-in-one hardware debugging tool designed by security researcher Joe Grand. It combines three core functions:

- **automatic interface identification**
- a **logic analyzer**
- **chip programming and debugging** (through OpenOCD)

It is especially useful for hardware reverse engineering, embedded security testing and firmware extraction.

The hardware design, firmware source and documentation are fully open:

- Official page: http://www.grandideastudio.com/jtagulator/
- Original firmware: https://github.com/grandideastudio/jtagulator
- ID Tracker (this project, enhanced firmware and the JTAGulator Studio app): see the [README](README.md)
- Video tutorials (Chinese): https://space.bilibili.com/39602674

There are two ways to use the JTAGulator:

1. **JTAGulator Studio**, the graphical app in `studio/`. It drives the device for you and is described in [0x0B](#0x0b-jtagulator-studio).
2. **A serial terminal**, typing the firmware's single-letter commands. Most of this manual describes these commands, because Studio runs exactly the same commands underneath.

---

## 0x01 Firmware

### Option A: JTAGulator Studio (recommended)

1. Connect the JTAGulator over USB and open Studio.
2. Click **Connect**, then open the **Firmware** page.
3. Under **Install firmware**, choose a source:
   - the bundled ID Tracker build;
   - a GitHub release (**Check for updates**);
   - a `.binary` or `.eeprom` file.
4. Click **Test run (RAM)** to try it until the next reset, or **Install to EEPROM** to make it permanent.

Studio has its own Propeller loader, so you don't need Propeller Tool. You also can't brick the JTAGulator this way: the Propeller boots from ROM and can always be reloaded over USB.

### Option B: Propeller Tool

#### 1. Prepare the tools

1. Download and install the Propeller development tool:
   - http://www.grandideastudio.com/wp-content/uploads/P8X32A-Setup-Propeller-Tool-v1.3.2.zip

   ![Propeller Tool main window](./media/image1.png "Propeller Tool main window")
2. Download the firmware source:
   - the original firmware: https://github.com/grandideastudio/jtagulator
   - or ID Tracker: this repository

   ![Official GitHub page](./media/image2.png "Official GitHub page")
   - On the right side of the GitHub page, click **Releases** and download the archive of the latest (or the version you need), then unpack it.

   ![Official GitHub releases page](./media/image3.png "Official GitHub releases")

#### 2. Compile and flash

1. In Propeller Tool, open `JTAGulator.spin` from the unpacked folder (`File` → `Open`).
2. In the file list on the left, right-click `JTAGulator.spin` and choose `Set Top Object File`. The name turns bold.

   ![File list](./media/image4.png "File list")
3. Connect the JTAGulator to the computer with the USB cable.
4. Press **F7** to detect the device. Once it's found, press **Ctrl + F11** to compile and write the firmware to EEPROM.

   ![ ](./media/image5.png " ")
   ![ ](./media/image6.png " ")

#### OpenSpin (Linux and macOS)

[OpenSpin](https://github.com/parallaxinc/OpenSpin) compiles the firmware from the command line:

```bash
openspin -b JTAGulator.spin   # produces JTAGulator.binary
```

Load the resulting `.binary` with JTAGulator Studio (Firmware → From file) or any Propeller loader.

### ID Tracker firmware

The original firmware hadn't been updated for about two and a half years (as of November 2025). ID Tracker adds:

- **Manufacturer names.** After a successful JTAG or SWD scan, each ID is shown with the company that made the chip. The names come from a database of 1,953 manufacturers.
- **Logic analyzer fixes (1.3).**
  - Triggers work on all 24 channels instead of only CH0–7.
  - Captures can keep samples from before the trigger.
- **JTAG name lookup fix (1.3).** Earlier versions showed the wrong name for every manufacturer outside JEP106 bank 0.

#### Writing the manufacturer database (once)

The names are stored in the upper half of the JTAGulator's EEPROM, so the database has to be written once.

**With JTAGulator Studio:**

1. Open **Firmware** and click **Check** to see whether the database is already there. The check runs a small program from RAM and writes nothing.
2. Click **Write database**. The writer runs from RAM, so the installed firmware isn't touched. It takes about 20 minutes and shows progress.

**With Propeller Tool:**

1. In the `eepromupdate` folder, set `EEPROM_Update.spin` as the Top Object File.
2. Press **F10** to load it into RAM, or **F11** to write it to EEPROM.
3. Open a serial terminal on the JTAGulator. The writer runs three steps: **clear the database area → write the database → verify**. This takes about 20 minutes. It ends with `Result: Success - Writing completion flag`.
4. If you used F11, flash `JTAGulator.spin` again afterwards. F11 replaced the main firmware with the writer.

> **Note:** writing the database is a one-time job. Afterwards you can flash any firmware version; the database stays, and the names come back whenever ID Tracker is installed.

---

## 0x02 Connecting and setting up the device

### Hardware interfaces

The JTAGulator has:

- **24 general-purpose I/O channels** on three 2.54 mm pin headers (CH0–7, CH8–15, CH16–23).
- **GND pins** for the common ground.
- **VADJ pins**, the adjustable I/O voltage (1.4 V – 3.3 V). The target voltage you set drives this.
- **A Mini USB port** for power and serial communication.

### Connecting to a computer

The JTAGulator uses an FTDI FT232R USB-to-serial chip and shows up as a serial port: `COMx` on Windows, `/dev/ttyUSB0` on Linux, `/dev/tty.usbserial-*` on macOS. Drivers install automatically on current versions of all three systems.

![ ](./media/image7.png " ")

Serial settings: **115200 baud, 8 data bits, 1 stop bit, no parity, no flow control.**

On Linux your user needs access to serial ports. Add it to the `uucp` group (Arch) or `dialout` group (Debian/Ubuntu), then log in again:

```bash
sudo usermod -aG dialout $USER
```

#### Windows: Xshell

1. Download and install Xshell from https://www.netsarang.com/xshell/ (free for home and school use).

   ![ ](./media/image8.png " ")
2. Create a new session and choose the **Serial** protocol.

   ![ ](./media/image10.png " ")
3. Set the serial parameters:
   - Port: the COM number shown in Device Manager (e.g. `COM3`)
   - Baud rate: `115200`
   - Data bits: `8`
   - Stop bits: `1`
   - Parity: `None`
   - Flow control: `None`

   ![ ](./media/image11.png " ")
4. After connecting, press Enter to see the JTAGulator's ASCII-art banner.

   ![ ](./media/image13.png " ")

#### Linux: picocom

```bash
# Install picocom (Debian/Ubuntu)
sudo apt install picocom

# Connect (usually /dev/ttyUSB0)
picocom -b 115200 /dev/ttyUSB0
```

If the banner doesn't appear, press Enter.

![ ](./media/image14.png " ")

> **Tip:** a convenient setup is to plug the JTAGulator into a Raspberry Pi or another Linux box and work over SSH. You can also run JTAGulator Studio's browser version there and reach it through an SSH tunnel.

---

## 0x03 Safety before connecting a target

Check the target before you debug an unknown device, or you may damage it.

1. **Find ground (GND).**
   - With a multimeter in continuity mode, find test points connected to a known ground: the negative side of the power jack, a USB shield, or the negative side of a capacitor.
   - Connect the JTAGulator's GND to the target's GND before anything else.

2. **Find the logic level.**
   - **Best:** measure the voltage swing of suspected signal pins (TX, TCK, …) with an oscilloscope.
   - **Beware:** a multimeter shows the average voltage. A digital signal with 50 % duty cycle reads about half its real level (around 1.65 V for 3.3 V logic), which is easy to misread.
   - The JTAGulator's I/O pins are protected by series resistors and TVS diodes and survive some overvoltage. To be safe, match the levels (level shifting or a resistor divider) when you aren't sure.

3. **About VADJ.**
   - VADJ sets the high level of the JTAGulator's outputs and, with it, the input thresholds. Set it to the target's logic level (e.g. 3.3 V or 1.8 V) with the `V` command or Studio's voltage control.
   - The firmware warns: *"Ensure VADJ is NOT connected to target!"* VADJ is a reference output, not a supply for the target. The original author notes that, according to the schematic, it can source up to about 150 mA. Even so, don't use it to power the board.

   ![ ](./media/image15.png " ")
   - **Original author's observation:** in their tests, with VADJ at 3.3 V, the I/O pins tolerated and correctly read **5 V TTL input signals**. This is outside the official specification, so rely on it only with care.

---

## 0x04 Commands overview

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

---

## 0x05 GPIO mode

Type `G` to enter GPIO mode, then `H` for its commands.

![ ](./media/image20.png " ")

### Commands

1. **`R` – read once**
   - Reads the level of all 24 channels and shows it in binary and hexadecimal.

   ![ ](./media/image21.png " ")
   - **Note:** the I/O pins read high (1) when nothing is connected.

2. **`C` – monitor continuously**
   - Keeps reading all channels and prints a new line whenever any level changes.

   ![ ](./media/image22.png " ")
   - Press any key to stop.

3. **`W` – write outputs**
   - Drives all 24 channels as outputs.
   - Enter a 6-digit hexadecimal value (e.g. `FFFFFF`), one bit per channel. Bit 0 (lowest) is CH0; bit 23 (highest) is CH23.

   ![ ](./media/image24.png " ")
   - **Example:** to drive CH2 low and every other channel high, the binary value is `11111111 11111111 11111011`, which is `FFFFFB` in hexadecimal.
   - The outputs stay driven until you press a key. Only drive pins that are inputs on the target.

4. **`L` – logic analyzer mode**
   - Turns the JTAGulator into a 24-channel logic analyzer that speaks the OLS/SUMP protocol.
   - **Leave it** with `Ctrl+X`. The mode survives resets until you leave it.
   - **Capture software:**
     - **JTAGulator Studio**: Logic analyzer page, with triggers, pre-trigger capture (ID Tracker 1.3), UART/SPI/I2C decoders and VCD/CSV export.
     - **PulseView** works too. On Linux:
       1. Start PulseView: `pulseview -D`
       2. Choose the driver `Openbench Logic Sniffer & SUMP compatible (ols)`
       3. Choose the JTAGulator's serial port (e.g. `/dev/ttyUSB0`) at `115200` baud.
       4. Click `Scan for devices using the driver above`. It should find `JTAGulator with 24 channels`.

       ![ ](./media/image25.png " ")
   - **Limits** (set by the firmware):
     - up to 1024 samples per capture;
     - up to 1.2 MHz, or 909 kHz when keeping pre-trigger samples;
     - level triggers only.

     This makes it best for short bursts or slow signals, e.g. to see which pins are active.

---

## 0x06 JTAG discovery and debugging

JTAG (IEEE 1149.1) was created for boundary scan testing and is now widely used for chip debugging, programming and reverse engineering. At its core is a state machine:

- **TMS** controls the state machine, clocked by **TCK**.
- Data goes in on **TDI** and comes out on **TDO**.
- The optional **TRST#** signal resets the state machine asynchronously.

![ ](./media/image26.jpeg " ")

Type `J` to enter JTAG mode, then `H` for its commands.

![ ](./media/image27.png " ")

### Discovery commands

1. **`J` – combined scan**

   ![ ](./media/image28.png " ")
   ![ ](./media/image30.png " ")
   - The best general method. It finds TDO, TCK and TMS with an IDCODE scan, then TDI with a BYPASS test, and looks for TRST#.
   - Steps:
     1. Set the start and end channel. Wire the target's candidate pins to consecutive channels to keep the number of combinations small.
     2. Choose whether to pull the channels low before each attempt. Enable it when the target may have a reset line (such as TRST#) that needs toggling.
   - Underneath, it sends JTAG sequences on each pin combination and checks for the expected response on TDO.

2. **`I` – IDCODE scan**

   ![ ](./media/image32.png " ")
   - Looks for JTAG interfaces that return an `IDCODE`, the device identification register most chips select after reset. It's fast, but it can't find TDI.
   - **Success:** for the correct pin combination it prints one or more 32-bit `IDCODE` values.
   - **With ID Tracker**, the manufacturer name appears next to each `IDCODE`. JTAGulator Studio shows the name on any firmware.

3. **`B` – BYPASS scan**

   ![ ](./media/image33.png " ")
   - Puts every chip in the chain into `BYPASS`, where each acts as a 1-bit shift register, and finds all four pins. It reports the number of devices in the chain.
   - Slower than the IDCODE scan. Entering pins you already know shortens it a lot.

4. **`R` – RTCK scan**
   - Finds the **adaptive clocking (RTCK)** pin. Some ARM cores return the clock on RTCK so the debugger can match the TCK speed.
   - Rarely needed.

### Commands for a known pinout

1. **`D` – read IDCODEs**
   - Reads the `IDCODE` of every chip in the chain. TDI isn't needed.

2. **`T` – BYPASS test**
   - Shifts a random pattern from TDI to TDO through BYPASS and checks it comes back. This confirms the pinout and counts the chips in the chain.

3. **`Y` – instruction/data register discovery**
   - Finds the instruction register (IR) length and the data register (DR) length behind every instruction. Needs a single chip in the chain. Essential for working with undocumented instructions.

4. **`P` – pin mapper (EXTEST)**
   - Uses the JTAG `EXTEST` instruction to walk a bit through the boundary scan register. It reports which register bit drives which JTAGulator channel, which helps map a chip's pins on a board.

5. **`O` – OpenOCD mode**
   - Makes the JTAGulator act as a **Bus Pirate**-compatible adapter for OpenOCD and prints an example command.
   - **Example (Linux):**

     ```bash
     # With the pinout found by the scan:
     openocd -f interface/buspirate.cfg -c "transport select jtag; buspirate port /dev/ttyUSB0" -f target/stm32f1x.cfg
     ```

   - With OpenOCD you can debug, read and write memory, and extract firmware.
   - The mode survives resets until you leave it with `Ctrl+X`.
   - JTAGulator Studio can do all of this from the JTAG page: enter the mode, start OpenOCD with a chosen target, show its output, and return to the menu.

---

## 0x07 UART discovery and passthrough

UART is the most common debug interface. The JTAGulator can find the TX and RX pins and the baud rate automatically.

> Pin names are from the **target's** point of view: TXD is where the target transmits.

Type `U` to enter UART mode, then `H` for its commands.

### Commands

1. **`U` – full UART scan**

   ![ ](./media/image34.png " ")
   - Tries every pair of channels in the range (one as TXD, one as RXD) at each of 21 standard baud rates.

   ![ ](./media/image35.png " ")
   - You set a "bait" string to send, a carriage return (`\r`) by default. The JTAGulator sends it and shows any reply.
   - You can ignore replies with non-printable characters, to filter out binary noise.

2. **`T` – TXD-only scan**
   - Listens on all channels. Any signal that looks like UART (start bit, data bits, stop bit) is reported with its measured baud rate.
   - Nothing is transmitted, so this is a safe first try, and ideal for transmit-only log ports. Power-cycle the target during the scan to catch its boot log.

   ![ ](./media/image36.png " ")

3. **`P` – passthrough**
   - Opens a two-way connection to the UART you found.
   - Enter the TXD and RXD channels and the baud rate.

   ![ ](./media/image37.png " ")
   - **Local echo:** turn it off (`N`) for interactive shells (e.g. a Linux console), which echo by themselves. Turn it on (`Y`) for devices that don't echo.
   - **Leave** with `Ctrl+X`.
   - In JTAGulator Studio, the UART page has a full terminal for this. Its scripts can wait for target output with `uart.expect()`, e.g. to stop U-Boot's autoboot.

---

## 0x08 SWD discovery

SWD (Serial Wire Debug) is ARM Cortex's two-wire debug protocol. It needs fewer pins than JTAG.

Type `S` to enter SWD mode, then `H` for its commands.

![ ](./media/image38.png " ")

### Commands and hardware tuning

1. **`I` – SWD scan**
   - Finds the SWDIO and SWCLK pins by reading the debug port ID on every pair.
   - SWD is sensitive to timing and signal integrity. The firmware itself warns that the JTAGulator's front-end circuitry is incompatible with many SWD targets. The original author found the series resistors on the I/O channels (~470 Ω) to be the cause.
   - **Hardware tuning:** replacing the series resistors (R1–R24) with smaller values (around 22–100 Ω) greatly improves SWD detection, with little effect on JTAG. See also the official [hardware modifications](https://github.com/grandideastudio/jtagulator/wiki/Hardware-Modifications) page.

2. **`D` – read the SWD ID**
   - Reads the debug port ID register (DPIDR) of the target.
   - **With ID Tracker**, the designer's name is shown as well.
   - **Note:** many chip makers license ARM's Cortex cores. The designer field of the DPIDR then says "ARM" rather than the chip maker (for example on some STM32 parts).

---

## 0x09 Troubleshooting

1. **The device doesn't respond**
   - **Try first:** press `Ctrl+X` in the terminal. The device may be in logic analyzer or OpenOCD mode, which survives resets; `Ctrl+X` returns to the menu. JTAGulator Studio detects these modes when it connects and offers **Exit mode**.
   - Check the USB cable: it must carry data, not just power. Try another cable or port.
   - Check that the terminal is set to `115200` baud.
   - On Linux, check you have permission to open the port (see [0x02](#0x02-connecting-and-setting-up-the-device)).

2. **Scans find nothing**
   - **Set the voltage first** with `V` and confirm the target's level with an oscilloscope.
   - **Check the wiring:** a solid ground and good contact on every signal.
   - **Try other scans:** for JTAG, try `J`, `I` and `B` in turn.
   - **Narrow the range:** wire the candidate pins to consecutive channels.
   - **Pull channels low** before each permutation if the target may hold a reset line.
   - **For SWD,** consider smaller series resistors.

3. **The logic analyzer or PulseView won't connect**
   - Make sure the device is in logic analyzer mode (`G`, then `L`) and nothing else has the serial port open.
   - On Linux, start PulseView with `pulseview -D` and pick the right driver and port.
   - On Windows, PulseView needs the right driver for the FTDI device, which can be fiddly. JTAGulator Studio's logic analyzer works on every platform without extra drivers.

---

## 0x0A Closing notes

The JTAGulator is a powerful open-source security tool, and its design is worth studying in its own right: the input protection, ESD circuitry and clean layout show Joe Grand's experience in hardware security design. Its core functions are mature, but the community keeps extending it, through enhanced firmware like ID Tracker, apps like JTAGulator Studio, and simple hardware changes such as smaller series resistors.

---

## 0x0B JTAGulator Studio

JTAGulator Studio (`studio/` in this repository) is a desktop app (Windows, macOS, Linux) that also runs in Chrome or Edge. Everything in this manual is available there with forms instead of typed commands:

| Page | What it does |
| :--- | :--- |
| Overview | Connect, device info, quick links, recent activity |
| Scan all | Runs any set of scans one after another |
| JTAG | All JTAG scans and known-pinout tools, plus the OpenOCD launcher |
| SWD | SWD scan and DPIDR decode |
| UART | Active and passive scans and a terminal to the target |
| GPIO | Read, monitor and drive the 24 channels |
| Logic analyzer | Captures, triggers, pre-trigger, decoders, export |
| Scripts | Automate any of the above in JavaScript, or record a macro |
| Target & findings | Known pins, channel labels and results per board; Markdown reports |
| Firmware | Installed version, test-run or install firmware, updates, manufacturer database |

It also has a built-in simulator, a software JTAGulator with a fake target, so you can learn the tool without hardware. See the [README](README.md) for installation.

---
*Manual written by Chaoschaos1024; translated to English and updated for ID Tracker 1.3 and JTAGulator Studio.*
*Last updated: October 2026*
