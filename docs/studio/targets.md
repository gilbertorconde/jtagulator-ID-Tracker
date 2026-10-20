# Targets and chip IDs

## Targets

The **Target & findings** page keeps everything learned about the board under test: known pins, channel labels (for example "TP12" or "J3 pin 4"), the target voltage, notes, and every finding from every scan. Scans fill it in automatically and forms prefill from it. You can keep several targets and switch between them.

- **Save** writes the target as a `.jtarget` file to share with someone else.
- **Open** reads one and asks how to bring it in:
  - **Open as new**: add it as its own saved target.
  - **Merge into current**: keep your pins and labels, add what the file knows that you don't, and combine findings without duplicates. Values that disagree are listed.
  - **Replace** (when you already have that target): overwrite your copy with the file.
- **Report** exports a Markdown summary.

Files are validated when opened: bad pin numbers are reset to unknown, findings of unknown kinds are skipped, and files from a newer version of the format are refused with a message.

## Chip IDs

Every JTAG IDCODE and SWD DPIDR is decoded in the app, on any firmware:

- **Manufacturer** from the JEP106 table (1,953 entries).
- **Part** from about 500 known IDs imported from [openFPGALoader](https://github.com/trabucayre/openFPGALoader), [UrJTAG](https://sourceforge.net/p/urjtag/git/ci/master/tree/urjtag/data/) and [OpenOCD](https://github.com/openocd-org/openocd/tree/master/tcl/target), each linked to its source.

## BSDL files

Load a chip's BSDL file (`.bsd`/`.bsdl`, published by chip vendors) in the **BSDL file** panel on the JTAG page. When a loaded file matches a device's IDCODE, Studio:

- names the part,
- names the instructions found by IR/DR discovery,
- prefills the EXTEST opcode for the pin mapper,
- shows package pin names for pin-mapper results.

Loaded files are kept in a local library. `studio/examples/SIM_DEMO_CHIP.bsd` matches the simulator's chip.
