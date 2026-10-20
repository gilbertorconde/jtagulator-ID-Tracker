# Logic analyzer

The JTAGulator's OLS/SUMP logic analyzer mode samples all 24 channels. Studio's **Logic analyzer** page captures, shows and decodes it. Entering the mode is stored in EEPROM and survives resets until you exit it (the page and the top bar offer **Exit mode**).

![A capture in Studio](/image/studio-logic.png)

## Capturing

| Setting | Notes |
| :--- | :--- |
| Sample rate | Up to 1.2 MHz. The page shows the exact rate the firmware will use. |
| Samples | Up to 1,364 on ID Tracker 1.4 (1,024 on earlier firmware). |
| Channel groups | CH0–7, CH8–15, CH16–23. Fewer groups transfer faster. |
| Compress repeated samples (RLE) | Stores a value and a repeat count instead of identical samples, so slow or bursty signals cover far more time. Up to 500 kHz. ID Tracker 1.4. |
| Trigger | Level trigger on any of the 24 channels, with up to four chained stages. |
| Keep before trigger | Keeps 10–75 % of the capture from before the trigger (ID Tracker 1.3 and later, up to about 909 kHz). |

## Decoders

Add decoders below the waveform; each annotates its channels and lists the decoded items. Click an item to jump to it.

| Decoder | Channels | Shows |
| :--- | :--- | :--- |
| UART (8N1) | RX, baud, optional inversion | Bytes and framing errors |
| SPI | SCK, MOSI, MISO, CS#, mode 0–3 | Words on MOSI and MISO |
| I2C | SCL, SDA | Start/stop, addresses with R/W, data, NACKs |
| 1-Wire | DQ | Reset, presence, bytes and ROM command names |
| CAN | RX, bit rate | Frames with ID, data and CRC check (handles bit stuffing) |
| JTAG | TCK, TMS, optional TDI and TDO | TAP state changes and IR/DR shifts |
| SWD | SWCLK, SWDIO | Line resets, DP/AP reads and writes, ACK, parity |

Sample at least 4× the bit rate (10× for UART).

## Export

| Format | Use it for |
| :--- | :--- |
| VCD | Any waveform viewer (GTKWave and others) |
| CSV | Spreadsheets and scripts |
| sigrok (`.sr`) | [PulseView](https://sigrok.org/wiki/PulseView) and sigrok-cli, with their library of 100+ protocol decoders |

## Other tools

The mode speaks the standard SUMP protocol, so [PulseView](https://sigrok.org/wiki/PulseView) (driver "Openbench Logic Sniffer") and other OLS clients can capture directly while the JTAGulator is in logic analyzer mode.
