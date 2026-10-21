# JTAG discovery and debugging


JTAG (IEEE 1149.1) was created for boundary scan testing and is now widely used for chip debugging, programming and reverse engineering. At its core is a state machine:

- **TMS** controls the state machine, clocked by **TCK**.
- Data goes in on **TDI** and comes out on **TDO**.
- The optional **TRST#** signal resets the state machine asynchronously.

![ ](/media/image26.jpeg " ")

Type `J` to enter JTAG mode, then `H` for its commands.

![ ](/media/image27.png " ")

### Discovery commands

1. **`J` – combined scan**

   ![ ](/media/image28.png " ")
   ![ ](/media/image30.png " ")
   - The best general method. It finds TDO, TCK and TMS with an IDCODE scan, then TDI with a BYPASS test, and looks for TRST#.
   - Steps:
     1. Set the start and end channel. Wire the target's candidate pins to consecutive channels to keep the number of combinations small.
     2. Choose whether to pull the channels low before each attempt. Enable it when the target may have a reset line (such as TRST#) that needs toggling.
   - Underneath, it sends JTAG sequences on each pin combination and checks for the expected response on TDO.

2. **`I` – IDCODE scan**

   ![ ](/media/image32.png " ")
   - Looks for JTAG interfaces that return an `IDCODE`, the device identification register most chips select after reset. It's fast, but it can't find TDI.
   - **Success:** for the correct pin combination it prints one or more 32-bit `IDCODE` values.
   - **With PinHound firmware**, the manufacturer name appears next to each `IDCODE`. PinHound Studio shows the name on any firmware.

3. **`B` – BYPASS scan**

   ![ ](/media/image33.png " ")
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
   - PinHound Studio can do all of this from the JTAG page, and also saves the settings as a `.cfg` file and runs GDB: see [OpenOCD and GDB](/studio/openocd).

