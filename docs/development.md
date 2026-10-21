# Building and contributing

The repository holds the firmware (Spin and PASM for the Parallax Propeller) at the root, the database writer in `eepromupdate/`, PinHound Studio in `studio/`, and this site in `docs/`.

## Firmware

Build with [OpenSpin](https://github.com/parallaxinc/OpenSpin) or Propeller Tool 1.3.2. `studio/scripts/build-firmware.sh` rebuilds the images bundled with Studio (set `OPENSPIN` to the compiler). Pushing an `fw-v*` tag builds a firmware release.

## Studio

```sh
cd studio
pnpm install
pnpm tauri dev          # desktop app (needs Rust and the Tauri prerequisites)
pnpm dev                # browser only, http://localhost:1420
pnpm test               # unit and simulator tests
pnpm check              # type checks
npx vitest run --config hw/vitest.config.ts   # against a real JTAGulator
```

The hardware tests need nothing wired to the channels and load firmware into RAM only, so the installed firmware is never changed. Pushing a `studio-v*` tag builds signed installers for every platform into a draft release; publishing it makes the update available to installed apps.

## This site

```sh
cd docs
pnpm install
pnpm dev                # http://localhost:5173/pinhound/
```

Pages are Markdown under `docs/guide` and `docs/studio`. The script API table is generated from `studio/src/lib/scripting/api.ts`. Every push to `master` that changes `docs/` deploys the site to GitHub Pages.

## Contributing

Issues and pull requests are welcome.

- **A missing manufacturer:** send the chip's IDCODE, the manufacturer's official name and a source. After editing `eepromupdate/jep106.inc`, run `pnpm gen:jep106` in `studio/`.
- **A known part number:** add an entry with a source link to `studio/src/lib/data/parts-extra.json`, then run `pnpm gen:parts --urjtag <UrJTAG checkout> --openocd <OpenOCD checkout>` in `studio/`:

```json
{ "id": "0x0362D093", "mask": "0x0FFFFFFF", "name": "XC7A35T", "vendor": "Xilinx (AMD)", "family": "Artix-7",
  "kind": "jtag", "source": "https://link-to-datasheet-or-bsdl" }
```

`mask` 0x0FFFFFFF ignores the version nibble; `kind` is `jtag`, `swd` or `any`.

## Legal and ethical use

Only test devices you are authorized to test, follow local law on hardware debugging, and don't use this tool for piracy or infringement.
