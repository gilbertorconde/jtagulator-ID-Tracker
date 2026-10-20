---
layout: home
hero:
  name: JTAGulator ID Tracker
  text: Find debug interfaces. Name the chips behind them.
  tagline: Enhanced JTAGulator firmware with a manufacturer database, and JTAGulator Studio, a desktop app and command-line tool that drive it.
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: Open in your browser
      link: https://gilbertorconde.github.io/jtagulator-ID-Tracker/app/
      target: _self
    - theme: alt
      text: JTAGulator Studio
      link: /studio/
    - theme: alt
      text: Downloads
      link: https://github.com/gilbertorconde/jtagulator-ID-Tracker/releases
features:
  - title: Interface discovery
    details: Find JTAG, SWD and UART pinouts by brute force across 24 channels, at 1.4 to 3.3 V.
  - title: Chip identification
    details: Every IDCODE and DPIDR decoded against the 1,953-entry JEP106 table and about 500 known part numbers. Load a BSDL file for pin names.
  - title: Logic analyzer
    details: 24 channels with triggers, pre-trigger capture and run-length encoding, decoders for UART, SPI, I2C, 1-Wire, CAN, JTAG and SWD, and sigrok export.
  - title: Debug and automate
    details: OpenOCD with ready-made configs and a GDB console, JavaScript scripts with a macro recorder, and a command-line tool with JSON output.
---

<div class="vp-doc" style="max-width: 1152px; margin: 48px auto 0; padding: 0 24px;">

![JTAGulator Studio: a JTAG scan with each IDCODE decoded](/image/studio-jtag.png)

</div>
