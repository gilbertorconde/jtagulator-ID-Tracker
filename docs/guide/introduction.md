# Introduction


The JTAGulator is an open-source, all-in-one hardware debugging tool designed by security researcher Joe Grand. It combines three core functions:

- **automatic interface identification**
- a **logic analyzer**
- **chip programming and debugging** (through OpenOCD)

It is especially useful for hardware reverse engineering, embedded security testing and firmware extraction.

The hardware design, firmware source and documentation are fully open:

- Official page: http://www.grandideastudio.com/jtagulator/
- Original firmware: https://github.com/grandideastudio/jtagulator
- ID Tracker (this project: enhanced firmware and the JTAGulator Studio app): https://github.com/gilbertorconde/jtagulator-ID-Tracker
- Video tutorials (Chinese): https://space.bilibili.com/39602674

There are two ways to use the JTAGulator:

1. **JTAGulator Studio**, the graphical app in `studio/`. It drives the device for you; see [JTAGulator Studio](/studio/).
2. **A serial terminal**, typing the firmware's single-letter commands. Most of this manual describes these commands, because Studio runs exactly the same commands underneath.


The JTAGulator's design is worth studying in its own right: the input protection, ESD circuitry and clean layout show Joe Grand's experience in hardware security design. Its core functions are mature, and the community keeps extending it, through enhanced firmware like ID Tracker, apps like JTAGulator Studio, and simple hardware changes such as smaller series resistors.
