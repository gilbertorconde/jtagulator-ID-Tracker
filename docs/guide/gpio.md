# GPIO mode


Type `G` to enter GPIO mode, then `H` for its commands.

![ ](/media/image20.png " ")

### Commands

1. **`R` – read once**
   - Reads the level of all 24 channels and shows it in binary and hexadecimal.

   ![ ](/media/image21.png " ")
   - **Note:** the I/O pins read high (1) when nothing is connected.

2. **`C` – monitor continuously**
   - Keeps reading all channels and prints a new line whenever any level changes.

   ![ ](/media/image22.png " ")
   - Press any key to stop.

3. **`W` – write outputs**
   - Drives all 24 channels as outputs.
   - Enter a 6-digit hexadecimal value (e.g. `FFFFFF`), one bit per channel. Bit 0 (lowest) is CH0; bit 23 (highest) is CH23.

   ![ ](/media/image24.png " ")
   - **Example:** to drive CH2 low and every other channel high, the binary value is `11111111 11111111 11111011`, which is `FFFFFB` in hexadecimal.
   - The outputs stay driven until you press a key. Only drive pins that are inputs on the target.

4. **`L` – logic analyzer mode**
   - Turns the JTAGulator into a 24-channel logic analyzer that speaks the OLS/SUMP protocol.
   - **Leave it** with `Ctrl+X`. The mode survives resets until you leave it.
   - **Capture software:**
     - **JTAGulator Studio**: Logic analyzer page, with triggers, pre-trigger capture (ID Tracker 1.3), UART, SPI, I2C, 1-Wire, CAN, JTAG and SWD decoders, and VCD, CSV and sigrok `.sr` export (open the `.sr` in PulseView to use any sigrok decoder). See [Logic analyzer](/studio/logic-analyzer).
     - **PulseView** works too. On Linux:
       1. Start PulseView: `pulseview -D`
       2. Choose the driver `Openbench Logic Sniffer & SUMP compatible (ols)`
       3. Choose the JTAGulator's serial port (e.g. `/dev/ttyUSB0`) at `115200` baud.
       4. Click `Scan for devices using the driver above`. It should find `JTAGulator with 24 channels`.

       ![ ](/media/image25.png " ")
   - **Limits** (set by the firmware):
     - up to 1024 samples per capture;
     - up to 1.2 MHz, or 909 kHz when keeping pre-trigger samples;
     - level triggers only.

     This makes it best for short bursts or slow signals, e.g. to see which pins are active.

