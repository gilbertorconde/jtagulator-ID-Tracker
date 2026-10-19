{{ EEPROM probe for JTAGulator Studio.
   Loaded into RAM only (never written to EEPROM). Reports what is stored in the
   upper half of the 64 KB EEPROM, then idles until the host resets the board.
   Output is one line:
   JTS-PROBE flag=XX mode=N vtarget=N amd=<name> arm=<name> st=<name> end }}

CON
  _clkmode = xtal1 + pll16x
  _xinfreq = 5_000_000

  EEPROM_SCL = 28
  EEPROM_DEVICE = $A0
  NAMES = $8080
  FLAG = $FFF0

OBJ
  eeprom : "Basic_I2C_Driver"
  pst    : "PropSerial"

VAR
  byte buf[17]
  long value

PUB main
  pst.Start(115_200)
  eeprom.Initialize(EEPROM_SCL)
  waitcnt(clkfreq / 5 + cnt)
  repeat 2
    report
    waitcnt(clkfreq / 2 + cnt)
  repeat

PRI report
  pst.Str(string(13, 10, "JTS-PROBE flag="))
  bytefill(@buf, 0, 17)
  eeprom.ReadPage(EEPROM_SCL, EEPROM_DEVICE, FLAG, @buf, 1)
  pst.Hex(buf[0], 2)
  pst.Str(string(" mode="))
  eeprom.ReadPage(EEPROM_SCL, EEPROM_DEVICE, $8000, @value, 4)
  pst.Dec(value)
  pst.Str(string(" vtarget="))
  eeprom.ReadPage(EEPROM_SCL, EEPROM_DEVICE, $8004, @value, 4)
  pst.Dec(value)
  name(string(" amd="), 1)
  name(string(" arm="), 563)
  name(string(" st="), 32)
  pst.Str(string(" end", 13, 10))

PRI name(label, index) | i, c
  pst.Str(label)
  bytefill(@buf, 0, 17)
  eeprom.ReadPage(EEPROM_SCL, EEPROM_DEVICE, NAMES + (index - 1) * 16, @buf, 16)
  repeat i from 0 to 15
    c := buf[i]
    if c == 0
      quit
    if c < 33 or c > 126
      c := "_"
    pst.Char(c)
