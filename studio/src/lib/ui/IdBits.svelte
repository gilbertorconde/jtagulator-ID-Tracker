<script lang="ts">
  // An IDCODE / DPIDR as labeled bit fields.
  import { dpidrFields, jtagFields } from "../core/idcode";
  let { raw, kind }: { raw: number; kind: "jtag" | "swd" } = $props();
  const fields = $derived(kind === "jtag" ? jtagFields(raw) : dpidrFields(raw));
</script>

<div class="bits">
  {#each fields as f (f.label)}
    <div class="f" style:flex-grow={f.bits.length}>
      <div class="b mono">{f.bits}</div>
      <div class="l">{f.label} <span>{f.range}</span></div>
    </div>
  {/each}
</div>

<style>
  .bits {
    display: flex;
    gap: 3px;
    width: 100%;
  }
  .f {
    flex-basis: 0;
    min-width: 26px;
    text-align: center;
  }
  .b {
    padding: 3px 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11px;
    letter-spacing: 0.08em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .l {
    margin-top: 2px;
    font-size: 10px;
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .l span {
    font-family: var(--font-mono);
  }
</style>
