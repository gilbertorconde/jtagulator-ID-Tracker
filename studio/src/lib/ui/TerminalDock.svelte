<script lang="ts">
  // Raw view of the JTAGulator's serial UI. Everything the device sends shows here,
  // including output from app-driven commands. Typing goes straight to the device.
  import type { Terminal } from "@xterm/xterm";
  import { Eraser, X } from "@lucide/svelte";
  import { app } from "../stores/app.svelte";
  import XTerm from "./views/XTerm.svelte";

  let term: Terminal | null = null;
  let typed = "";

  $effect(() => {
    const s = app.session;
    if (!s || !term) return;
    const t = term;
    t.writeln("\x1b[2m-- connected to " + (app.portName ?? "device") + " --\x1b[0m");
    // Binary modes (SUMP/OpenOCD) would spray garbage; show them as hex instead.
    return s.rx.on((text) => {
      if (app.mode === "sump" || app.mode === "ocd") {
        t.write("\x1b[2m" + [...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ") + " \x1b[0m");
      } else t.write(text);
    });
  });

  function onData(d: string) {
    if (!app.dev) return;
    if (app.busy) {
      term?.write("\x1b[33m[busy — keys are ignored while an operation runs]\x1b[0m\r\n");
      return;
    }
    app.dev.invalidateMenu();
    void app.dev.raw(d);
    typed += d;
    if (d.includes("\r")) {
      app.recordLine(`await term.send(${JSON.stringify(typed)});`);
      typed = "";
    }
  }

  let dragging = false;
  function drag(e: PointerEvent) {
    if (!dragging) return;
    app.settings.terminalHeight = Math.min(window.innerHeight - 200, Math.max(140, window.innerHeight - e.clientY));
  }
</script>

<svelte:window onpointermove={drag} onpointerup={() => (dragging = false)} />

<div class="dock" style:height="{app.settings.terminalHeight}px">
  <div class="handle" role="separator" onpointerdown={() => (dragging = true)}></div>
  <div class="bar">
    <span class="label">Device terminal</span>
    <span class="faint small">Raw firmware UI. Typing here sends keys to the JTAGulator.</span>
    <div class="grow"></div>
    <button class="btn ghost sm icon" title="Clear" onclick={() => term?.clear()}><Eraser size={13} /></button>
    <button class="btn ghost sm icon" title="Close" onclick={() => (app.settings.terminalOpen = false)}><X size={13} /></button>
  </div>
  <div class="body"><XTerm onready={(t) => (term = t)} ondata={onData} /></div>
</div>

<style>
  .dock {
    position: relative;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .handle {
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    cursor: ns-resize;
    z-index: 2;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 4px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .small {
    font-size: 11.5px;
  }
  .grow {
    flex: 1;
  }
  .body {
    flex: 1;
    min-height: 0;
  }
</style>
