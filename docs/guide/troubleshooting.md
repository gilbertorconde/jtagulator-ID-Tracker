# Troubleshooting


1. **The device doesn't respond**
   - **Try first:** press `Ctrl+X` in the terminal. The device may be in logic analyzer or OpenOCD mode, which survives resets; `Ctrl+X` returns to the menu. JTAGulator Studio detects these modes when it connects and offers **Exit mode**.
   - Check the USB cable: it must carry data, not just power. Try another cable or port.
   - Check that the terminal is set to `115200` baud.
   - On Linux, check you have permission to open the port (see [Connecting the device](/guide/connecting)).

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

