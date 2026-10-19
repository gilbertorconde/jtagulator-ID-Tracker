#!/bin/sh
# Rebuilds the firmware images bundled with JTAGulator Studio
# (src/lib/firmware/assets). Needs OpenSpin: https://github.com/parallaxinc/OpenSpin
set -eu
OPENSPIN=${OPENSPIN:-openspin}
here=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$here/.." && pwd)
out="$here/src/lib/firmware/assets"
mkdir -p "$out"
"$OPENSPIN" -q -b -o "$out/jtagulator.binary" "$root/JTAGulator.spin"
"$OPENSPIN" -q -b -o "$out/eeprom-update.binary" "$root/eepromupdate/EEPROM_Update.spin"
"$OPENSPIN" -q -b -L "$root" -o "$out/eeprom-probe.binary" "$here/firmware/EEPROM_Probe.spin"
ls -l "$out"
