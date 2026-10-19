<script lang="ts">
  import LogicAnalyzerView from "./lib/ui/logic/LogicAnalyzerView.svelte";
  import Sidebar from "./lib/ui/Sidebar.svelte";
  import TerminalDock from "./lib/ui/TerminalDock.svelte";
  import Toasts from "./lib/ui/Toasts.svelte";
  import TopBar from "./lib/ui/TopBar.svelte";
  import FindingsView from "./lib/ui/views/FindingsView.svelte";
  import GpioView from "./lib/ui/views/GpioView.svelte";
  import JtagView from "./lib/ui/views/JtagView.svelte";
  import OverviewView from "./lib/ui/views/OverviewView.svelte";
  import ScanAllView from "./lib/ui/views/ScanAllView.svelte";
  import ScriptsView from "./lib/ui/views/ScriptsView.svelte";
  import SettingsView from "./lib/ui/views/SettingsView.svelte";
  import SwdView from "./lib/ui/views/SwdView.svelte";
  import UartView from "./lib/ui/views/UartView.svelte";
  import { app, type View } from "./lib/stores/app.svelte";

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
  <div class="main">
    <TopBar />
    <div class="content" class:fill={app.view === "scripts"}>
      {#if app.view === "overview"}<OverviewView />
      {:else if app.view === "all"}<ScanAllView />
      {:else if app.view === "jtag"}<JtagView />
      {:else if app.view === "swd"}<SwdView />
      {:else if app.view === "uart"}<UartView />
      {:else if app.view === "gpio"}<GpioView />
      {:else if app.view === "logic"}
        {#if app.dev && app.session}
          <LogicAnalyzerView dev={app.dev} session={app.session} onError={(e) => app.error(e, "Logic analyzer")} />
        {:else}
          <div class="card empty">Connect a JTAGulator (or the simulator) to use the logic analyzer.</div>
        {/if}
      {:else if app.view === "scripts"}<ScriptsView />
      {:else if app.view === "findings"}<FindingsView />
      {:else}<SettingsView />{/if}
    </div>
    {#if app.settings.terminalOpen}<TerminalDock />{/if}
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
  .empty {
    padding: 40px;
    text-align: center;
    color: var(--text-muted);
  }
</style>
