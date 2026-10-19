<script lang="ts">
  import WiringGuide from "../WiringGuide.svelte";
  import type { Finding, PinsLow } from "../../core/types";
  import { app } from "../../stores/app.svelte";
  import OpResults from "../OpResults.svelte";
  import Panel from "../Panel.svelte";
  import PinSelect from "../PinSelect.svelte";
  import PinsLowField from "../PinsLowField.svelte";
  import RangeField from "../RangeField.svelte";
  import RunButton from "../RunButton.svelte";
  import { pinMap } from "../signals";

  const t = app.target;
  let start = $state(t.range.start);
  let end = $state(t.range.end);
  let pinsLow = $state<PinsLow | false>(false);
  let swdio = $state<number | null>(t.swd.swdio ?? 0);
  let swclk = $state<number | null>(t.swd.swclk ?? 1);

  const roles = $derived(pinMap([["swdio", app.target.swd.swdio], ["swclk", app.target.swd.swclk]]));
  const ok = $derived(swdio !== null && swclk !== null && swdio !== swclk);

  function use(f: Finding) {
    if (f.kind !== "swd" || f.swdio < 0) return;
    swdio = f.swdio;
    swclk = f.swclk;
  }
</script>

{#snippet useAction(f: Finding)}
  {#if f.kind === "swd" && f.swdio >= 0}<button class="btn sm" onclick={() => use(f)}>Use pinout</button>{/if}
{/snippet}

<div class="guide-wrap"><WiringGuide kind="swd" /></div>
<div class="warn">
  The JTAGulator's input circuitry doesn't work with many SWD targets, so a scan can miss a real SWD port. See the
  <a href="https://github.com/grandideastudio/jtagulator/wiki/Hardware-Modifications" target="_blank" rel="noreferrer">hardware modifications</a> page.
</div>

<div class="cols">
  <Panel title="SWD discovery" subtitle="Tries every SWDIO/SWCLK pair: line reset, then read the DPIDR.">
    <RangeField bind:start bind:end min={2} {roles} permutations={(n) => n * (n - 1)} />
    <PinsLowField bind:value={pinsLow} />
    {#snippet footer()}
      <RunButton label="Start SWD scan" onclick={() => app.run("swd.scan", { start, end, pinsLow: pinsLow || undefined })} disabled={end - start < 1} />
    {/snippet}
  </Panel>
  <Panel title="Results">
    <OpResults names={["swd.scan"]} actions={useAction} />
  </Panel>
  <Panel title="Read DPIDR" subtitle="With a known pinout, read and decode the Debug Port ID register.">
    <div class="pins">
      <PinSelect role="swdio" bind:value={swdio} />
      <PinSelect role="swclk" bind:value={swclk} />
    </div>
    <OpResults names={["swd.deviceId"]} />
    {#snippet footer()}
      <RunButton label="Read DPIDR" onclick={() => app.run("swd.deviceId", { swdio, swclk })} disabled={!ok} />
    {/snippet}
  </Panel>
</div>

<style>
  .guide-wrap {
    margin-bottom: 14px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(440px, 100%), 1fr));
    gap: 14px;
    align-items: start;
  }
  .pins {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .warn {
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--warn-soft);
    color: var(--text);
    font-size: 12.5px;
    margin-bottom: 14px;
  }
</style>
