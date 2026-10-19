<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    Play,
    Square,
    Activity,
    Download,
    LogIn,
    LogOut,
    TriangleAlert,
    Radio,
    Trash2,
    Plus,
    History,
    Gauge,
    RefreshCw,
    Crosshair,
    Binary,
  } from "@lucide/svelte";
  import type { JTAGulator } from "../../core/jtagulator";
  import { AbortedError, type Session } from "../../core/session";
  import type { DeviceMode } from "../../core/types";
  import {
    SAMPLE_RATES,
    SUMP_LIMITS,
    SumpClient,
    captureDurationMs,
    clampSamples,
    planSampleRate,
    transferDurationMs,
    type Capture,
  } from "../../logic/sump";
  import {
    UART_MIN_SAMPLES_PER_BIT,
    byteLabel,
    decodeUart,
    formatHz,
    formatTime,
    framesToText,
    measureAll,
    type UartFrame,
  } from "../../logic/decode";
  import { captureFileName, downloadText, toCSV, toVCD } from "../../logic/export";
  import Waveform, { defaultNames, type WaveAnnotation, type WaveMarkers } from "./Waveform.svelte";

  let {
    dev,
    session,
    onError,
    fullTriggers = false,
  }: { dev: JTAGulator; session: Session; onError?: (e: unknown) => void; fullTriggers?: boolean } = $props();

  const sump = $derived(new SumpClient(session, { fullTriggers }));

  // ------------------------------------------------------------------ mode
  let mode = $state<DeviceMode>("unknown");
  let modeBusy = $state(false);
  let deviceInfo = $state<{ id: string; meta: Record<string, string | number> } | null>(null);

  $effect(() => {
    mode = dev.mode;
    const onMode = (e: Event) => (mode = (e as CustomEvent<DeviceMode>).detail);
    dev.events.addEventListener("mode", onMode);
    return () => dev.events.removeEventListener("mode", onMode);
  });

  // Identify the analyzer once we're in SUMP mode.
  $effect(() => {
    if (mode !== "sump") {
      deviceInfo = null;
      return;
    }
    if (deviceInfo) return;
    const client = sump;
    (async () => {
      try {
        const id = await client.identify();
        const meta = await client.metadata().catch(() => ({}));
        deviceInfo = { id, meta };
      } catch {
        /* shown via capture errors if the link is really broken */
      }
    })();
  });

  let error = $state<string | null>(null);
  function fail(e: unknown) {
    if (e instanceof AbortedError) return;
    error = e instanceof Error ? e.message : String(e);
    onError?.(e);
  }

  async function enter() {
    modeBusy = true;
    error = null;
    try {
      await dev.enterLogicAnalyzer();
    } catch (e) {
      fail(e);
    } finally {
      modeBusy = false;
    }
  }

  async function exit() {
    modeBusy = true;
    error = null;
    stopLive();
    abort();
    try {
      await dev.exitSpecialMode();
    } catch (e) {
      fail(e);
    } finally {
      modeBusy = false;
    }
  }

  // -------------------------------------------------------------- settings
  let rateHz = $state(1_000_000);
  let samplesN = $state(1024);
  let groups = $state([true, true, true]);
  let trigOn = $state(false);
  /** Per trigger channel: null = don't care, 0 / 1 = level. */
  let trig = $state<(0 | 1 | null)[]>(Array(24).fill(null));
  const trigChannels = $derived(fullTriggers ? 24 : 8);

  const plan = $derived(planSampleRate(rateHz));
  const nClamped = $derived(clampSamples(samplesN));
  const groupMask = $derived(groups.reduce((m, g, i) => m | (g ? 1 << i : 0), 0));
  const windowMs = $derived(captureDurationMs(rateHz, nClamped));
  const xferMs = $derived(transferDurationMs(nClamped, groupMask));
  const trigger = $derived.by(() => {
    if (!trigOn) return undefined;
    let mask = 0;
    let value = 0;
    trig.forEach((t, i) => {
      if (t === null || i >= trigChannels) return;
      mask |= 1 << i;
      if (t) value |= 1 << i;
    });
    return mask ? { mask, value } : undefined;
  });

  function cycleTrig(i: number) {
    const cur = trig[i];
    trig[i] = cur === null ? 1 : cur === 1 ? 0 : null;
  }


  // --------------------------------------------------------------- capture
  let capturing = $state(false);
  let progress = $state(0);
  let ctl: AbortController | null = null;
  let history = $state.raw<Capture[]>([]);
  let current = $state.raw<Capture | null>(null);
  let names = $state<string[]>(defaultNames());
  let hidden = $state<boolean[]>(Array(24).fill(false));
  let markers = $state<WaveMarkers>({ a: null, b: null });
  let wave = $state<ReturnType<typeof Waveform>>();

  async function capture() {
    if (capturing || !groupMask) return;
    error = null;
    capturing = true;
    progress = 0;
    ctl = new AbortController();
    const wasLive = live;
    stopLive();
    try {
      const channels = [0, 1, 2].filter((g) => groups[g]).map((g) => g * 8);
      const cap = await sump.capture({
        sampleRateHz: rateHz,
        samples: nClamped,
        channels,
        trigger,
        signal: ctl.signal,
        onProgress: (f) => (progress = f),
      });
      history = [cap, ...history].slice(0, 5);
      current = cap;
      markers = { a: null, b: null };
    } catch (e) {
      fail(e);
    } finally {
      capturing = false;
      ctl = null;
      if (wasLive) startLive();
    }
  }

  function abort() {
    ctl?.abort();
  }

  // ------------------------------------------------------------- snapshot
  let snapValue = $state<number | null>(null);
  let snapAt = $state<number | null>(null);
  let live = $state(false);
  let liveTimer: ReturnType<typeof setTimeout> | null = null;
  let snapping = false;

  async function snapshot() {
    if (snapping) return;
    snapping = true;
    try {
      snapValue = await sump.snapshot();
      snapAt = Date.now();
    } catch (e) {
      stopLive();
      fail(e);
    } finally {
      snapping = false;
    }
  }

  function startLive() {
    live = true;
    const tick = async () => {
      if (!live) return;
      if (!capturing && mode === "sump") await snapshot();
      if (live) liveTimer = setTimeout(tick, 300);
    };
    void tick();
  }

  function stopLive() {
    live = false;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = null;
  }

  onDestroy(() => {
    stopLive();
    ctl?.abort();
  });

  $effect(() => {
    if (mode !== "sump") stopLive();
  });

  // ------------------------------------------------------------- decoders
  interface UartDecoder {
    id: number;
    channel: number;
    baud: number;
    invert: boolean;
  }
  const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400];
  let decoders = $state<UartDecoder[]>([]);
  let newCh = $state(0);
  let newBaud = $state(9600);
  let newInvert = $state(false);
  let nextId = 1;
  let view = $state<"text" | "hex">("text");
  let tab = $state<"decoders" | "measure" | "history">("decoders");

  function addDecoder() {
    decoders = [...decoders, { id: nextId++, channel: newCh, baud: Math.max(1, Math.round(newBaud)), invert: newInvert }];
    tab = "decoders";
  }

  function removeDecoder(id: number) {
    decoders = decoders.filter((d) => d.id !== id);
  }

  const decoded = $derived(
    decoders.map((d) => {
      const cap = current;
      if (!cap) return { d, frames: [] as UartFrame[], spb: 0, captured: true };
      const captured = !!((cap.channelMask >>> d.channel) & 1);
      const spb = cap.sampleRateHz / d.baud;
      const frames = captured ? decodeUart(cap, { channel: d.channel, baud: d.baud, invert: d.invert }) : [];
      return { d, frames, spb, captured };
    }),
  );

  const annotations = $derived<WaveAnnotation[]>(
    decoded.flatMap(({ d, frames }) =>
      frames.map((f) => ({
        channel: d.channel,
        start: f.startSample,
        end: f.endSample,
        label: byteLabel(f.byte),
        title: `0x${f.byte.toString(16).padStart(2, "0")}`,
        error: f.framingError,
      })),
    ),
  );

  // ---------------------------------------------------------- measurements
  const measurements = $derived(current ? measureAll(current) : []);

  // ---------------------------------------------------------------- export
  function exportAs(kind: "vcd" | "csv") {
    if (!current) return;
    const base = captureFileName(current);
    const visible = Array.from({ length: 24 }, (_, i) => i).filter((c) => (current!.channelMask >>> c) & 1);
    if (kind === "vcd") downloadText(`${base}.vcd`, toVCD(current, { names, channels: visible }), "text/x-vcd");
    else downloadText(`${base}.csv`, toCSV(current, { names, channels: visible }), "text/csv");
  }

  const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, "0");
  const groupLabel = (cap: Capture) =>
    [0, 1, 2]
      .filter((g) => (cap.channelMask >>> (g * 8)) & 0xff)
      .map((g) => `${g * 8}-${g * 8 + 7}`)
      .join(", ");
  const clock = (t: number) => new Date(t).toLocaleTimeString();
  const capturedChannels = $derived(
    Array.from({ length: 24 }, (_, i) => i).filter((c) => (current ? (current.channelMask >>> c) & 1 : groups[c >> 3])),
  );
</script>

<div class="la">
  <!-- ------------------------------------------------------------ mode banner -->
  {#if mode !== "sump"}
    <div class="banner warn card fade-in">
      <div class="ico"><TriangleAlert size={18} /></div>
      <div class="msg">
        <strong>Logic analyzer mode is off.</strong>
        <span class="muted">
          Captures need the JTAGulator in its OLS/SUMP mode. The firmware remembers this mode in EEPROM, so it
          <em>persists across resets and power cycles</em> and the text menu is unavailable until you exit it (Ctrl-X).
          A target voltage must be set first.
        </span>
      </div>
      <button class="btn primary" onclick={enter} disabled={modeBusy || !session.open}>
        <LogIn size={15} />
        {modeBusy ? "Entering…" : "Enter logic analyzer mode"}
      </button>
    </div>
  {:else}
    <div class="banner ok card fade-in">
      <div class="ico"><Activity size={18} /></div>
      <div class="msg">
        <strong>Logic analyzer mode</strong>
        <span class="muted">
          {#if deviceInfo}
            {deviceInfo.meta.deviceName ?? "SUMP device"} · ID <span class="mono">{deviceInfo.id}</span>
            {#if deviceInfo.meta.numProbes}· {deviceInfo.meta.numProbes} probes{/if}
            · up to {formatHz(SUMP_LIMITS.maxSampleRateHz, 3)}, {SUMP_LIMITS.maxSamples} samples. Persists across resets until you exit.
          {:else}
            Speaking SUMP at 115200 baud. Persists across resets until you exit.
          {/if}
        </span>
      </div>
      <button class="btn" onclick={exit} disabled={modeBusy}>
        <LogOut size={15} />
        {modeBusy ? "Exiting…" : "Exit to menu"}
      </button>
    </div>
  {/if}

  {#if error}
    <div class="banner danger card">
      <div class="ico"><TriangleAlert size={18} /></div>
      <div class="msg"><span>{error}</span></div>
      <button class="btn sm ghost" onclick={() => (error = null)}>Dismiss</button>
    </div>
  {/if}

  <div class="main">
    <!-- -------------------------------------------------------------- controls -->
    <aside class="side">
      <section class="card sec">
        <div class="sec-head"><span class="label">Capture</span><Gauge size={14} class="faint" /></div>

        <label class="field">
          <span class="label sub">Sample rate</span>
          <select class="input" bind:value={rateHz}>
            {#each SAMPLE_RATES as r (r)}
              <option value={r}>{formatHz(r, 3)}</option>
            {/each}
          </select>
          <span class="hint">
            Actual {formatHz(plan.actualHz, 5)} (80 MHz / {plan.clocksWait})
          </span>
        </label>

        <label class="field">
          <span class="label sub">Samples</span>
          <div class="row">
            <input
              class="input mono"
              type="number"
              min={SUMP_LIMITS.minSamples}
              max={SUMP_LIMITS.maxSamples}
              step={SUMP_LIMITS.sampleStep}
              bind:value={samplesN}
              onblur={() => (samplesN = nClamped)}
            />
            <button class="btn sm ghost" onclick={() => (samplesN = SUMP_LIMITS.maxSamples)}>Max</button>
          </div>
          <span class="hint">
            {nClamped} samples = {formatTime(windowMs / 1000)} window · ~{formatTime(xferMs / 1000, 2)} transfer
          </span>
        </label>

        <div class="field">
          <span class="label sub">Channel groups</span>
          <div class="chips">
            {#each [0, 1, 2] as g (g)}
              <button class="chip" class:on={groups[g]} onclick={() => (groups[g] = !groups[g])} aria-pressed={groups[g]}>
                CH{g * 8}–{g * 8 + 7}
              </button>
            {/each}
          </div>
          <span class="hint">{groupMask ? "Fewer groups = faster transfer." : "Enable at least one group."}</span>
        </div>
      </section>

      <section class="card sec">
        <div class="sec-head">
          <span class="label">Trigger</span>
          <label class="switch">
            <input type="checkbox" bind:checked={trigOn} />
            <span>{trigOn ? "On" : "Off"}</span>
          </label>
        </div>
        <div class="trig" class:disabled={!trigOn}>
          {#each trig.slice(0, trigChannels) as t, i (i)}
            <button
              class="cell mono"
              class:one={t === 1}
              class:zero={t === 0}
              disabled={!trigOn}
              onclick={() => cycleTrig(i)}
              title="{names[i]}: {t === null ? "don't care" : t ? "high" : "low"} (click to cycle)"
            >
              <span class="n">{i}</span>
              <span class="v">{t === null ? "X" : t}</span>
            </button>
          {/each}
        </div>
        <span class="hint">
          Level trigger; capture starts at the trigger (no pre-trigger).
          {#if !fullTriggers}This firmware only honours CH0–7 in triggers; ID Tracker 1.3 can trigger on all 24.{/if}
          {#if trigOn && !trigger}<br /><span class="warn-t">Set at least one channel to 0 or 1.</span>{/if}
        </span>
      </section>

      <div class="actions">
        {#if capturing}
          <button class="btn danger grow" onclick={abort}><Square size={14} /> Abort</button>
        {:else}
          <button class="btn primary grow" onclick={capture} disabled={mode !== "sump" || !groupMask}>
            <Play size={14} /> Capture
          </button>
        {/if}
      </div>
      {#if capturing}
        <div class="progress">
          <div class="bar" style:width="{Math.round(progress * 100)}%"></div>
        </div>
        <span class="hint">
          {progress > 0 ? `Receiving… ${Math.round(progress * 100)}%` : trigger ? "Waiting for trigger…" : "Sampling…"}
        </span>
      {/if}

      <section class="card sec">
        <div class="sec-head">
          <span class="label">Live inputs</span>
          <div class="row tight">
            <button class="btn sm ghost icon" title="Read once" onclick={snapshot} disabled={mode !== "sump" || capturing}>
              <RefreshCw size={13} />
            </button>
            <label class="switch">
              <input
                type="checkbox"
                checked={live}
                disabled={mode !== "sump"}
                onchange={(e) => ((e.currentTarget as HTMLInputElement).checked ? startLive() : stopLive())}
              />
              <span>Live</span>
            </label>
          </div>
        </div>
        <div class="leds">
          {#each Array.from({ length: 24 }, (_, i) => i) as ch (ch)}
            <div class="led" class:hi={snapValue !== null && (snapValue >>> ch) & 1} class:unk={snapValue === null} title={names[ch]}>
              <span class="dot"></span>
              <span class="n mono">{ch}</span>
            </div>
          {/each}
        </div>
        <span class="hint">
          {#if snapValue !== null}
            <span class="mono">0x{snapValue.toString(16).toUpperCase().padStart(6, "0")}</span> · {snapAt ? clock(snapAt) : ""}
          {:else}
            SUMP input snapshot (0x06).
          {/if}
        </span>
      </section>
    </aside>

    <!-- ----------------------------------------------------------- waveform + panels -->
    <div class="content">
      <div class="wave-head">
        <div class="title">
          <h3>Waveform</h3>
          {#if current}
            <span class="badge">{current.samples.length} samples</span>
            <span class="badge">{formatHz(current.sampleRateHz, 4)}</span>
            <span class="badge">{formatTime(current.samples.length / current.sampleRateHz)}</span>
            {#if current.triggerIndex !== null}<span class="badge warn">Triggered</span>{/if}
          {/if}
        </div>
        <div class="row tight">
          <button class="btn sm" onclick={() => exportAs("vcd")} disabled={!current}><Download size={13} /> VCD</button>
          <button class="btn sm" onclick={() => exportAs("csv")} disabled={!current}><Download size={13} /> CSV</button>
        </div>
      </div>
      <div class="wave">
        <Waveform bind:this={wave} capture={current} bind:names bind:hidden bind:markers {annotations} />
      </div>

      <div class="card panel">
        <div class="tabs">
          <button class:active={tab === "decoders"} onclick={() => (tab = "decoders")}>
            <Binary size={14} /> Decoders {#if decoders.length}<span class="badge">{decoders.length}</span>{/if}
          </button>
          <button class:active={tab === "measure"} onclick={() => (tab = "measure")}><Crosshair size={14} /> Measurements</button>
          <button class:active={tab === "history"} onclick={() => (tab = "history")}>
            <History size={14} /> History {#if history.length}<span class="badge">{history.length}</span>{/if}
          </button>
        </div>

        <div class="tab-body">
          {#if tab === "decoders"}
            <div class="add">
              <span class="label sub">UART (8N1)</span>
              <select class="input mono" bind:value={newCh} title="Channel">
                {#each capturedChannels as ch (ch)}
                  <option value={ch}>{names[ch]}{names[ch] !== `CH${ch}` ? ` (CH${ch})` : ""}</option>
                {/each}
              </select>
              <span class="muted">@</span>
              <input class="input mono baud" type="number" min="1" list="la-bauds" bind:value={newBaud} title="Baud rate" />
              <datalist id="la-bauds">
                {#each BAUDS as b (b)}<option value={b}></option>{/each}
              </datalist>
              <span class="muted">baud</span>
              <label class="switch"><input type="checkbox" bind:checked={newInvert} /><span>Inverted</span></label>
              <button class="btn sm primary" onclick={addDecoder}><Plus size={13} /> Add decoder</button>
            </div>

            {#if !decoders.length}
              <p class="muted empty">
                Add a UART decoder to annotate a channel with decoded bytes. Aim for at least
                {UART_MIN_SAMPLES_PER_BIT * 4}× the baud rate as sample rate (e.g. 9600 baud → ≥ 100 kHz).
              </p>
            {:else}
              <div class="dec-list">
                {#each decoded as { d, frames, spb, captured } (d.id)}
                  <div class="dec">
                    <div class="dec-head">
                      <Radio size={14} class="faint" />
                      <strong class="mono">{names[d.channel]}</strong>
                      <span class="badge info">UART {d.baud} 8N1{d.invert ? " inv" : ""}</span>
                      {#if current}
                        <span class="badge">{frames.length} bytes</span>
                        {#if frames.some((f) => f.framingError)}<span class="badge danger">framing errors</span>{/if}
                      {/if}
                      <span class="spacer"></span>
                      <div class="seg">
                        <button class:active={view === "text"} onclick={() => (view = "text")}>Text</button>
                        <button class:active={view === "hex"} onclick={() => (view = "hex")}>Hex</button>
                      </div>
                      <button class="btn sm icon ghost" title="Remove decoder" onclick={() => removeDecoder(d.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {#if !current}
                      <p class="muted small">Capture to decode.</p>
                    {:else if !captured}
                      <p class="warn-t small">CH{d.channel} was not captured (its group was disabled).</p>
                    {:else if spb < UART_MIN_SAMPLES_PER_BIT}
                      <p class="warn-t small">
                        Sample rate too low: {spb.toFixed(1)} samples per bit. Use at least {formatHz(d.baud * 4, 3)}.
                      </p>
                    {:else if !frames.length}
                      <p class="muted small">No frames found on this channel.</p>
                    {:else if view === "text"}
                      <pre class="text mono">{framesToText(frames)}</pre>
                    {:else}
                      <div class="frames">
                        {#each frames as f, i (i)}
                          <button
                            class="frame mono"
                            class:err={f.framingError}
                            title="{formatTime(f.startSample / current.sampleRateHz, 5)} · #{f.startSample}{f.framingError
                              ? ' · framing error'
                              : ''}"
                            onclick={() => {
                              wave?.centerOn((f.startSample + f.endSample) / 2);
                              markers = { a: f.startSample, b: f.endSample + 1 };
                            }}
                          >
                            <span class="h">{hex2(f.byte)}</span>
                            <span class="c">{byteLabel(f.byte)}</span>
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {:else if tab === "measure"}
            {#if !current}
              <p class="muted empty">Capture to measure edges, frequency and duty cycle.</p>
            {:else}
              <div class="scroll">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th class="r">Rising</th>
                      <th class="r">Falling</th>
                      <th class="r">Frequency</th>
                      <th class="r">Period</th>
                      <th class="r">Duty</th>
                      <th class="r">Min pulse</th>
                      <th class="r">High</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each measurements as m (m.channel)}
                      <tr class:quiet={m.constant !== null}>
                        <td class="mono">{names[m.channel]}</td>
                        {#if m.constant !== null}
                          <td colspan="7" class="muted">constant {m.constant ? "high" : "low"}</td>
                        {:else}
                          <td class="r mono">{m.rising}</td>
                          <td class="r mono">{m.falling}</td>
                          <td class="r mono">{m.frequencyHz ? formatHz(m.frequencyHz) : "—"}</td>
                          <td class="r mono">{m.periodS ? formatTime(m.periodS, 4) : "—"}</td>
                          <td class="r mono">{m.duty !== null ? (m.duty * 100).toFixed(1) + " %" : "—"}</td>
                          <td class="r mono">{m.minPulseS ? formatTime(m.minPulseS, 4) : "—"}</td>
                          <td class="r mono">{(m.highRatio * 100).toFixed(1)} %</td>
                        {/if}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          {:else if !history.length}
            <p class="muted empty">The last 5 captures are kept here.</p>
          {:else}
            <div class="scroll">
              <table class="data hist">
                <thead>
                  <tr><th>Time</th><th>Rate</th><th>Samples</th><th>Groups</th><th>Trigger</th><th></th></tr>
                </thead>
                <tbody>
                  {#each history as h, i (h.capturedAt + ":" + i)}
                    <tr class:cur={h === current} onclick={() => ((current = h), (markers = { a: null, b: null }))}>
                      <td class="mono">{clock(h.capturedAt)}</td>
                      <td class="mono">{formatHz(h.sampleRateHz, 4)}</td>
                      <td class="mono">{h.samples.length}</td>
                      <td class="mono">{groupLabel(h)}</td>
                      <td>{h.triggerIndex !== null ? "yes" : "—"}</td>
                      <td class="r">
                        {#if h === current}<span class="badge accent">viewing</span>{/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .la {
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
    min-height: 0;
    padding: 16px;
    overflow: auto;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
  }
  .banner .ico {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius);
    flex: none;
  }
  .banner.warn {
    border-color: color-mix(in srgb, var(--warn) 35%, var(--border));
  }
  .banner.warn .ico {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .banner.ok .ico {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .banner.danger {
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
  }
  .banner.danger .ico {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .msg {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }
  .main {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 290px minmax(0, 1fr);
    gap: 12px;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow-y: auto;
  }
  .sec {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .label.sub {
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .hint {
    font-size: 11.5px;
    color: var(--text-faint);
    line-height: 1.45;
  }
  .warn-t {
    color: var(--warn);
  }
  .row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .row .input {
    flex: 1;
  }
  .row.tight {
    gap: 4px;
  }
  .chips {
    display: flex;
    gap: 6px;
  }
  .chip {
    flex: 1;
    height: 30px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text-muted);
    font: 500 12px var(--font-mono);
    cursor: pointer;
    transition: all 0.15s var(--ease);
  }
  .chip.on {
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    color: var(--accent);
  }
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .switch input {
    accent-color: var(--accent-strong);
  }
  .trig {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }
  .trig.disabled {
    opacity: 0.5;
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 4px 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    color: var(--text-faint);
    cursor: pointer;
  }
  .cell:disabled {
    cursor: not-allowed;
  }
  .cell .n {
    font-size: 9.5px;
  }
  .cell .v {
    font-size: 13px;
    font-weight: 600;
  }
  .cell.one {
    background: var(--ok-soft);
    border-color: color-mix(in srgb, var(--ok) 50%, transparent);
    color: var(--ok);
  }
  .cell.zero {
    background: var(--info-soft);
    border-color: color-mix(in srgb, var(--info) 50%, transparent);
    color: var(--info);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .grow {
    flex: 1;
    height: 36px;
  }
  .progress {
    height: 4px;
    border-radius: 4px;
    background: var(--overlay);
    overflow: hidden;
  }
  .progress .bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s;
  }
  .leds {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 6px 4px;
  }
  .led {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .led .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--overlay);
    border: 1px solid var(--border-strong);
    transition: all 0.15s;
  }
  .led.hi .dot {
    background: var(--ok);
    border-color: var(--ok);
    box-shadow: 0 0 8px color-mix(in srgb, var(--ok) 60%, transparent);
  }
  .led.unk .dot {
    opacity: 0.5;
  }
  .led .n {
    font-size: 9.5px;
    color: var(--text-faint);
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    min-width: 0;
  }
  .wave-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .title h3 {
    font-size: 14px;
    margin-right: 4px;
  }
  .wave {
    flex: 3 1 360px;
    min-height: 300px;
  }
  .panel {
    flex: 2 1 220px;
    min-height: 200px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 6px 6px 0;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-muted);
    font: 500 12.5px var(--font-sans);
    cursor: pointer;
  }
  .tabs button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .tab-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px;
  }
  .add {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding-bottom: 12px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .add select {
    min-width: 110px;
  }
  .add .baud {
    width: 100px;
  }
  .empty {
    margin: 4px 0;
    font-size: 13px;
  }
  .small {
    margin: 6px 0 0;
    font-size: 12.5px;
  }
  .dec-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dec {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px;
    background: var(--raised);
  }
  .dec-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg button {
    border: none;
    background: none;
    color: var(--text-muted);
    padding: 3px 9px;
    font: 500 11.5px var(--font-sans);
    cursor: pointer;
  }
  .seg button.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .text {
    margin: 8px 0 0;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 160px;
    overflow: auto;
    font-size: 12px;
  }
  .frames {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
    max-height: 160px;
    overflow: auto;
  }
  .frame {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 34px;
    padding: 3px 4px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }
  .frame:hover {
    border-color: var(--info);
  }
  .frame .c {
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .frame.err {
    border-color: color-mix(in srgb, var(--danger) 60%, transparent);
    color: var(--danger);
  }
  .scroll {
    overflow: auto;
  }
  .r {
    text-align: right !important;
  }
  tr.quiet td {
    color: var(--text-faint);
  }
  table.hist tbody tr {
    cursor: pointer;
  }
  table.hist tbody tr:hover td {
    background: var(--raised);
  }
  table.hist tr.cur td {
    background: var(--accent-soft);
  }
  @media (max-width: 960px) {
    .main {
      grid-template-columns: 1fr;
    }
  }
</style>
