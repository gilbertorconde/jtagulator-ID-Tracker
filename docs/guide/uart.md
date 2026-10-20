# UART discovery and passthrough


UART is the most common debug interface. The JTAGulator can find the TX and RX pins and the baud rate automatically.

> Pin names are from the **target's** point of view: TXD is where the target transmits.

Type `U` to enter UART mode, then `H` for its commands.

### Commands

1. **`U` – full UART scan**

   ![ ](/media/image34.png " ")
   - Tries every pair of channels in the range (one as TXD, one as RXD) at each of 21 standard baud rates.

   ![ ](/media/image35.png " ")
   - You set a "bait" string to send, a carriage return (`\r`) by default. The JTAGulator sends it and shows any reply.
   - You can ignore replies with non-printable characters, to filter out binary noise.

2. **`T` – TXD-only scan**
   - Listens on all channels. Any signal that looks like UART (start bit, data bits, stop bit) is reported with its measured baud rate.
   - Nothing is transmitted, so this is a safe first try, and ideal for transmit-only log ports. Power-cycle the target during the scan to catch its boot log.

   ![ ](/media/image36.png " ")

3. **`P` – passthrough**
   - Opens a two-way connection to the UART you found.
   - Enter the TXD and RXD channels and the baud rate.

   ![ ](/media/image37.png " ")
   - **Local echo:** turn it off (`N`) for interactive shells (e.g. a Linux console), which echo by themselves. Turn it on (`Y`) for devices that don't echo.
   - **Leave** with `Ctrl+X`.
   - In JTAGulator Studio, the UART page has a full terminal for this. Its scripts can wait for target output with `uart.expect()`, e.g. to stop U-Boot's autoboot.

