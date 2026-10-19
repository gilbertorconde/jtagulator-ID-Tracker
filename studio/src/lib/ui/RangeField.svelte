<script lang="ts">
  import PinHeader from "./PinHeader.svelte";
  import type { PinMap } from "./signals";

  interface Props {
    start: number;
    end: number;
    min: number;
    roles?: PinMap;
    permutations?: (n: number) => number;
  }
  let { start = $bindable(), end = $bindable(), min, roles = {}, permutations }: Props = $props();

  const n = $derived(end - start + 1);
  const valid = $derived(n >= min);
</script>

<div class="range">
  <div class="row">
    <span class="label">Channels</span>
    <div class="nums">
      <input class="input mono" type="number" min="0" max="23" bind:value={start} />
      <span class="muted">to</span>
      <input class="input mono" type="number" min="0" max="23" bind:value={end} />
    </div>
    <span class="meta" class:bad={!valid}>
      {#if !valid}
        Need at least {min} channels
      {:else}
        {n} channels{#if permutations} · {permutations(n).toLocaleString()} permutations{/if}
      {/if}
    </span>
  </div>
  <PinHeader
    compact
    {roles}
    range={{ start, end }}
    onrange={(r) => {
      start = r.start;
      end = Math.max(r.end, Math.min(23, r.start + min - 1));
    }}
  />
  <div class="hint">Drag across the header to pick the channels wired to the target.</div>
</div>

<style>
  .range {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .nums {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .nums input {
    width: 64px;
  }
  .meta {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-muted);
  }
  .meta.bad {
    color: var(--danger);
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
