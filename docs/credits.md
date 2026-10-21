# Credits

PinHound stands on the work of others.

## The JTAGulator

**[Joe Grand](https://github.com/joegrand)** of **[Grand Idea Studio](http://www.grandideastudio.com)** designed the JTAGulator hardware and wrote its original firmware, [grandideastudio/jtagulator](https://github.com/grandideastudio/jtagulator). PinHound's firmware is built on that firmware, and its source files keep their original headers.

JTAGulator is Grand Idea Studio's product. PinHound is an independent project and isn't affiliated with or endorsed by Grand Idea Studio.

## ID Tracker

**Weiao ([Chaoschaos1024](https://github.com/Chaoschaos1024))** created [ID Tracker](https://github.com/Chaoschaos1024/jtagulator-ID-Tracker), the fork PinHound grew from:

- the JEP106 manufacturer database stored in the JTAGulator's EEPROM, and the writer that puts it there;
- the manufacturer lookup in the firmware's JTAG and SWD results;
- the original user manual, on which this site's guide is based.

PinHound firmware continues ID Tracker's version numbers: releases up to 1.3 were published as ID Tracker.

## Data sources

- Manufacturer names: the JEDEC JEP106 list.
- Part numbers in PinHound Studio: [openFPGALoader](https://github.com/trabucayre/openFPGALoader), [UrJTAG](https://sourceforge.net/p/urjtag/) and [OpenOCD](https://openocd.org), each entry linked to its source.

## License

PinHound's own code (PinHound Studio, the command-line tool, this site and the firmware changes) is MIT licensed. The original JTAGulator firmware, © Grand Idea Studio, Inc., is distributed under the [Creative Commons Attribution 3.0 United States](http://creativecommons.org/licenses/by/3.0/us/) license.

Thanks also to chip manufacturers for publishing their technical documentation, and to everyone who tested and gave feedback.
