<script lang="ts">
  // Puts the JTAGulator in OpenOCD (Bus Pirate) mode, hands the serial port to
  // OpenOCD, streams its output, and brings the device back afterwards.
  import { Play, Square, LogOut, Copy } from "@lucide/svelte";
  import type { JtagPins } from "../core/types";
  import { spawn, splitArgs, which, type ProcessHandle } from "../core/process";
  import { app } from "../stores/app.svelte";
  import Field from "./Field.svelte";
  import Panel from "./Panel.svelte";
  import RunButton from "./RunButton.svelte";

  let { pins, valid }: { pins: JtagPins; valid: boolean } = $props();

  const TARGETS = [
    { value: "", label: "None (just probe the chain)" },
    { value: "target/stm32f1x.cfg", label: "STM32F1" },
    { value: "target/stm32f4x.cfg", label: "STM32F4" },
    { value: "target/stm32h7x.cfg", label: "STM32H7" },
    { value: "target/nrf52.cfg", label: "nRF52" },
    { value: "target/rp2040.cfg", label: "RP2040" },
    { value: "target/esp32.cfg", label: "ESP32" },
    { value: "target/at91sam9260.cfg", label: "AT91SAM9260" },
    { value: "target/ath79.cfg", label: "Atheros AR7xxx/AR9xxx (MIPS)" },
    { value: "target/bcm2835.cfg", label: "BCM2835 (Raspberry Pi)" },
  ];

  let target = $state("");
  let speed = $state("100");
  let extra = $state("");
  let program = $state("openocd");
  let found = $state<string | null | undefined>(undefined);
  let proc = $state<ProcessHandle | null>(null);
  let lines = $state<{ text: string; err: boolean }[]>([]);
  let logEl: HTMLDivElement | undefined = $state();
  let port = $state(app.portName ?? "/dev/ttyUSB0");

  $effect(() => {
    if (app.portName && app.transportKind === "tauri") port = app.portName;
  });

  $effect(() => {
    if (app.tauri && found === undefined) void which("openocd").then((p) => (found = p));
  });

  const args = $derived(
    [
      "-f interface/buspirate.cfg",
      `-c "transport select jtag; buspirate port ${port}; adapter speed ${speed}"`,
      target ? `-f ${target}` : "",
      extra,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const command = $derived(`${program} ${args}`);
  const inOcd = $derived(app.mode === "ocd");

  async function enter() {
    await app.run("jtag.openocd", { ...pins });
  }

  async function launch() {
    lines = [];
    const path = port;
    // OpenOCD needs the port to itself.
    if (app.status === "connected") await app.disconnect();
    try {
      proc = await spawn(program, splitArgs(args), (text, s) => {
        lines = [...lines.slice(-2000), { text, err: s === "err" }];
        queueMicrotask(() => logEl?.scrollTo({ top: logEl.scrollHeight }));
      });
      lines = [{ text: `$ ${command}`, err: false }];
      const code = await proc.exited;
      lines = [...lines, { text: `-- openocd exited (${code ?? "killed"}) --`, err: code !== 0 && code !== null }];
    } catch (e) {
      app.error(e, "Could not start OpenOCD");
    } finally {
      proc = null;
      app.settings.lastPort = path;
    }
  }

  async function backToMenu() {
    await proc?.kill();
    if (app.status !== "connected") await app.connect("tauri", port);
    if (app.mode === "ocd") await app.run("device.exitMode");
  }
</script>

<Panel title="OpenOCD" subtitle="Use the JTAGulator as a Bus Pirate-compatible JTAG adapter for OpenOCD (debug, flash, dump memory).">
  {#snippet aside()}
    {#if inOcd}<span class="badge warn">OpenOCD mode</span>{/if}
    {#if proc}<span class="badge ok">OpenOCD running</span>{/if}
  {/snippet}

  <ol class="steps">
    <li class:done={inOcd || !!proc}>Enter OpenOCD mode with the pinout above. The mode survives resets until you exit it.</li>
    <li class:done={!!proc}>Launch OpenOCD. The app releases the serial port first.</li>
    <li>When done, stop OpenOCD and go back to the menu.</li>
  </ol>

  <div class="grid">
    <Field label="Target config">
      <select class="input" bind:value={target}>
        {#each TARGETS as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
      </select>
    </Field>
    <Field label="Adapter speed">
      <select class="input" bind:value={speed}>
        <option value="50">Slow (50 kHz)</option>
        <option value="100">Normal (100 kHz)</option>
        <option value="500">Fast (500 kHz)</option>
      </select>
    </Field>
    <Field label="Extra arguments" wide>
      <input class="input mono" placeholder={'-c "init; scan_chain; targets"'} bind:value={extra} />
    </Field>
  </div>

  <div class="cmd">
    <code>{command}</code>
    <button class="btn ghost sm icon" title="Copy" onclick={() => navigator.clipboard.writeText(command)}><Copy size={13} /></button>
  </div>

  {#if app.tauri && found === null}
    <div class="warn">OpenOCD isn't on your PATH. Install it (Linux: your package manager, macOS: <code>brew install open-ocd</code>, Windows: the xPack build), or run the command above in a terminal.</div>
  {:else if !app.tauri}
    <div class="faint small">Launching OpenOCD needs the desktop app. In a browser, disconnect and run the command above in a terminal.</div>
  {/if}

  {#if lines.length}
    <div class="log mono" bind:this={logEl}>
      {#each lines as l, i (i)}<div class:err={l.err}>{l.text}</div>{/each}
    </div>
  {/if}

  {#snippet footer()}
    {#if !inOcd && !proc}
      <RunButton label="Enter OpenOCD mode" onclick={enter} disabled={!valid} />
    {/if}
    {#if app.tauri && !proc && (inOcd || app.status !== "connected")}
      <button class="btn primary" disabled={!found} onclick={launch}><Play size={13} /> Launch OpenOCD</button>
    {/if}
    {#if proc}
      <button class="btn danger" onclick={() => proc?.kill()}><Square size={12} /> Stop OpenOCD</button>
    {/if}
    {#if (inOcd || lines.length) && !proc && app.tauri}
      <button class="btn" onclick={backToMenu}><LogOut size={13} /> Back to menu</button>
    {/if}
  {/snippet}
</Panel>

<style>
  .steps {
    margin: 0;
    padding-left: 18px;
    font-size: 12.5px;
    color: var(--text-muted);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .steps li.done {
    color: var(--ok);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .cmd {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 6px 8px 10px;
  }
  .cmd code {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-all;
    font-size: 12px;
  }
  .warn {
    font-size: 12.5px;
    color: var(--warn);
  }
  .small {
    font-size: 12px;
  }
  .log {
    max-height: 260px;
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11.5px;
    white-space: pre-wrap;
  }
  .log .err {
    color: var(--warn);
  }
</style>
