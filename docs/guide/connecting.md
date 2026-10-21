# Connecting and setting up the device


### Hardware interfaces

The JTAGulator has:

- **24 general-purpose I/O channels** on three 2.54 mm pin headers (CH0–7, CH8–15, CH16–23).
- **GND pins** for the common ground.
- **VADJ pins**, the adjustable I/O voltage (1.4 V – 3.3 V). The target voltage you set drives this.
- **A Mini USB port** for power and serial communication.

### Connecting to a computer

The JTAGulator uses an FTDI FT232R USB-to-serial chip and shows up as a serial port: `COMx` on Windows, `/dev/ttyUSB0` on Linux, `/dev/tty.usbserial-*` on macOS. Drivers install automatically on current versions of all three systems.

![ ](/media/image7.png " ")

Serial settings: **115200 baud, 8 data bits, 1 stop bit, no parity, no flow control.**

On Linux your user needs access to serial ports. Add it to the `uucp` group (Arch) or `dialout` group (Debian/Ubuntu), then log in again:

```bash
sudo usermod -aG dialout $USER
```

#### Windows: Xshell

1. Download and install Xshell from https://www.netsarang.com/xshell/ (free for home and school use).

   ![ ](/media/image8.png " ")
2. Create a new session and choose the **Serial** protocol.

   ![ ](/media/image10.png " ")
3. Set the serial parameters:
   - Port: the COM number shown in Device Manager (e.g. `COM3`)
   - Baud rate: `115200`
   - Data bits: `8`
   - Stop bits: `1`
   - Parity: `None`
   - Flow control: `None`

   ![ ](/media/image11.png " ")
4. After connecting, press Enter to see the JTAGulator's ASCII-art banner.

   ![ ](/media/image13.png " ")

#### Linux: picocom

```bash
# Install picocom (Debian/Ubuntu)
sudo apt install picocom

# Connect (usually /dev/ttyUSB0)
picocom -b 115200 /dev/ttyUSB0
```

If the banner doesn't appear, press Enter.

![ ](/media/image14.png " ")

> **Tip:** a convenient setup is to plug the JTAGulator into a Raspberry Pi or another Linux box and work over SSH. You can also run PinHound Studio's browser version there and reach it through an SSH tunnel.

