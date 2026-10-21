# Manufacturer database

PinHound firmware stores the JEDEC **JEP106** manufacturer list in the upper half of the JTAGulator's 64 KB EEPROM, so the firmware prints a manufacturer name next to every JTAG IDCODE and SWD DPIDR it reads. This is the same list behind the manufacturer field of a JTAG IDCODE and the designer field of an ARM DPIDR: a bank number (bits 11..8) and a 7-bit code (bits 7..1).

| Property | Value |
| :--- | :--- |
| Entries | 1,953 manufacturers |
| Layout | 126 entries per bank, 16 bytes per name, from EEPROM address `0x8080` |
| Completion flag | `0x5A` at `0xFFF0` |
| Write time | About 20 minutes, every page verified |

The database survives firmware updates, so you write it once.

## Writing it

- **PinHound Studio:** on the **Firmware** page, click **Check** (runs a read-only probe from RAM), then **Write database** if it's missing. The writer runs from RAM and only touches the upper 32 KB, so the installed firmware stays.
- **Command line:** `pinhound firmware probe`, then `pinhound firmware db --yes`.
- **Propeller Tool:** load `eepromupdate/EEPROM_Update.spin` into RAM (F10) and watch a serial terminal at 115200 8N1 until `Result: Success - Writing completion flag`. If it's interrupted, power-cycle and run it again.

![Writing the database](/image/running.png)

## Without the database

Studio carries the same table (`studio/src/lib/data/jep106.json`, generated from `eepromupdate/jep106.inc`), so it shows manufacturer names even on stock firmware. It also knows about 500 exact part numbers; see [Targets and chip IDs](/studio/targets).

![JTAG scan result in a serial terminal](/image/jtag.png)

## Adding a manufacturer

Open an issue or pull request with the chip's IDCODE, the manufacturer's official name and a source (datasheet or website). After editing `eepromupdate/jep106.inc`, run `pnpm gen:jep106` in `studio/` to refresh the app's copy. There is room for one or two hundred more names.
