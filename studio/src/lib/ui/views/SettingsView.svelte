<script lang="ts">
  import { app } from "../../stores/app.svelte";
  import Field from "../Field.svelte";
  import Panel from "../Panel.svelte";

  const SPEEDS = [
    { value: 0.2, label: "Instant (~0.2 s)" },
    { value: 1, label: "Fast (~1 s)" },
    { value: 4, label: "Normal (~4 s)" },
    { value: 15, label: "Slow (~15 s)" },
    { value: 60, label: "Realistic (~1 min)" },
  ];
</script>

<div class="cols">
  <Panel title="Appearance">
    <Field label="Theme">
      <select class="input" bind:value={app.settings.theme}>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </Field>
  </Panel>

  <Panel title="Safety">
    <label class="check">
      <input type="checkbox" bind:checked={app.settings.confirmRisky} />
      Ask before entering modes that persist across resets (logic analyzer, OpenOCD)
    </label>
  </Panel>

  <Panel title="Simulator" subtitle="A software JTAGulator with a fake target board, for trying the app without hardware.">
    <Field label="Scan speed" hint="How long a full simulated scan takes.">
      <select class="input" bind:value={app.settings.simSpeed}>
        {#if !SPEEDS.some((s) => s.value === app.settings.simSpeed)}
          <option value={app.settings.simSpeed}>Custom ({app.settings.simSpeed} s)</option>
        {/if}
        {#each SPEEDS as s (s.value)}
          <option value={s.value}>{s.label}</option>
        {/each}
      </select>
    </Field>
    <div class="muted small">
      Simulated target: JTAG TDI 3, TDO 5, TCK 2, TMS 4, TRST# 7 (ARM DAP + STM32F4) · RTCK 6 · SWD SWDIO 9 / SWCLK 8 · UART TXD 16 / RXD 17 @ 115200 (U-Boot) · EXTEST map on CH12-14.
    </div>
  </Panel>

  <Panel title="Keyboard">
    <table class="data">
      <tbody>
        <tr><td><kbd>Ctrl</kbd> <kbd>1</kbd>–<kbd>9</kbd></td><td>Switch page</td></tr>
        <tr><td><kbd>Ctrl</kbd> <kbd>`</kbd></td><td>Toggle device terminal</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Stop the running operation</td></tr>
        <tr><td><kbd>Ctrl</kbd> <kbd>Enter</kbd></td><td>Run script (in the editor)</td></tr>
      </tbody>
    </table>
  </Panel>

  <Panel title="About">
    <div class="small">
      <p><b>JTAGulator Studio</b> 0.1.0 — a desktop frontend for the <a href="https://jtagulator.com" target="_blank" rel="noreferrer">JTAGulator</a> by Joe Grand.</p>
      <p class="muted">
        It drives the stock firmware's text menu over USB serial (115200 8N1), so it works with the original firmware and with ID Tracker. Manufacturer
        names are decoded locally from the JEP106 table that ships with ID Tracker (1,953 entries), even on firmware without the EEPROM database.
      </p>
    </div>
  </Panel>
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    cursor: pointer;
  }
  .small {
    font-size: 12.5px;
  }
  p {
    margin: 0 0 8px;
  }
</style>
