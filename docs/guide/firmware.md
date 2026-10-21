# Firmware

PinHound firmware continues the version numbers of ID Tracker, the fork it grew from: releases up to 1.3 were published under that name, and the manufacturer database comes from it (by Weiao, [Chaoschaos1024](https://github.com/Chaoschaos1024/jtagulator-ID-Tracker)).

### Option A: PinHound Studio (recommended)

1. Connect the JTAGulator over USB and open Studio.
2. Click **Connect**, then open the **Firmware** page.
3. Under **Install firmware**, choose a source:
   - the bundled PinHound firmware;
   - a GitHub release (**Check for updates**);
   - a `.binary` or `.eeprom` file.
4. Click **Test run (RAM)** to try it until the next reset, or **Install to EEPROM** to make it permanent.

Studio has its own Propeller loader, so you don't need Propeller Tool. You also can't brick the JTAGulator this way: the Propeller boots from ROM and can always be reloaded over USB.

### Option B: Propeller Tool

#### 1. Prepare the tools

1. Download and install the Propeller development tool:
   - http://www.grandideastudio.com/wp-content/uploads/P8X32A-Setup-Propeller-Tool-v1.3.2.zip

   ![Propeller Tool main window](/media/image1.png "Propeller Tool main window")
2. Download the firmware source:
   - the original firmware: https://github.com/grandideastudio/jtagulator
   - or PinHound: https://github.com/gilbertorconde/pinhound

   ![Official GitHub page](/media/image2.png "Official GitHub page")
   - On the right side of the GitHub page, click **Releases** and download the archive of the latest (or the version you need), then unpack it.

   ![Official GitHub releases page](/media/image3.png "Official GitHub releases")

#### 2. Compile and flash

1. In Propeller Tool, open `JTAGulator.spin` from the unpacked folder (`File` → `Open`).
2. In the file list on the left, right-click `JTAGulator.spin` and choose `Set Top Object File`. The name turns bold.

   ![File list](/media/image4.png "File list")
3. Connect the JTAGulator to the computer with the USB cable.
4. Press **F7** to detect the device. Once it's found, press **Ctrl + F11** to compile and write the firmware to EEPROM.

   ![ ](/media/image5.png " ")
   ![ ](/media/image6.png " ")

#### OpenSpin (Linux and macOS)

[OpenSpin](https://github.com/parallaxinc/OpenSpin) compiles the firmware from the command line:

```bash
openspin -b JTAGulator.spin   # produces JTAGulator.binary
```

Load the resulting `.binary` with PinHound Studio (Firmware → From file) or any Propeller loader.

### PinHound firmware

The original firmware hadn't been updated for about two and a half years (as of November 2025). PinHound keeps every original feature and adds:

- **Manufacturer names.** After a successful JTAG or SWD scan, each ID is shown with the company that made the chip. The names come from a database of 1,953 manufacturers.
- **Logic analyzer fixes and extensions.**
  - Triggers work on all 24 channels instead of only CH0–7 (1.3), with up to four chained stages (1.4).
  - Captures can keep samples from before the trigger (1.3).
  - 1,364 samples per capture instead of 1,024, and run-length encoding for much longer captures of slow signals (1.4).
- **JTAG name lookup fix (1.3).** Earlier versions showed the wrong name for every manufacturer outside JEP106 bank 0.

#### Writing the manufacturer database (once)

The names are stored in the upper half of the JTAGulator's EEPROM, so the database has to be written once.

**With PinHound Studio:**

1. Open **Firmware** and click **Check** to see whether the database is already there. The check runs a small program from RAM and writes nothing.
2. Click **Write database**. The writer runs from RAM, so the installed firmware isn't touched. It takes about 20 minutes and shows progress.

**With Propeller Tool:**

1. In the `eepromupdate` folder, set `EEPROM_Update.spin` as the Top Object File.
2. Press **F10** to load it into RAM, or **F11** to write it to EEPROM.
3. Open a serial terminal on the JTAGulator. The writer runs three steps: **clear the database area → write the database → verify**. This takes about 20 minutes. It ends with `Result: Success - Writing completion flag`.
4. If you used F11, flash `JTAGulator.spin` again afterwards. F11 replaced the main firmware with the writer.

> **Note:** writing the database is a one-time job. Afterwards you can flash any firmware version; the database stays, and the names come back whenever PinHound firmware is installed.

