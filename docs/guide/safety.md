# Safety before connecting a target


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

   ![ ](/media/image15.png " ")
   - **Original author's observation:** in their tests, with VADJ at 3.3 V, the I/O pins tolerated and correctly read **5 V TTL input signals**. This is outside the official specification, so rely on it only with care.

