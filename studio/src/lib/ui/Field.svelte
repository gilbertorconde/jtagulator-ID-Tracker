<script lang="ts">
  import type { Snippet } from "svelte";
  let { label, hint, children, wide = false }: { label: string; hint?: string; children: Snippet; wide?: boolean } = $props();
</script>

<label class="field" class:wide>
  <span class="label">{label}</span>
  {@render children()}
  {#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .field.wide {
    grid-column: 1 / -1;
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
