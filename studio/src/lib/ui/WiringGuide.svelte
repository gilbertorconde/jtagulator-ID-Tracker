<script lang="ts">
  // Collapsible "how to wire it" notes per interface. Remembers if you closed it.
  import { ChevronDown, Cable } from "@lucide/svelte";
  import { app } from "../stores/app.svelte";

  type Kind = "jtag" | "swd" | "uart" | "gpio" | "all";
  let { kind }: { kind: Kind } = $props();

  const open = $derived(!app.settings.wiringHidden?.[kind]);
  const toggle = () => (app.settings.wiringHidden = { ...app.settings.wiringHidden, [kind]: open });

  const HEADERS: Record<string, { name: string; pins: string }[]> = {
    jtag: [
      { name: "ARM 20-pin (2.54 mm)", pins: "1 VTref · 3 nTRST · 5 TDI · 7 TMS · 9 TCK · 11 RTCK · 13 TDO · 15 nSRST · even pins 4–20 GND" },
      { name: "ARM Cortex 10-pin (1.27 mm)", pins: "1 VTref · 2 TMS/SWDIO · 4 TCK/SWCLK · 6 TDO/SWO · 8 TDI · 10 nRESET · 3, 5, 9 GND" },
      { name: "MIPS EJTAG 14-pin", pins: "1 nTRST · 3 TDI · 5 TDO · 7 TMS · 9 TCK · 11 nSRST · 13 DINT · 14 VREF · other even pins GND" },
    ],
    swd: [{ name: "ARM Cortex 10-pin (1.27 mm)", pins: "1 VTref · 2 SWDIO · 4 SWCLK · 6 SWO · 10 nRESET · 3, 5, 9 GND" }],
  };
</script>

<section class="guide" class:open>
  <button class="head" onclick={toggle}>
    <Cable size={15} />
    <span>Wiring guide</span>
    <span class="faint small">{open ? "" : "show"}</span>
    <ChevronDown size={15} class="chev" />
  </button>
  {#if open}
    <div class="body">
      <ol>
        <li><b>Ground first.</b> Connect a JTAGulator GND pin to the target's ground. Find it with a multimeter in continuity mode (shields, connector shells, big copper pours).</li>
        <li><b>Match the voltage.</b> Power the target, measure its I/O level (debug header VTref, or the chip's I/O supply) and pick the same value in the top bar. Never connect the VADJ pin to the target.</li>
        {#if kind === "uart"}
          <li><b>Find the candidates.</b> A UART header is often 3–4 pads in a row. With the target powered: GND reads 0 V, VCC holds steady, TX idles high and flickers while the device boots, RX usually floats.</li>
          <li><b>Wire every candidate</b> (not VCC) to consecutive channels, e.g. CH0–CH3, and scan only those. The passive TXD scan sends nothing, so try it first.</li>
        {:else if kind === "gpio"}
          <li><b>Inputs are safe;</b> driving outputs is not. Only drive pins you know are inputs on the target, otherwise two outputs fight.</li>
        {:else}
          <li><b>Wire the unknown pins</b> to consecutive channels starting at CH0 and set the scan range to just those. Every extra channel multiplies the scan time.</li>
          <li><b>Label channels</b> on the Target page with where they go (e.g. "J3 pin 5") so the results read in board terms.</li>
        {/if}
        {#if kind === "all"}
          <li>The scans run one after another on the same channels, so wire everything you want to probe before you start.</li>
        {/if}
        <li>If nothing is found, try <b>pulse channels LOW</b> (holds possible reset lines), a different voltage, or check that the target is actually running.</li>
      </ol>
      {#if HEADERS[kind]}
        <div class="label">Common headers</div>
        <table class="data">
          <tbody>
            {#each HEADERS[kind] as h (h.name)}
              <tr><td class="hn">{h.name}</td><td class="mono small">{h.pins}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</section>

<style>
  .guide {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--info) 6%, var(--surface));
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    border: none;
    background: transparent;
    color: var(--info);
    font: 600 13px var(--font-sans);
    cursor: pointer;
    text-align: left;
  }
  .head span:first-of-type {
    color: var(--text);
  }
  .head :global(.chev) {
    margin-left: auto;
    color: var(--text-muted);
    transition: transform 0.2s;
    transform: rotate(-90deg);
  }
  .open .head :global(.chev) {
    transform: none;
  }
  .body {
    padding: 0 16px 14px;
    font-size: 12.5px;
    color: var(--text-muted);
  }
  ol {
    margin: 0 0 10px;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  b {
    color: var(--text);
  }
  .small {
    font-size: 11.5px;
  }
  .hn {
    white-space: nowrap;
    font-weight: 600;
    color: var(--text);
  }
  @media (max-width: 700px) {
    .hn {
      white-space: normal;
    }
  }
</style>
