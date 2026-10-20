<script lang="ts">
  // Puts the JTAGulator in OpenOCD (Bus Pirate) mode, hands the serial port to
  // OpenOCD, streams its output, and brings the device back afterwards.
  import { Play, Square, LogOut, Copy, FileCode } from "@lucide/svelte";
  import type { JtagPins } from "../core/types";
  import { spawn, splitArgs, which, type ProcessHandle } from "../core/process";
  import { saveTextAs } from "../files";
  import { ocdArgs, ocdConfigFile, type OcdOptions, type OcdTap } from "../openocd/config";
  import { app } from "../stores/app.svelte";
  import Field from "./Field.svelte";
  import GdbConsole from "./GdbConsole.svelte";
  import DesktopOnly from "./DesktopOnly.svelte";
  import Panel from "./Panel.svelte";
  import RunButton from "./RunButton.svelte";
  import { onDestroy } from "svelte";

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
  let speed = $state<"normal" | "fast">("normal");
  const GDB_PORT = 3333;
  let extra = $state("");
  let program = $state("openocd");
  let found = $state<string | null | undefined>(undefined);
  let proc = $state<ProcessHandle | null>(null);
  let lines = $state<{ text: string; err: boolean }[]>([]);
  let logEl: HTMLDivElement | undefined = $state();

  // A process left behind would keep the serial port or OpenOCD's GDB connection busy.
  onDestroy(() => void proc?.kill());
  let port = $state(app.portName ?? "/dev/ttyUSB0");

  $effect(() => {
    if (app.portName && app.transportKind === "tauri") port = app.portName;
  });

  $effect(() => {
    if (app.tauri && found === undefined) void which("openocd").then((p) => (found = p));
  });

  /** Devices from the newest JTAG finding on these pins, with IR lengths from loaded BSDL files. */
  const taps = $derived.by<OcdTap[]>(() => {
    const f = app.target.findings
      .map((x) => x.finding)
      .find((x) => x.kind === "jtag" && x.tdo === pins.tdo && x.tck === pins.tck && x.tms === pins.tms && x.devices.length);
    if (!f || f.kind !== "jtag") return [];
    return f.devices.map((d) => {
      const bsdl = app.bsdlFor(d.idcode.raw)[0]?.file;
      return { idcode: d.idcode.raw, irLength: bsdl?.irLength ?? null, name: bsdl?.entity ?? d.idcode.part ?? d.idcode.manufacturer ?? undefined };
    });
  });
  const options = $derived<OcdOptions>({ port, speed, target: target || undefined, taps, gdbPort: GDB_PORT });
  const argv = $derived([...ocdArgs(options), ...splitArgs(extra)]);
  const quote = (a: string) => (/^[\w./:=-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, "\\$1")}"`);
  const command = $derived([program, ...argv].map(quote).join(" "));

  async function saveConfig() {
    const name = (target ? target.replace(/^target\//, "").replace(/\.cfg$/, "") : "jtagulator") + "-jtagulator.cfg";
    const text = ocdConfigFile(options, { pins, targetName: app.target.name });
    await saveTextAs(name, text, "cfg").catch((e) => app.error(e, "Save config"));
  }
  const inOcd = $derived(app.mode === "ocd");

  async function enter() {
    await app.run("jtag.openocd", { ...pins });
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** The Propeller resets when the port's DTR line changes and needs about 1.5 s to boot. */
  const BOOT_MS = 2000;

  async function launch() {
    lines = [];
    const path = port;
    const push = (text: string, err: boolean) => {
      lines = [...lines.slice(-2000), { text, err }];
      queueMicrotask(() => logEl?.scrollTo({ top: logEl.scrollHeight }));
    };
    // OpenOCD needs the port to itself. Releasing it resets the board, so let it boot first.
    if (app.status === "connected") {
      await app.disconnect();
      push("Waiting for the JTAGulator to restart…", false);
      await sleep(BOOT_MS);
    }
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        let noReply = false;
        push(`$ ${command}`, false);
        proc = await spawn(program, argv, (text, s) => {
          if (/Is binary\/OpenOCD support enabled/i.test(text)) noReply = true;
          push(text, s === "err");
        });
        const code = await proc.exited;
        push(`-- openocd exited (${code ?? "killed"}) --`, code !== 0 && code !== null);
        // Opening the port can reset the board too; one retry after it has booted.
        if (!noReply || attempt === 2) break;
        push("The JTAGulator didn't answer (it may have been restarting). Trying again…", false);
        await sleep(BOOT_MS);
      }
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
    {#if app.tauri}<li class:done={!!proc}>Launch OpenOCD. The app releases the serial port first.</li>
    <li>Optionally start GDB below to debug the target. When done, stop OpenOCD and go back to the menu.</li>{/if}
  </ol>

  <div class="grid">
    <Field label="Target config">
      <select class="input" bind:value={target}>
        {#each TARGETS as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
      </select>
    </Field>
    <Field label="Adapter speed">
      <select class="input" bind:value={speed}>
        <option value="normal">Normal (about 100 kHz)</option>
        <option value="fast">Fast (about 1 MHz)</option>
      </select>
    </Field>
    {#if app.tauri}
      <Field label="Extra arguments" wide>
        <input class="input mono" placeholder={'-c "init; scan_chain; targets"'} bind:value={extra} />
      </Field>
    {/if}
  </div>

  {#if app.tauri}
    <div class="cmd">
      <code>{command}</code>
      <button class="btn ghost sm icon" title="Copy" onclick={() => navigator.clipboard.writeText(command)}><Copy size={13} /></button>
      <button class="btn ghost sm" title="Save these settings as an OpenOCD config file (openocd -f file.cfg)" onclick={saveConfig}><FileCode size={13} /> Save .cfg</button>
    </div>
  {:else}
    <div class="cfgrow">
      <button class="btn sm" title="Save these settings as an OpenOCD config file (openocd -f file.cfg)" onclick={saveConfig}><FileCode size={13} /> Save OpenOCD .cfg</button>
    </div>
  {/if}
  {#if !target && taps.length}
    <div class="faint small">
      Chain: {taps.map((t) => (t.idcode !== null ? `0x${t.idcode.toString(16).toUpperCase().padStart(8, "0")}` : "BYPASS") + (t.irLength ? ` (IR ${t.irLength})` : "")).join(" → ")}.
      {#if taps.every((t) => t.irLength)}The config declares these taps.{:else}Load a BSDL file for each device to declare the taps; without it OpenOCD auto-probes the chain.{/if}
    </div>
  {/if}

  {#if app.tauri && found === null}
    <div class="warn">OpenOCD isn't on your PATH. Install it (Linux: your package manager, macOS: <code>brew install open-ocd</code>, Windows: the xPack build), or run the command above in a terminal.</div>
  {:else if !app.tauri}
    <DesktopOnly feature="Launching OpenOCD" />
  {/if}

  {#if lines.length}
    <div class="log mono" bind:this={logEl}>
      {#each lines as l, i (i)}<div class:err={l.err}>{l.text}</div>{/each}
    </div>
  {/if}

  <GdbConsole port={GDB_PORT} ocdRunning={!!proc} />

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
  .cfgrow {
    display: flex;
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
