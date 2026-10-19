<script lang="ts">
  // The JTAGulator's 24 channels drawn as its three 8-channel headers. Shows
  // assigned roles and lets you drag-select a channel range.
  import { ROLE_COLOR, ROLE_LABEL, type PinMap } from "./signals";

  interface Props {
    roles?: PinMap;
    range?: { start: number; end: number } | null;
    onrange?: (r: { start: number; end: number }) => void;
    levels?: boolean[] | null;
    names?: Record<number, string>;
    compact?: boolean;
    onpin?: (ch: number) => void;
  }
  let { roles = {}, range = null, onrange, levels = null, names = {}, compact = false, onpin }: Props = $props();

  let dragFrom = $state<number | null>(null);
  let hover = $state<number | null>(null);

  const inRange = (ch: number) => {
    if (dragFrom !== null && hover !== null) {
      const [a, b] = dragFrom < hover ? [dragFrom, hover] : [hover, dragFrom];
      return ch >= a && ch <= b;
    }
    return !!range && ch >= range.start && ch <= range.end;
  };

  function down(ch: number) {
    if (!onrange) return onpin?.(ch);
    dragFrom = ch;
    hover = ch;
  }
  function up() {
    if (dragFrom !== null && hover !== null && onrange) {
      const [a, b] = dragFrom < hover ? [dragFrom, hover] : [hover, dragFrom];
      onrange({ start: a, end: b });
    }
    dragFrom = null;
  }
</script>

<svelte:window onpointerup={up} />

<div class="header" class:compact class:selectable={!!onrange}>
  {#each [0, 1, 2] as bank (bank)}
    <div class="bank">
      <div class="bank-label">CH{bank * 8}–{bank * 8 + 7}</div>
      <div class="pins">
        {#each Array.from({ length: 8 }, (_, i) => bank * 8 + i) as ch (ch)}
          {@const r = roles[ch] ?? []}
          <button
            type="button"
            class="pin"
            class:in-range={inRange(ch)}
            class:assigned={r.length > 0}
            class:high={levels?.[ch] === true}
            class:low={levels?.[ch] === false}
            style:--c={r.length ? ROLE_COLOR[r[0]] : null}
            title={`CH${ch}${names[ch] ? ` (${names[ch]})` : ""}${r.length ? " — " + r.map((x) => ROLE_LABEL[x]).join(", ") : ""}`}
            onpointerdown={() => down(ch)}
            onpointerenter={() => (hover = ch)}
          >
            <span class="dot"></span>
            <span class="num">{ch}</span>
            {#if !compact}
              <span class="role">{r.length ? r.map((x) => ROLE_LABEL[x]).join("/") : (names[ch] ?? "")}</span>
            {/if}
          </button>
        {/each}
      </div>
      {#if !compact}
        <div class="rail"><span>GND</span><span>VADJ</span></div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .header {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    user-select: none;
  }
  .bank {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px;
  }
  .bank-label {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-faint);
    margin-bottom: 6px;
  }
  .pins {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }
  .pin {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 0 4px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: var(--raised);
    color: var(--text-muted);
    cursor: default;
    font: inherit;
    min-width: 0;
    transition: background 0.12s, border-color 0.12s;
  }
  .selectable .pin,
  .pin:hover {
    cursor: pointer;
  }
  .pin.in-range {
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--text);
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--border-strong);
    background: var(--surface);
    transition: all 0.12s;
  }
  .pin.assigned .dot {
    background: var(--c);
    border-color: var(--c);
    box-shadow: 0 0 10px color-mix(in srgb, var(--c) 60%, transparent);
  }
  .pin.high .dot {
    background: var(--ok);
    border-color: var(--ok);
  }
  .pin.low .dot {
    background: var(--surface);
    border-color: var(--text-faint);
  }
  .num {
    font: 600 11px var(--font-mono);
  }
  .role {
    font: 600 9px var(--font-mono);
    color: var(--c, var(--text-faint));
    height: 12px;
    white-space: nowrap;
    overflow: hidden;
    max-width: 100%;
  }
  .rail {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font: 600 9.5px var(--font-mono);
    color: var(--text-faint);
  }
  .compact .pin {
    padding: 4px 0 3px;
  }
  .compact .dot {
    width: 9px;
    height: 9px;
  }
</style>
