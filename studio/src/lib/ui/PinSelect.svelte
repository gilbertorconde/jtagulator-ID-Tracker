<script lang="ts">
  import { ROLE_COLOR, ROLE_LABEL, type Role } from "./signals";

  interface Props {
    role: Role;
    value: number | null;
    /** Allow "unknown" (null). */
    optional?: boolean;
    optionalLabel?: string;
    onchange?: (v: number | null) => void;
  }
  let { role, value = $bindable(), optional = false, optionalLabel = "Unknown", onchange }: Props = $props();
</script>

<label class="pinsel" style:--c={ROLE_COLOR[role]}>
  <span class="tag">{ROLE_LABEL[role]}</span>
  <select
    class="input mono"
    value={value === null ? "" : String(value)}
    onchange={(e) => {
      const v = (e.currentTarget as HTMLSelectElement).value;
      value = v === "" ? null : +v;
      onchange?.(value);
    }}
  >
    {#if optional || value === null}
      <option value="">{optional ? optionalLabel : "—"}</option>
    {/if}
    {#each Array.from({ length: 24 }, (_, i) => i) as ch (ch)}
      <option value={String(ch)}>CH{ch}</option>
    {/each}
  </select>
</label>

<style>
  .pinsel {
    display: flex;
    align-items: stretch;
    border-radius: var(--radius-sm);
    min-width: 0;
  }
  .tag {
    display: flex;
    align-items: center;
    padding: 0 9px;
    font: 700 11px var(--font-mono);
    color: var(--c);
    background: color-mix(in srgb, var(--c) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
    border-right: none;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
    min-width: 58px;
    justify-content: center;
  }
  select {
    flex: 1;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }
</style>
