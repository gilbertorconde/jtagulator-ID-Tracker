<script lang="ts">
  import type { PinsLow } from "../core/types";
  let { value = $bindable() }: { value: PinsLow | false } = $props();
  let low = $state(100);
  let high = $state(100);
  let on = $state(false);
  $effect.pre(() => {
    if (value) {
      on = true;
      low = value.lowMs;
      high = value.highMs;
    }
  });
  const update = () => (value = on ? { lowMs: low, highMs: high } : false);
</script>

<div class="pl">
  <label class="check">
    <input type="checkbox" bind:checked={on} onchange={update} />
    <span>Pulse channels LOW before each permutation</span>
  </label>
  {#if on}
    <div class="times">
      <label>LOW <input class="input mono" type="number" min="1" max="1000" bind:value={low} oninput={update} /> ms</label>
      <label>then HIGH <input class="input mono" type="number" min="1" max="1000" bind:value={high} oninput={update} /> ms</label>
    </div>
    <div class="hint">Resets targets that need a reset line toggled. Much slower: one progress tick per permutation.</div>
  {/if}
</div>

<style>
  .pl {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .times {
    display: flex;
    gap: 16px;
    font-size: 12.5px;
    color: var(--text-muted);
  }
  .times input {
    width: 72px;
    margin: 0 4px;
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
