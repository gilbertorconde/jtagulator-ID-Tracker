<script lang="ts">
  import { Cable, Cpu, FlaskConical, Layers, RefreshCw, RotateCcw, Unplug, Usb, Waves, Zap, Code2 } from "@lucide/svelte";
  import { app, type View } from "../../stores/app.svelte";
  import Panel from "../Panel.svelte";
  import PinHeader from "../PinHeader.svelte";
  import { fmtMs, pinMap } from "../signals";

  let port = $state<string>("");

  $effect(() => {
    void app.refreshPorts().then(() => {
      if (!port) port = app.ports.find((p) => p.path === app.settings.lastPort)?.path ?? app.ports.find((p) => p.likely)?.path ?? app.ports[0]?.path ?? "";
    });
  });

  const t = $derived(app.target);
  const roles = $derived(
    pinMap([
      ["tdi", t.jtag.tdi],
      ["tdo", t.jtag.tdo],
      ["tck", t.jtag.tck],
      ["tms", t.jtag.tms],
      ["trst", t.jtag.trst],
      ["swdio", t.swd.swdio],
      ["swclk", t.swd.swclk],
      ["txd", t.uart.txd],
      ["rxd", t.uart.rxd],
    ]),
  );

  const tiles: { view: View; title: string; text: string; icon: typeof Cpu }[] = [
    { view: "all", title: "Scan everything", text: "JTAG, SWD and UART discovery in one go", icon: Layers },
    { view: "jtag", title: "JTAG", text: "Find the pinout, read IDCODEs, IR/DR, pin mapper", icon: Cpu },
    { view: "swd", title: "SWD", text: "Find SWDIO/SWCLK and decode the DPIDR", icon: Zap },
    { view: "uart", title: "UART", text: "Find the console and open a terminal to it", icon: Cable },
    { view: "logic", title: "Logic analyzer", text: "Capture 24 channels and decode UART", icon: Waves },
    { view: "scripts", title: "Scripts", text: "Automate anything, or record a macro", icon: Code2 },
  ];
</script>

<div class="overview">
  {#if app.status !== "connected"}
    <section class="card hero">
      <div class="hero-text">
        <h1>Connect your JTAGulator</h1>
        <p class="muted">Plug it in over USB. The port is usually an FTDI device (<span class="mono">/dev/ttyUSB*</span>, <span class="mono">COM*</span>). Settings are fixed at 115200 8N1.</p>
      </div>
      <div class="connect">
        {#if app.tauri}
          <div class="portrow">
            <select class="input mono" bind:value={port}>
              {#each app.ports as p (p.path)}
                <option value={p.path}>{p.likely ? "★ " : ""}{p.label}</option>
              {:else}
                <option value="">No serial ports found</option>
              {/each}
            </select>
            <button class="btn icon" title="Refresh" onclick={() => app.refreshPorts()}><RefreshCw size={14} /></button>
            <button class="btn primary" disabled={!port || app.status === "connecting"} onclick={() => app.connect("tauri", port)}>
              <Usb size={14} /> {app.status === "connecting" ? "Connecting…" : "Connect"}
            </button>
          </div>
        {:else if app.webSerial}
          <button class="btn primary" disabled={app.status === "connecting"} onclick={() => app.connect("webserial")}><Usb size={14} /> Choose serial port…</button>
        {:else}
          <div class="muted">Serial access needs the desktop app (or Chrome/Edge in a browser).</div>
        {/if}
        <div class="or faint">or</div>
        <button class="btn" disabled={app.status === "connecting"} onclick={() => app.connect("sim")}><FlaskConical size={14} /> Try the simulator</button>
      </div>
    </section>
  {:else}
    <section class="card device">
      <div class="dev-icon"><Cpu size={22} /></div>
      <div class="dev-main">
        <h2>{app.info?.firmware ?? "JTAGulator"}</h2>
        <div class="muted">
          {app.transportKind === "sim" ? "Simulator" : app.portName} ·
          mode <b>{app.mode}</b>{app.menu ? ` · ${app.menu} menu` : ""} ·
          target I/O {app.voltage === null ? "off" : app.voltage.toFixed(1) + " V"}
        </div>
        {#if app.info && !app.info.idTracker}
          <div class="badge warn">Stock firmware: manufacturer names are decoded by the app instead of the EEPROM database.</div>
        {/if}
      </div>
      <div class="dev-actions">
        <button class="btn" onclick={() => app.resetDevice()}><RotateCcw size={14} /> Reset</button>
        <button class="btn" onclick={() => app.disconnect()}><Unplug size={14} /> Disconnect</button>
      </div>
    </section>
  {/if}

  <div class="tiles">
    {#each tiles as tile (tile.view)}
      <button class="card tile" onclick={() => (app.view = tile.view)}>
        <tile.icon size={18} />
        <div>
          <div class="tt">{tile.title}</div>
          <div class="muted small">{tile.text}</div>
        </div>
      </button>
    {/each}
  </div>

  <div class="cols">
    <Panel title={t.name} subtitle="Known pins for the current target">
      {#snippet aside()}<button class="btn sm" onclick={() => (app.view = "findings")}>Open</button>{/snippet}
      <PinHeader {roles} names={t.channelNames} />
    </Panel>
    <Panel title="Activity" badge={String(app.history.length)}>
      {#each app.history.slice(0, 8) as h (h.id)}
        <div class="act">
          <span class="dot {h.status}"></span>
          <span class="grow">{h.label}{h.source === "script" ? " (script)" : ""}</span>
          <span class="faint small">{h.findings.length ? `${h.findings.length} found · ` : ""}{fmtMs(h.durationMs)}</span>
        </div>
      {:else}
        <div class="faint small">Nothing yet.</div>
      {/each}
    </Panel>
  </div>
</div>

<style>
  .overview {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .hero {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 24px;
    padding: 28px;
    align-items: center;
    background:
      radial-gradient(circle at 0% 0%, var(--accent-soft), transparent 55%),
      var(--surface);
  }
  h1 {
    font-size: 22px;
  }
  .hero-text p {
    margin: 6px 0 0;
    max-width: 60ch;
  }
  .connect {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
    min-width: min(380px, 100%);
  }
  .portrow {
    display: flex;
    gap: 6px;
  }
  .portrow select {
    flex: 1;
  }
  .or {
    text-align: center;
    font-size: 12px;
  }
  .device {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 18px 20px;
  }
  .dev-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .dev-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
  }
  h2 {
    font-size: 16px;
  }
  .dev-actions {
    display: flex;
    gap: 8px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .tile {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    text-align: left;
    padding: 14px;
    cursor: pointer;
    color: var(--text);
    font: inherit;
    transition: border-color 0.15s, transform 0.15s;
  }
  .tile:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .tile :global(svg) {
    color: var(--accent);
    flex: none;
    margin-top: 2px;
  }
  .tt {
    font-weight: 600;
  }
  .small {
    font-size: 12px;
  }
  .cols {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 14px;
    align-items: start;
  }
  @media (max-width: 860px) {
    .hero,
    .cols {
      grid-template-columns: 1fr;
    }
    .hero {
      padding: 18px;
    }
    .tiles {
      grid-template-columns: 1fr 1fr;
    }
    .device {
      flex-wrap: wrap;
    }
  }
  @media (max-width: 520px) {
    .tiles {
      grid-template-columns: 1fr;
    }
  }
  .act {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
  }
  .dot.error {
    background: var(--danger);
  }
  .dot.aborted {
    background: var(--warn);
  }
</style>
