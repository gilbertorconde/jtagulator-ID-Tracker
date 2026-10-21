# SWD discovery


SWD (Serial Wire Debug) is ARM Cortex's two-wire debug protocol. It needs fewer pins than JTAG.

Type `S` to enter SWD mode, then `H` for its commands.

![ ](/media/image38.png " ")

### Commands and hardware tuning

1. **`I` – SWD scan**
   - Finds the SWDIO and SWCLK pins by reading the debug port ID on every pair.
   - SWD is sensitive to timing and signal integrity. The firmware itself warns that the JTAGulator's front-end circuitry is incompatible with many SWD targets. The original author found the series resistors on the I/O channels (~470 Ω) to be the cause.
   - **Hardware tuning:** replacing the series resistors (R1–R24) with smaller values (around 22–100 Ω) greatly improves SWD detection, with little effect on JTAG. See also the official [hardware modifications](https://github.com/grandideastudio/jtagulator/wiki/Hardware-Modifications) page.

2. **`D` – read the SWD ID**
   - Reads the debug port ID register (DPIDR) of the target.
   - **With PinHound firmware**, the designer's name is shown as well.
   - **Note:** many chip makers license ARM's Cortex cores. The designer field of the DPIDR then says "ARM" rather than the chip maker (for example on some STM32 parts).

