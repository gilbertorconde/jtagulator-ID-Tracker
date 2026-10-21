<script lang="ts">
  import { Download, RefreshCw } from "@lucide/svelte";
  import { app } from "../../stores/app.svelte";
  import { updates } from "../../stores/updates.svelte";
  import Field from "../Field.svelte";
  import Panel from "../Panel.svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { version as webVersion } from "../../../../package.json";

  // The desktop app reports its own version (it changes with in-app updates).
  let version = $state(webVersion);
  $effect(() => {
    if (app.tauri) void getVersion().then((v) => (version = v));
  });

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

  {#if app.tauri}
    <Panel title="Updates" subtitle="New Studio releases install from GitHub, verified with the release signing key.">
      <div class="small">
        {#if updates.status === "checking"}
          <p class="muted">Checking…</p>
        {:else if updates.status === "none"}
          <p>You have the latest version ({version}).</p>
        {:else if updates.status === "available"}
          <p><b>Version {updates.version} is available</b> (you have {version}).</p>
          {#if updates.notes}<pre class="notes">{updates.notes}</pre>{/if}
        {:else if updates.status === "downloading"}
          <p>Downloading {updates.version}… {updates.progress !== null ? `${Math.round(updates.progress * 100)}%` : ""}</p>
        {:else if updates.status === "installing"}
          <p>Installing {updates.version}. The app will restart.</p>
        {:else if updates.status === "error"}
          <p class="warn">Update failed: {updates.error}</p>
        {:else}
          <p class="muted">Version {version}.</p>
        {/if}
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={app.settings.autoUpdateCheck} />
        Check for updates when the app starts (at most once a day)
      </label>
      {#snippet footer()}
        <button class="btn" onclick={() => updates.check()} disabled={updates.status === "checking" || updates.status === "downloading" || updates.status === "installing"}>
          <RefreshCw size={13} /> Check for updates
        </button>
        {#if updates.status === "available"}
          <button class="btn primary" onclick={() => updates.install()}><Download size={13} /> Install {updates.version} and restart</button>
        {/if}
      {/snippet}
    </Panel>
  {/if}

  <Panel title="About">
    <div class="small">
      <p><b>PinHound Studio</b> {version}: a desktop and browser frontend for the <a href="https://jtagulator.com" target="_blank" rel="noreferrer">JTAGulator</a>, the hardware tool by Joe Grand (Grand Idea Studio). PinHound is an independent project; its manufacturer ID database comes from <a href="https://github.com/Chaoschaos1024/jtagulator-ID-Tracker" target="_blank" rel="noreferrer">ID Tracker</a> by Weiao (Chaoschaos1024).</p>
      <p class="muted">
        It drives the stock firmware's text menu over USB serial (115200 8N1), so it works with PinHound and with the original firmware. Manufacturer
        names are decoded locally from the JEP106 table that ships with PinHound (1,953 entries), even on firmware without the EEPROM database.
      </p>
    </div>
  </Panel>
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr));
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
  .warn {
    color: var(--warn);
  }
  .notes {
    white-space: pre-wrap;
    font-size: 12px;
    max-height: 160px;
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    margin: 0;
  }
</style>
