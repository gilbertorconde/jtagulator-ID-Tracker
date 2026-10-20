<script lang="ts">
  // The JTAGulator's 24 channels drawn as its three 8-channel headers. Shows
  // assigned roles and lets you pick a channel range: click the first channel,
  // then the last one, or drag across them.
  import { ROLE_COLOR, ROLE_LABEL, type PinMap } from "./signals";

  interface Props {
    roles?: PinMap;
    range?: { start: number; end: number } | null;
    onrange?: (r: { start: number; end: number }) => void;
    levels?: boolean[] | null;
    names?: Record<number, string>;
    compact?: boolean;
    onpin?: (ch: number) => void;
    /** First channel clicked while picking a range (waiting for the last one). */
    anchor?: number | null;
  }
  let { roles = {}, range = null, onrange, levels = null, names = {}, compact = false, onpin, anchor = $bindable(null) }: Props = $props();

  let dragFrom = $state<number | null>(null);
  let hover = $state<number | null>(null);

  const span = (a: number, b: number) => (a < b ? [a, b] : [b, a]);
  /** The range being picked (drag in progress, or first click made), else the current one. */
  const preview = $derived.by(() => {
    const from = dragFrom ?? anchor;
    if (from !== null) return span(from, hover ?? from);
    return range ? [range.start, range.end] : null;
  });
  const inRange = (ch: number) => !!preview && ch >= preview[0] && ch <= preview[1];

  function down(ch: number) {
    if (!onrange) return onpin?.(ch);
    dragFrom = ch;
    hover = ch;
  }
  function up() {
    if (dragFrom === null || !onrange) return;
    const to = hover ?? dragFrom;
    if (to !== dragFrom) {
      // Dragged across channels: that's the range.
      const [a, b] = span(dragFrom, to);
      onrange({ start: a, end: b });
      anchor = null;
    } else if (anchor === null) {
      // First click: remember it and wait for the last channel.
      anchor = to;
    } else {
      const [a, b] = span(anchor, to);
      onrange({ start: a, end: b });
      anchor = null;
    }
    dragFrom = null;
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Escape" && anchor !== null) {
      anchor = null;
      e.stopPropagation();
    }
  }
</script>

<svelte:window onpointerup={up} onkeydown={key} />

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
            class:anchor={anchor === ch}
            class:assigned={r.length > 0}
            class:high={levels?.[ch] === true}
            class:low={levels?.[ch] === false}
            style:--c={r.length ? ROLE_COLOR[r[0]] : null}
            title={`CH${ch}${names[ch] ? ` (${names[ch]})` : ""}${r.length ? " — " + r.map((x) => ROLE_LABEL[x]).join(", ") : ""}`}
            onpointerdown={() => down(ch)}
            onpointerenter={() => (hover = ch)}
            onpointerleave={() => hover === ch && dragFrom === null && (hover = null)}
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
  @media (max-width: 700px) {
    .header {
      grid-template-columns: 1fr;
      gap: 6px;
    }
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
  .pin.anchor {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
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
