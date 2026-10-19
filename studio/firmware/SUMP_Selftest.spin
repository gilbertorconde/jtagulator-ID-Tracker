{{ Logic analyzer self-test for JTAGulator Studio's hardware tests.
   Loaded into RAM only. One cog drives a counter on CH0-23 (the Propeller pins
   themselves): each byte group carries the same 8-bit count, so a capture must
   show three equal bytes per sample that only ever count up. The rest is the
   real logic analyzer (PropSUMP), driven by the host over SUMP as usual. }}

CON
  _clkmode = xtal1 + pll16x
  _xinfreq = 5_000_000

OBJ
  sump : "PropSUMP"

VAR
  long buf[sump#MAX_SAMPLE_PERIODS]
  long stack[24]

PUB main
  cognew(counter, @stack)
  sump.Go(@buf)
  repeat

PRI counter | c
  dira[23..0]~~
  repeat
    c := (c + 1) & $FF
    outa[23..0] := c | c << 8 | c << 16
