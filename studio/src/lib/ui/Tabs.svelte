<script lang="ts" generics="T extends string">
  let { tabs, value = $bindable() }: { tabs: { id: T; label: string; hint?: string }[]; value: T } = $props();
</script>

<div class="tabs" role="tablist">
  {#each tabs as t (t.id)}
    <button role="tab" aria-selected={value === t.id} class:active={value === t.id} title={t.hint} onclick={() => (value = t.id)}>
      {t.label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: fit-content;
    flex-wrap: wrap;
  }
  button {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font: 500 13px var(--font-sans);
    padding: 6px 12px;
    border-radius: 7px;
    cursor: pointer;
    transition: all 0.15s;
  }
  button:hover {
    color: var(--text);
  }
  button.active {
    background: var(--overlay);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
  }
</style>
