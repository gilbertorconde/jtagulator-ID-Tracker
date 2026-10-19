<script lang="ts">
  import type { Component } from "svelte";
  import Sidebar from "./lib/ui/Sidebar.svelte";
  import Toasts from "./lib/ui/Toasts.svelte";
  import TopBar from "./lib/ui/TopBar.svelte";
  import OverviewView from "./lib/ui/views/OverviewView.svelte";
  import { app, type View } from "./lib/stores/app.svelte";

  // Pages other than the overview load on first use to keep startup small.
  type Lazy = () => Promise<{ default: Component<any> }>;
  const LOADERS: Record<Exclude<View, "overview">, Lazy> = {
    all: () => import("./lib/ui/views/ScanAllView.svelte"),
    jtag: () => import("./lib/ui/views/JtagView.svelte"),
    swd: () => import("./lib/ui/views/SwdView.svelte"),
    uart: () => import("./lib/ui/views/UartView.svelte"),
    gpio: () => import("./lib/ui/views/GpioView.svelte"),
    logic: () => import("./lib/ui/logic/LogicAnalyzerView.svelte"),
    scripts: () => import("./lib/ui/views/ScriptsView.svelte"),
    findings: () => import("./lib/ui/views/FindingsView.svelte"),
    firmware: () => import("./lib/ui/views/FirmwareView.svelte"),
    settings: () => import("./lib/ui/views/SettingsView.svelte"),
  };
  const cache = new Map<string, ReturnType<Lazy>>();
  const load = (v: Exclude<View, "overview">) => {
    if (!cache.has(v)) cache.set(v, LOADERS[v]());
    return cache.get(v)!;
  };
  const terminal = () => import("./lib/ui/TerminalDock.svelte");

  const ORDER: View[] = ["overview", "all", "jtag", "swd", "uart", "gpio", "logic", "scripts", "findings"];

  function keys(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
      app.view = ORDER[+e.key - 1];
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "`") {
      app.settings.terminalOpen = !app.settings.terminalOpen;
      e.preventDefault();
    } else if (e.key === "Escape" && app.op && !app.dialog) {
      app.stop();
    }
  }
</script>

<svelte:window onkeydown={keys} />

<div class="shell">
  <Sidebar />
  {#if app.navOpen}<div class="scrim" role="presentation" onclick={() => (app.navOpen = false)}></div>{/if}
  <div class="main">
    <TopBar />
    <div class="content" class:fill={app.view === "scripts"}>
      {#if app.view === "overview"}
        <OverviewView />
      {:else if app.view === "logic" && !(app.dev && app.session)}
        <div class="card empty">Connect a JTAGulator (or the simulator) to use the logic analyzer.</div>
      {:else}
        {#await load(app.view)}
          <div class="loading faint">Loading…</div>
        {:then mod}
          {#if app.view === "logic"}
            <mod.default
              dev={app.dev}
              session={app.session}
              fullTriggers={app.fullTriggers}
              onError={(e: unknown) => app.error(e, "Logic analyzer")}
            />
          {:else}
            <mod.default />
          {/if}
        {:catch e}
          <div class="card empty">Could not load this page: {e?.message ?? e}</div>
        {/await}
      {/if}
    </div>
    {#if app.settings.terminalOpen}
      {#await terminal() then T}<T.default />{/await}
    {/if}
  </div>
</div>
<Toasts />

<style>
  .shell {
    display: flex;
    height: 100%;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 18px 20px 28px;
  }
  .content.fill {
    overflow: hidden;
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.45);
    z-index: 39;
  }
  @media (max-width: 860px) {
    .content {
      padding: 12px 12px 24px;
    }
  }
  .loading {
    padding: 40px;
    text-align: center;
  }
  .empty {
    padding: 40px;
    text-align: center;
    color: var(--text-muted);
  }
</style>
