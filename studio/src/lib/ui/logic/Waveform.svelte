<script module lang="ts">
  export interface WaveAnnotation {
    channel: number;
    /** First sample covered. */
    start: number;
    /** Last sample covered (inclusive). */
    end: number;
    label: string;
    /** Longer text for the hover tooltip. */
    title?: string;
    error?: boolean;
  }

  export interface WaveMarkers {
    a: number | null;
    b: number | null;
  }

  export const CHANNEL_COLORS = [
    "--sig-tdi",
    "--sig-tdo",
    "--sig-tck",
    "--sig-tms",
    "--sig-swdio",
    "--sig-rtck",
    "--sig-bsr",
    "--sig-rxd",
  ];

  export const defaultNames = () => Array.from({ length: 24 }, (_, i) => `CH${i}`);
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { ZoomIn, ZoomOut, Maximize2, EyeOff, Eye, ListFilter, X as XIcon } from "@lucide/svelte";
  import type { Capture } from "../../logic/sump";
  import { formatHz, formatTime, transitions } from "../../logic/decode";

  interface Props {
    capture: Capture | null;
    /** Channel display names (index = channel). */
    names?: string[];
    /** hidden[ch] = row not shown. */
    hidden?: boolean[];
    annotations?: WaveAnnotation[];
    markers?: WaveMarkers;
  }

  let {
    capture,
    names = $bindable(defaultNames()),
    hidden = $bindable(Array<boolean>(24).fill(false)),
    annotations = [],
    markers = $bindable({ a: null, b: null }),
  }: Props = $props();

  const ROW_H = 30;
  const LANE_H = 22;
  const RULER_H = 28;
  const MAX_PX_PER_SAMPLE = 80;

  let root: HTMLDivElement;
  let plotWrap: HTMLDivElement;
  let rowsEl: HTMLDivElement;
  let plot: HTMLCanvasElement;
  let ruler: HTMLCanvasElement;

  let W = $state(600);
  let viewStart = $state(0);
  let spp = $state(1); // samples per CSS pixel
  let cursorX = $state<number | null>(null);
  let editing = $state<number | null>(null);
  let showChannelMenu = $state(false);
  let themeTick = $state(0);

  const N = $derived(capture?.samples.length ?? 0);
  const captured = $derived(capture ? capture.channelMask : 0xffffff);
  const trans = $derived(capture ? Array.from({ length: 24 }, (_, ch) => transitions(capture, ch)) : []);
  const annByCh = $derived.by(() => {
    const m = new Map<number, WaveAnnotation[]>();
    for (const a of annotations) {
      let l = m.get(a.channel);
      if (!l) m.set(a.channel, (l = []));
      l.push(a);
    }
    for (const l of m.values()) l.sort((x, y) => x.start - y.start);
    return m;
  });

  interface Row {
    ch: number;
    y: number;
    h: number;
    lane: boolean;
  }
  const rows = $derived.by(() => {
    const out: Row[] = [];
    let y = 0;
    for (let ch = 0; ch < 24; ch++) {
      if (!((captured >>> ch) & 1) || hidden[ch]) continue;
      const lane = annByCh.has(ch);
      const h = ROW_H + (lane ? LANE_H : 0);
      out.push({ ch, y, h, lane });
      y += h;
    }
    return out;
  });
  const contentH = $derived(rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : 0);
  const hiddenCount = $derived(
    Array.from({ length: 24 }, (_, ch) => ch).filter((ch) => (captured >>> ch) & 1 && hidden[ch]).length,
  );

  const minSpp = 1 / MAX_PX_PER_SAMPLE;
  const maxSpp = $derived(Math.max(minSpp, N / Math.max(1, W)));

  function clampView(start: number, s: number) {
    const span = W * s;
    if (span >= N) return 0;
    return Math.min(Math.max(0, start), N - span);
  }

  export function fit() {
    spp = maxSpp;
    viewStart = 0;
  }

  export function zoomAt(factor: number, x = W / 2) {
    const anchor = viewStart + x * spp;
    const s = Math.min(maxSpp, Math.max(minSpp, spp / factor));
    spp = s;
    viewStart = clampView(anchor - x * s, s);
  }

  export function centerOn(sample: number) {
    viewStart = clampView(sample - (W * spp) / 2, spp);
  }

  // Fit whenever a new capture arrives.
  let lastCapture: Capture | null = null;
  $effect(() => {
    if (capture !== lastCapture) {
      lastCapture = capture;
      spp = Math.max(minSpp, (capture?.samples.length ?? 0) / Math.max(1, W));
      viewStart = 0;
    }
  });
  // Keep the view valid on resize.
  $effect(() => {
    void W;
    if (spp > maxSpp) spp = maxSpp;
    viewStart = clampView(viewStart, spp);
  });

  const X = (i: number) => (i - viewStart) / spp;
  const sampleAtX = (x: number) => Math.floor(viewStart + x * spp);
  const cursorSample = $derived(cursorX === null || !N ? null : Math.min(N - 1, Math.max(0, sampleAtX(cursorX))));
  const probe = $derived(cursorSample ?? markers.a);
  const probeValue = $derived(capture && probe !== null && probe < N ? capture.samples[probe] : null);
  const rate = $derived(capture?.sampleRateHz ?? 1);

  // ------------------------------------------------------------------ drawing

  let raf = 0;
  function schedule() {
    if (!raf) raf = requestAnimationFrame(() => ((raf = 0), draw()));
  }

  $effect(() => {
    void [capture, viewStart, spp, W, rows, contentH, markers.a, markers.b, cursorX, annByCh, trans, themeTick];
    schedule();
  });

  function css(name: string, fallback: string) {
    const v = getComputedStyle(root).getPropertyValue(name).trim();
    return v || fallback;
  }

  function setup(c: HTMLCanvasElement, w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (c.width !== pw) c.width = pw;
    if (c.height !== ph) c.height = ph;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  function niceStep(raw: number) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }

  function ticks() {
    if (!N) return { step: 0, list: [] as number[] };
    const secPerPx = spp / rate;
    const step = niceStep(90 * secPerPx);
    const t0 = viewStart / rate;
    const t1 = (viewStart + W * spp) / rate;
    const list: number[] = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1 + step * 1e-9; t += step) list.push(t);
    return { step, list };
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    if (!plot || !ruler || !root) return;
    const col = {
      text: css("--text", "#e7eaf0"),
      muted: css("--text-muted", "#8d96a7"),
      faint: css("--text-faint", "#5d6576"),
      border: css("--border", "#242a35"),
      strong: css("--border-strong", "#323a48"),
      surface: css("--surface", "#11141a"),
      raised: css("--raised", "#171b23"),
      accent: css("--accent", "#a78bfa"),
      warn: css("--warn", "#fbbf24"),
      info: css("--info", "#38bdf8"),
      ok: css("--ok", "#34d399"),
      danger: css("--danger", "#f87171"),
      mono: css("--font-mono", "monospace"),
    };
    const palette = CHANNEL_COLORS.map((v) => css(v, col.accent));
    const H = Math.max(contentH, 1);
    const ctx = setup(plot, W, H);
    const rc = setup(ruler, W, RULER_H);
    const tk = ticks();

    // ---- ruler
    rc.fillStyle = col.raised;
    rc.fillRect(0, 0, W, RULER_H);
    rc.strokeStyle = col.border;
    rc.beginPath();
    rc.moveTo(0, RULER_H - 0.5);
    rc.lineTo(W, RULER_H - 0.5);
    rc.stroke();
    rc.font = `11px ${col.mono}`;
    rc.textBaseline = "top";
    if (tk.step) {
      const minor = tk.step / 5;
      rc.strokeStyle = col.faint;
      rc.beginPath();
      const t0 = viewStart / rate;
      for (let t = Math.floor(t0 / minor) * minor; t <= (viewStart + W * spp) / rate; t += minor) {
        const x = Math.round(X(t * rate)) + 0.5;
        rc.moveTo(x, RULER_H - 4);
        rc.lineTo(x, RULER_H);
      }
      rc.stroke();
      rc.strokeStyle = col.muted;
      rc.fillStyle = col.muted;
      rc.beginPath();
      for (const t of tk.list) {
        const x = Math.round(X(t * rate)) + 0.5;
        rc.moveTo(x, RULER_H - 10);
        rc.lineTo(x, RULER_H);
        const label = formatTime(t, 4);
        if (x + 3 + rc.measureText(label).width < W) rc.fillText(label, x + 3, 4);
      }
      rc.stroke();
    }

    // ---- grid + row separators
    ctx.strokeStyle = col.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of tk.list) {
      const x = Math.round(X(t * rate)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (const r of rows) {
      ctx.moveTo(0, r.y + r.h - 0.5);
      ctx.lineTo(W, r.y + r.h - 0.5);
    }
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ---- waveforms
    if (capture && N) {
      const s = capture.samples;
      const i0 = Math.max(0, Math.floor(viewStart));
      const i1 = Math.min(N, Math.ceil(viewStart + W * spp) + 1);
      const xEnd = Math.min(W, X(N));
      for (const r of rows) {
        const ts = trans[r.ch];
        const color = palette[r.ch % palette.length];
        const yHi = r.y + 6.5;
        const yLo = r.y + ROW_H - 6.5;
        const Y = (l: number) => (l ? yHi : yLo);
        // first transition after i0
        let lo = 0;
        let hi = ts.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (ts[m] <= i0) lo = m + 1;
          else hi = m;
        }
        let lvl = (s[i0] >>> r.ch) & 1;
        let x = Math.max(-1, X(i0));
        const highSpans: number[] = [];
        const dense: number[] = [];
        let hiStart = lvl ? x : NaN;
        ctx.beginPath();
        ctx.moveTo(x, Y(lvl));
        let k = lo;
        while (k < ts.length && ts[k] <= i1) {
          const xt = X(ts[k]);
          let j = k;
          while (j + 1 < ts.length && X(ts[j + 1]) - X(ts[j]) < 1.5) j++;
          ctx.lineTo(xt, Y(lvl));
          if (j === k) {
            if (lvl) highSpans.push(hiStart, xt);
            lvl ^= 1;
            ctx.lineTo(xt, Y(lvl));
            if (lvl) hiStart = xt;
          } else {
            const xe = X(ts[j]);
            if (lvl) highSpans.push(hiStart, xt);
            dense.push(xt, xe);
            lvl ^= (j - k + 1) & 1;
            ctx.moveTo(xe, Y(lvl));
            if (lvl) hiStart = xe;
          }
          k = j + 1;
        }
        ctx.lineTo(xEnd, Y(lvl));
        if (lvl) highSpans.push(hiStart, xEnd);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "miter";
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.12;
        for (let q = 0; q < highSpans.length; q += 2) ctx.fillRect(highSpans[q], yHi, highSpans[q + 1] - highSpans[q], yLo - yHi);
        ctx.globalAlpha = 0.55;
        for (let q = 0; q < dense.length; q += 2) ctx.fillRect(dense[q], yHi, Math.max(1, dense[q + 1] - dense[q]), yLo - yHi);
        ctx.globalAlpha = 1;

        // ---- annotation lane
        if (r.lane) {
          const list = annByCh.get(r.ch)!;
          const y0 = r.y + ROW_H + 1;
          const h = LANE_H - 5;
          ctx.font = `11px ${col.mono}`;
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          for (const a of list) {
            const ax0 = X(a.start);
            const ax1 = X(a.end + 1);
            if (ax1 < 0 || ax0 > W) continue;
            const w = Math.max(2, ax1 - ax0 - 1);
            const c = a.error ? col.danger : col.info;
            roundRect(ctx, ax0, y0, w, h, 4);
            ctx.fillStyle = c;
            ctx.globalAlpha = 0.16;
            ctx.fill();
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = c;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
            const tw = ctx.measureText(a.label).width;
            if (w > tw + 6) {
              ctx.fillStyle = col.text;
              ctx.fillText(a.label, ax0 + w / 2, y0 + h / 2 + 0.5);
            }
          }
          ctx.textAlign = "start";
        }
      }
    }

    // ---- vertical markers (trigger, A, B, cursor)
    const vline = (sample: number, color: string, dash: number[], label?: string) => {
      const x = Math.round(X(sample)) + 0.5;
      if (x < -1 || x > W + 1) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.restore();
      if (label) {
        rc.font = `600 10.5px ${col.mono}`;
        const tw = rc.measureText(label).width + 8;
        const lx = Math.min(W - tw / 2, Math.max(tw / 2, x));
        rc.fillStyle = color;
        roundRect(rc, lx - tw / 2, RULER_H - 15, tw, 14, 3);
        rc.fill();
        rc.fillStyle = col.surface;
        rc.textBaseline = "middle";
        rc.textAlign = "center";
        rc.fillText(label, lx, RULER_H - 7.5);
        rc.textAlign = "start";
        rc.textBaseline = "top";
      }
    };
    if (capture && capture.triggerIndex !== null) vline(capture.triggerIndex, col.warn, [4, 3], "T");
    if (markers.a !== null && markers.b !== null && N) {
      const xa = X(markers.a);
      const xb = X(markers.b);
      ctx.fillStyle = col.accent;
      ctx.globalAlpha = 0.07;
      ctx.fillRect(Math.min(xa, xb), 0, Math.abs(xb - xa), H);
      ctx.globalAlpha = 1;
    }
    if (markers.a !== null) vline(markers.a, col.accent, [], "A");
    if (markers.b !== null) vline(markers.b, col.ok, [], "B");
    if (cursorX !== null && cursorSample !== null) vline(cursorSample + 0.5, col.muted, [2, 3]);
  }

  // ------------------------------------------------------------- interaction

  let drag = $state<{ x: number; start: number; moved: boolean; id: number } | null>(null);

  function localX(e: MouseEvent) {
    return e.clientX - plot.getBoundingClientRect().left;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    root.focus({ preventScroll: true });
    drag = { x: e.clientX, start: viewStart, moved: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    cursorX = localX(e);
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.moved) viewStart = clampView(drag.start - dx * spp, spp);
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved && N) placeMarker(e.shiftKey ? "b" : "a", sampleAtX(localX(e)));
  }

  function placeMarker(which: "a" | "b", sample: number) {
    const v = Math.min(N - 1, Math.max(0, sample));
    markers = which === "a" ? { a: v, b: markers.b } : { a: markers.a, b: v };
  }

  function onWheel(e: WheelEvent) {
    if (!N) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomAt(Math.pow(1.0018, -e.deltaY), localX(e));
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      rowsEl.scrollTop += e.deltaY || e.deltaX;
      return;
    }
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    viewStart = clampView(viewStart + d * spp, spp);
  }

  function onRulerClick(e: MouseEvent, which: "a" | "b") {
    e.preventDefault();
    if (N) placeMarker(e.shiftKey ? "b" : which, sampleAtX(e.clientX - ruler.getBoundingClientRect().left));
  }

  function onKey(e: KeyboardEvent) {
    if (editing !== null || !N) return;
    const at = cursorSample ?? Math.round(viewStart + (W * spp) / 2);
    switch (e.key) {
      case "ArrowLeft":
        viewStart = clampView(viewStart - W * spp * 0.1, spp);
        break;
      case "ArrowRight":
        viewStart = clampView(viewStart + W * spp * 0.1, spp);
        break;
      case "+":
      case "=":
        zoomAt(1.5, cursorX ?? W / 2);
        break;
      case "-":
        zoomAt(1 / 1.5, cursorX ?? W / 2);
        break;
      case "f":
      case "F":
        fit();
        break;
      case "a":
      case "A":
        placeMarker("a", at);
        break;
      case "b":
      case "B":
        placeMarker("b", at);
        break;
      case "Escape":
        markers = { a: null, b: null };
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function setHidden(ch: number, v: boolean) {
    hidden = hidden.map((h, i) => (i === ch ? v : h));
  }

  function rename(ch: number, v: string) {
    const name = v.trim() || `CH${ch}`;
    names = Array.from({ length: 24 }, (_, i) => (i === ch ? name : (names[i] ?? `CH${i}`)));
    editing = null;
  }

  function focusSelect(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  onMount(() => {
    const ro = new ResizeObserver(() => {
      W = Math.max(50, Math.floor(plotWrap.clientWidth));
      schedule();
    });
    ro.observe(plotWrap);
    const mo = new MutationObserver(() => themeTick++);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onDpr = () => schedule();
    mq.addEventListener?.("change", onDpr);
    return () => {
      ro.disconnect();
      mo.disconnect();
      mq.removeEventListener?.("change", onDpr);
      if (raf) cancelAnimationFrame(raf);
    };
  });

  const dtS = $derived(markers.a !== null && markers.b !== null ? Math.abs(markers.b - markers.a) / rate : null);
  const zoomPct = $derived(N ? (maxSpp / spp) * 100 : 100);
  const hex6 = (v: number) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(6, "0");
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="wf" bind:this={root} tabindex="0" onkeydown={onKey} role="application" aria-label="Logic analyzer waveform">
  <div class="bar">
    <div class="group">
      <button class="btn sm icon ghost" title="Zoom out (-)" onclick={() => zoomAt(1 / 1.5)} disabled={!N}><ZoomOut size={15} /></button>
      <button class="btn sm icon ghost" title="Zoom in (+)" onclick={() => zoomAt(1.5)} disabled={!N || spp <= minSpp}><ZoomIn size={15} /></button>
      <button class="btn sm ghost" title="Fit capture (F)" onclick={fit} disabled={!N}><Maximize2 size={14} /> Fit</button>
      <span class="zoom mono">{zoomPct >= 1000 ? Math.round(zoomPct / 100) / 10 + "k" : Math.round(zoomPct)}%</span>
    </div>
    <div class="group">
      <div class="menu-wrap">
        <button class="btn sm ghost" onclick={() => (showChannelMenu = !showChannelMenu)} aria-expanded={showChannelMenu}>
          <ListFilter size={14} /> Channels
          {#if hiddenCount}<span class="badge warn">{hiddenCount} hidden</span>{/if}
        </button>
        {#if showChannelMenu}
          <div class="menu card" role="menu">
            <div class="menu-head">
              <span class="label">Visible channels</span>
              <button class="btn sm ghost" onclick={() => (hidden = Array(24).fill(false))}>Show all</button>
            </div>
            <div class="menu-grid">
              {#each Array.from({ length: 24 }, (_, i) => i) as ch (ch)}
                <label class="chk" class:off={!((captured >>> ch) & 1)}>
                  <input
                    type="checkbox"
                    checked={!hidden[ch]}
                    disabled={!((captured >>> ch) & 1)}
                    onchange={(e) => setHidden(ch, !(e.currentTarget as HTMLInputElement).checked)}
                  />
                  <span class="mono">{names[ch] ?? `CH${ch}`}</span>
                </label>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      {#if markers.a !== null || markers.b !== null}
        <button class="btn sm ghost" onclick={() => (markers = { a: null, b: null })} title="Clear markers (Esc)"><XIcon size={14} /> Markers</button>
      {/if}
    </div>
  </div>

  <div class="body">
    <div class="ruler-row">
      <div class="corner mono">{capture ? formatHz(capture.sampleRateHz) : ""}</div>
      <div class="ruler-wrap">
        <canvas
          bind:this={ruler}
          onclick={(e) => onRulerClick(e, "a")}
          oncontextmenu={(e) => onRulerClick(e, "b")}
          title="Click: marker A · Right/Shift-click: marker B"
        ></canvas>
      </div>
    </div>
    <div class="rows" bind:this={rowsEl}>
      <div class="labels">
        {#each rows as r (r.ch)}
          <div class="lab" style:height="{r.h}px">
            <span class="sw" style:background="var({CHANNEL_COLORS[r.ch % CHANNEL_COLORS.length]})"></span>
            {#if editing === r.ch}
              <input
                class="input mono rename"
                value={names[r.ch] ?? `CH${r.ch}`}
                use:focusSelect
                onkeydown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") rename(r.ch, e.currentTarget.value);
                  if (e.key === "Escape") editing = null;
                }}
                onblur={(e) => rename(r.ch, e.currentTarget.value)}
              />
            {:else}
              <button class="name mono" title="Double-click to rename (CH{r.ch})" ondblclick={() => (editing = r.ch)}>
                {names[r.ch] ?? `CH${r.ch}`}
                {#if (names[r.ch] ?? `CH${r.ch}`) !== `CH${r.ch}`}<span class="faint">{r.ch}</span>{/if}
              </button>
            {/if}
            <span class="val mono" class:hi={probeValue !== null && (probeValue >>> r.ch) & 1}>
              {probeValue === null ? "" : (probeValue >>> r.ch) & 1}
            </span>
            <button class="btn sm icon ghost hide" title="Hide channel" onclick={() => setHidden(r.ch, true)}><EyeOff size={13} /></button>
          </div>
        {/each}
      </div>
      <div class="plot-wrap" bind:this={plotWrap}>
        <canvas
          bind:this={plot}
          class:grab={!!drag?.moved}
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointerleave={() => (cursorX = null)}
          onwheel={onWheel}
        ></canvas>
        {#if !capture}
          <div class="empty muted">No capture yet</div>
        {:else if !rows.length}
          <div class="empty muted">
            All channels hidden. <button class="btn sm" onclick={() => (hidden = Array(24).fill(false))}><Eye size={13} /> Show all</button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="foot mono">
    {#if capture && cursorSample !== null}
      <span><span class="k">t</span> {formatTime(cursorSample / rate, 5)}</span>
      <span><span class="k">#</span> {cursorSample}</span>
      <span><span class="k">val</span> {hex6(capture.samples[cursorSample])}</span>
    {:else}
      <span class="faint">Drag / wheel: pan · Ctrl+wheel: zoom · Click: A · Shift+click: B · Shift+wheel: scroll rows</span>
    {/if}
    <span class="spacer"></span>
    {#if markers.a !== null}<span class="ma"><span class="k">A</span> {formatTime(markers.a / rate, 5)} <span class="faint">#{markers.a}</span></span>{/if}
    {#if markers.b !== null}<span class="mb"><span class="k">B</span> {formatTime(markers.b / rate, 5)} <span class="faint">#{markers.b}</span></span>{/if}
    {#if dtS !== null}
      <span><span class="k">Δt</span> {formatTime(dtS, 5)}</span>
      <span><span class="k">1/Δt</span> {dtS > 0 ? formatHz(1 / dtS) : "∞"}</span>
    {/if}
  </div>
</div>

<style>
  .wf {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    outline: none;
  }
  .wf:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--raised);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .zoom {
    min-width: 54px;
    text-align: right;
    color: var(--text-muted);
    font-size: 11.5px;
  }
  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
    padding: 10px;
    width: 340px;
    box-shadow: var(--shadow);
  }
  .menu-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .menu-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px 8px;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    padding: 2px 0;
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .chk.off {
    opacity: 0.4;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .ruler-row {
    display: flex;
    flex: none;
    height: 28px;
    border-bottom: 1px solid var(--border);
  }
  .corner {
    width: 150px;
    flex: none;
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: 11px;
    color: var(--text-faint);
    background: var(--raised);
    border-right: 1px solid var(--border);
  }
  .ruler-wrap {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .ruler-wrap canvas {
    display: block;
    cursor: crosshair;
  }
  .rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    align-items: flex-start;
  }
  .labels {
    width: 150px;
    flex: none;
    border-right: 1px solid var(--border);
    background: var(--raised);
  }
  .lab {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 0 4px 0 8px;
    border-bottom: 1px solid var(--border);
  }
  .lab > * {
    margin-top: 6px;
  }
  .sw {
    width: 3px;
    height: 17px;
    border-radius: 2px;
    flex: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 0;
    height: 17px;
    font-size: 12px;
    cursor: default;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name .faint {
    font-size: 10.5px;
    margin-left: 3px;
  }
  .rename {
    flex: 1;
    height: 20px;
    margin-top: 4px;
    padding: 0 5px;
    font-size: 12px;
    width: 0;
  }
  .val {
    width: 10px;
    font-size: 11.5px;
    color: var(--text-faint);
    height: 17px;
    line-height: 17px;
  }
  .val.hi {
    color: var(--text);
  }
  .hide {
    margin-top: 2px !important;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .lab:hover .hide {
    opacity: 1;
  }
  .plot-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
    align-self: stretch;
  }
  .plot-wrap canvas {
    display: block;
    cursor: crosshair;
    touch-action: none;
  }
  .plot-wrap canvas.grab {
    cursor: grabbing;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 120px;
    font-size: 13px;
  }
  .foot {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    background: var(--raised);
    font-size: 11.5px;
    min-height: 30px;
  }
  .foot .k {
    color: var(--text-faint);
    margin-right: 3px;
  }
  .foot .ma .k {
    color: var(--accent);
  }
  .foot .mb .k {
    color: var(--ok);
  }
  .spacer {
    flex: 1;
  }
</style>
