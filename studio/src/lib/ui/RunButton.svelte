<script lang="ts">
  import { Play } from "@lucide/svelte";
  import { app } from "../stores/app.svelte";
  let {
    label,
    onclick,
    disabled = false,
    reason,
    needsVoltage = true,
  }: { label: string; onclick: () => void; disabled?: boolean; reason?: string; needsVoltage?: boolean } = $props();
  const blocked = $derived(
    app.status !== "connected"
      ? "Connect a JTAGulator first"
      : app.mode !== "normal"
        ? "Exit logic analyzer / OpenOCD mode first"
        : app.busy
          ? "Another operation is running"
          : needsVoltage && app.voltage === null
            ? "Set the target I/O voltage first (top bar)"
            : null,
  );
</script>

<button class="btn primary" disabled={disabled || !!blocked} {onclick} title={blocked ?? reason ?? ""}>
  <Play size={14} />
  {label}
</button>
{#if blocked && !app.busy}<span class="faint hint">{blocked}</span>{:else if reason && disabled}<span class="faint hint">{reason}</span>{/if}

<style>
  .hint {
    font-size: 12px;
  }
</style>
