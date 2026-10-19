<script lang="ts">
  // xterm.js wrapper. Parent feeds output via the `term` instance it gets from onready.
  import { FitAddon } from "@xterm/addon-fit";
  import { Terminal } from "@xterm/xterm";
  import { onMount } from "svelte";

  let { onready, ondata }: { onready: (t: Terminal) => void; ondata?: (d: string) => void } = $props();
  let el: HTMLDivElement;

  onMount(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const term = new Terminal({
      fontFamily: v("--font-mono"),
      fontSize: 12.5,
      cursorBlink: true,
      convertEol: false,
      scrollback: 20000,
      allowProposedApi: true,
      theme: {
        background: v("--bg"),
        foreground: v("--text"),
        cursor: v("--accent"),
        selectionBackground: "#8b5cf655",
        green: v("--ok"),
        red: v("--danger"),
        yellow: v("--warn"),
        cyan: v("--info"),
        magenta: v("--accent"),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    const sub = term.onData((d) => ondata?.(d));
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* hidden */
      }
    });
    ro.observe(el);
    onready(term);
    return () => {
      ro.disconnect();
      sub.dispose();
      term.dispose();
    };
  });
</script>

<div class="xterm-host" bind:this={el}></div>

<style>
  .xterm-host {
    width: 100%;
    height: 100%;
    min-height: 120px;
    padding: 6px 0 0 8px;
    background: var(--bg);
  }
</style>
