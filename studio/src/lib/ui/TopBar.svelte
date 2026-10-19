<script lang="ts">
  import { Circle, LogOut, Square, SquareTerminal, Zap } from "@lucide/svelte";
  import { app } from "../stores/app.svelte";

  const TITLES: Record<string, string> = {
    overview: "Overview",
    all: "Scan all",
    jtag: "JTAG",
    swd: "SWD",
    uart: "UART",
    gpio: "GPIO",
    logic: "Logic analyzer",
    scripts: "Scripts",
    findings: "Target & findings",
    settings: "Settings",
  };
  const PRESETS = [1.8, 2.5, 3.3];
  let custom = $state("");

  async function setV(v: number) {
    await app.run("device.setVoltage", v);
  }
  const canSet = $derived(app.status === "connected" && app.mode === "normal" && !app.busy);
</script>

<header class="topbar">
  <h1>{TITLES[app.view]}</h1>
  <div class="grow"></div>

  {#if app.recording}
    <button class="pill rec" onclick={() => (app.view = "scripts")} title="Recording — stop it on the Scripts page">
      <Circle size={10} fill="currentColor" /> REC {app.recorded.length}
    </button>
  {/if}

  {#if app.op}
    <div class="pill op">
      <span class="spin"></span>
      {app.op.label}{app.op.progress !== null ? ` · ${Math.round(app.op.progress * 100)}%` : ""}
      <button class="btn danger sm" onclick={() => app.stop()} title="Esc"><Square size={11} /> Stop</button>
    </div>
  {/if}

  {#if app.status === "connected" && (app.mode === "sump" || app.mode === "ocd")}
    <div class="pill warn">
      {app.mode === "sump" ? "Logic analyzer mode" : "OpenOCD mode"}
      <button class="btn sm" onclick={() => app.run("device.exitMode")}><LogOut size={12} /> Exit mode</button>
    </div>
  {/if}

  {#if app.status === "connected" && app.mode === "normal"}
    <div class="volt" title="Target I/O voltage (VADJ). Match the target's logic level. Scans need it set.">
      <Zap size={14} />
      <span class="vv mono" class:off={app.voltage === null}>{app.voltage === null ? "OFF" : app.voltage.toFixed(1) + " V"}</span>
      {#each PRESETS as p (p)}
        <button class="seg" class:on={app.voltage === p} disabled={!canSet} onclick={() => setV(p)}>{p}</button>
      {/each}
      <input
        class="input mono vin"
        placeholder="1.4–3.3"
        bind:value={custom}
        disabled={!canSet}
        onkeydown={(e) => {
          if (e.key === "Enter" && +custom >= 1.4 && +custom <= 3.3) {
            void setV(Math.round(+custom * 10) / 10);
            custom = "";
          }
        }}
      />
      <button class="seg" disabled={!canSet || app.voltage === null} onclick={() => setV(0)}>Off</button>
    </div>
  {/if}

  <div class="conn" class:ok={app.status === "connected"} class:wait={app.status === "connecting"}>
    <span class="led"></span>
    {app.status === "connected" ? (app.transportKind === "sim" ? "Simulator" : app.portName) : app.status === "connecting" ? "Connecting…" : "Not connected"}
  </div>
  <button
    class="btn ghost icon"
    class:active={app.settings.terminalOpen}
    title="Device terminal (Ctrl+`)"
    onclick={() => (app.settings.terminalOpen = !app.settings.terminalOpen)}
  >
    <SquareTerminal size={16} />
  </button>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 54px;
    padding: 0 16px 0 20px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  h1 {
    font-size: 16px;
  }
  .grow {
    flex: 1;
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 4px 0 12px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 500;
    border: 1px solid var(--border);
    background: var(--raised);
  }
  .pill.op {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    background: var(--accent-soft);
  }
  .pill.warn {
    background: var(--warn-soft);
    border-color: transparent;
    color: var(--warn);
  }
  .pill.rec {
    color: var(--danger);
    background: var(--danger-soft);
    border-color: transparent;
    padding: 0 12px;
    cursor: pointer;
    font: 700 11.5px var(--font-mono);
    animation: pulse 1.6s infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.6;
    }
  }
  .spin {
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .volt {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px 3px 3px 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--raised);
    color: var(--warn);
  }
  .vv {
    min-width: 50px;
    font-weight: 600;
    color: var(--text);
    margin: 0 4px;
  }
  .vv.off {
    color: var(--text-faint);
  }
  .seg {
    height: 26px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font: 500 12px var(--font-mono);
    cursor: pointer;
  }
  .seg:hover:not(:disabled) {
    background: var(--overlay);
    color: var(--text);
  }
  .seg.on {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .seg:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .vin {
    width: 70px;
    height: 26px;
    font-size: 12px;
  }
  .conn {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    color: var(--text-muted);
    padding: 0 6px;
    max-width: 220px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-faint);
    flex: none;
  }
  .conn.ok .led {
    background: var(--ok);
    box-shadow: 0 0 8px var(--ok);
  }
  .conn.wait .led {
    background: var(--warn);
  }
  .btn.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
