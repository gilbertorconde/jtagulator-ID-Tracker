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
  let anchor = $state<number | null>(null);
  /** Set when a picked range was too short for this scan and got extended. */
  let extended = $state<number | null>(null);
  $effect(() => {
    if (anchor !== null) extended = null;
  });
</script>

<div class="range">
  <div class="row">
    <span class="label">Channels</span>
    <div class="nums">
      <input class="input mono" type="number" min="0" max="23" bind:value={start} oninput={() => (extended = null)} />
      <span class="muted">to</span>
      <input class="input mono" type="number" min="0" max="23" bind:value={end} oninput={() => (extended = null)} />
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
    bind:anchor
    onrange={(r) => {
      // A scan needs at least `min` channels: extend a shorter pick, keeping it within CH0-23.
      const want = Math.max(r.end - r.start + 1, min);
      const s0 = Math.min(r.start, 24 - want);
      extended = r.end - r.start + 1 < min ? r.end - r.start + 1 : null;
      start = s0;
      end = s0 + want - 1;
    }}
  />
  <div class="hint" class:active={anchor !== null}>
    {#if anchor !== null}
      First channel: CH{anchor}. Now click the last channel wired to the target (Esc to cancel).
    {:else if extended !== null}
      This scan needs at least {min} channels, so the {extended === 1 ? "channel" : `${extended} channels`} you picked became CH{start}–CH{end}.
    {:else}
      Pick the channels wired to the target: click the first one, then the last one (or drag across them).
    {/if}
  </div>
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
  .hint.active {
    color: var(--accent);
  }
</style>
