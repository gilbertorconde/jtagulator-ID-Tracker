<script lang="ts">
  import { Radio, RefreshCw, Zap } from "@lucide/svelte";
  import { gpioBits, type GpioWriteHandle } from "../../core/jtagulator";
  import { app } from "../../stores/app.svelte";
  import Panel from "../Panel.svelte";
  import PinHeader from "../PinHeader.svelte";
  import RunButton from "../RunButton.svelte";

  let levels = $state<boolean[] | null>(null);
  let value = $state<number | null>(null);
  let monitoring = $state(false);
  let ctl: AbortController | null = null;
  let changes = $state<{ at: number; value: number; diff: number }[]>([]);

  let out = $state(0xffffff);
  let hold = $state<GpioWriteHandle | null>(null);
  const outBits = $derived(gpioBits(out));

  async function read() {
    const r = (await app.run("gpio.read")) as { value: number; bits: boolean[] } | undefined;
    if (r) {
      value = r.value;
      levels = r.bits;
    }
  }

  async function monitor() {
    if (monitoring) return ctl?.abort();
    ctl = new AbortController();
    monitoring = true;
    changes = [];
    try {
      await app.call("gpio.monitor", [{}], { signal: ctl.signal });
    } catch (e) {
      app.error(e);
    } finally {
      monitoring = false;
    }
  }

  // Stream monitor changes straight from the device for a live display.
  $effect(() => {
    const dev = app.dev;
    if (!dev || !monitoring) return;
    const s = dev.session;
    let rest = "";
    return s.rx.on((t) => {
      rest += t;
      const re = /CH23\.\.CH0: [01 ]+\(0x([0-9A-Fa-f]{6})\)/g;
      let m: RegExpExecArray | null;
      let last = 0;
      while ((m = re.exec(rest))) {
        const v = parseInt(m[1], 16);
        const diff = value === null ? 0 : (v ^ value) & 0xffffff;
        value = v;
        levels = gpioBits(v);
        changes = [{ at: Date.now(), value: v, diff }, ...changes].slice(0, 200);
        last = re.lastIndex;
      }
      rest = rest.slice(last);
    });
  });

  async function drive() {
    if (!app.dev) return;
    try {
      hold = await app.dev.gpioWrite(out);
      app.recordLine(`await gpio.pulse(0x${out.toString(16).toUpperCase().padStart(6, "0")}, { holdMs: 1000 });`);
      void hold.released.then(() => (hold = null));
    } catch (e) {
      app.error(e, "Write channels");
    }
  }

  const hex = (v: number) => "0x" + v.toString(16).toUpperCase().padStart(6, "0");
  const toggle = (ch: number) => {
    if (!hold) out = (out ^ (1 << ch)) & 0xffffff;
  };
</script>

<div class="cols">
  <Panel title="Read channels" subtitle="All 24 channels as inputs. Green = high.">
    {#snippet aside()}
      {#if value !== null}<span class="mono val">{hex(value)}</span>{/if}
    {/snippet}
    <PinHeader {levels} names={app.target.channelNames} />
    {#snippet footer()}
      <RunButton label="Read once" onclick={read} disabled={monitoring} />
      <button class="btn" class:primary={monitoring} disabled={app.status !== "connected" || app.voltage === null || (app.busy && !monitoring)} onclick={monitor}>
        <Radio size={14} />
        {monitoring ? "Stop monitoring" : "Monitor changes"}
      </button>
    {/snippet}
  </Panel>

  <Panel title="Drive channels" subtitle="Set all 24 channels as outputs. Click a pin to flip it. Outputs stay driven until released.">
    {#snippet aside()}
      <input
        class="input mono hexin"
        value={hex(out)}
        disabled={!!hold}
        onchange={(e) => {
          const v = parseInt((e.currentTarget as HTMLInputElement).value.replace(/^0x/i, ""), 16);
          if (!Number.isNaN(v)) out = v & 0xffffff;
        }}
      />
    {/snippet}
    <PinHeader levels={outBits} onpin={toggle} names={app.target.channelNames} />
    <div class="quick">
      <button class="btn sm" disabled={!!hold} onclick={() => (out = 0xffffff)}>All high</button>
      <button class="btn sm" disabled={!!hold} onclick={() => (out = 0)}>All low</button>
      <button class="btn sm" disabled={!!hold} onclick={() => (out = ~out & 0xffffff)}>Invert</button>
    </div>
    <div class="warn">Driving pins can fight the target's own outputs. Only drive pins you know are inputs.</div>
    {#snippet footer()}
      {#if hold}
        <span class="badge warn"><Zap size={12} /> Driving {hex(hold.value)}</span>
        <button class="btn danger" onclick={() => hold?.release()}>Release</button>
      {:else}
        <RunButton label="Drive outputs" onclick={drive} />
      {/if}
    {/snippet}
  </Panel>

  {#if changes.length}
    <Panel title="Changes" subtitle="Newest first. Highlighted bits changed.">
      {#snippet aside()}<button class="btn sm ghost" onclick={() => (changes = [])}><RefreshCw size={12} /> Clear</button>{/snippet}
      <div class="changes mono">
        {#each changes as c, i (c.at + ":" + i)}
          <div class="chg">
            <span class="faint">{new Date(c.at).toLocaleTimeString()}</span>
            <span>
              {#each Array.from({ length: 24 }, (_, k) => 23 - k) as b (b)}
                <span class:on={((c.value >>> b) & 1) === 1} class:diff={((c.diff >>> b) & 1) === 1}>{(c.value >>> b) & 1}</span>{#if b % 8 === 0 && b}&nbsp;{/if}
              {/each}
            </span>
            <span>{hex(c.value)}</span>
          </div>
        {/each}
      </div>
    </Panel>
  {/if}
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(520px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .val {
    font-size: 15px;
    font-weight: 600;
  }
  .hexin {
    width: 110px;
  }
  .quick {
    display: flex;
    gap: 6px;
  }
  .warn {
    font-size: 12px;
    color: var(--warn);
  }
  .changes {
    max-height: 320px;
    overflow: auto;
    font-size: 12px;
  }
  .chg {
    display: flex;
    gap: 14px;
    padding: 2px 0;
  }
  .chg .on {
    color: var(--ok);
  }
  .chg .diff {
    background: var(--warn-soft);
    color: var(--warn);
    border-radius: 2px;
  }
</style>
