<script lang="ts">
  import { CircleCheck, CircleDashed, CircleX, Loader, Square } from "@lucide/svelte";
  import type { Finding, PinsLow } from "../../core/types";
  import type { CallName } from "../../scripting/api";
  import { app } from "../../stores/app.svelte";
  import FindingCard from "../FindingCard.svelte";
  import Panel from "../Panel.svelte";
  import PinsLowField from "../PinsLowField.svelte";
  import RangeField from "../RangeField.svelte";
  import RunButton from "../RunButton.svelte";
  import { fmtMs } from "../signals";

  interface Step {
    id: string;
    label: string;
    name: CallName;
    on: boolean;
    args: () => unknown[];
    status: "idle" | "running" | "ok" | "error" | "skipped";
    findings: Finding[];
    ms: number;
    error?: string;
  }

  const t = app.target;
  let start = $state(t.range.start);
  let end = $state(t.range.end);
  let pinsLow = $state<PinsLow | false>(false);
  let txdSeconds = $state(8);
  let running = $state(false);
  let ctl: AbortController | null = null;

  const base = () => ({ start, end, pinsLow: pinsLow || undefined });
  let steps = $state<Step[]>([
    { id: "gpio", label: "Read channel levels", name: "gpio.read", on: true, args: () => [], status: "idle", findings: [], ms: 0 },
    { id: "jtag", label: "JTAG combined scan", name: "jtag.scan", on: true, args: () => [base()], status: "idle", findings: [], ms: 0 },
    { id: "idcode", label: "JTAG IDCODE scan", name: "jtag.idcodeScan", on: false, args: () => [base()], status: "idle", findings: [], ms: 0 },
    { id: "bypass", label: "JTAG BYPASS scan (slow)", name: "jtag.bypassScan", on: false, args: () => [base()], status: "idle", findings: [], ms: 0 },
    { id: "rtck", label: "RTCK scan", name: "jtag.rtckScan", on: false, args: () => [base()], status: "idle", findings: [], ms: 0 },
    { id: "swd", label: "SWD scan", name: "swd.scan", on: true, args: () => [base()], status: "idle", findings: [], ms: 0 },
    {
      id: "txd",
      label: "UART passive TXD scan",
      name: "uart.txdScan",
      on: true,
      args: () => [{ start, end, ignoreNonStandard: true, durationMs: txdSeconds * 1000 }],
      status: "idle",
      findings: [],
      ms: 0,
    },
    { id: "uart", label: "UART active scan", name: "uart.scan", on: true, args: () => [{ ...base(), printableOnly: true }], status: "idle", findings: [], ms: 0 },
  ]);

  const total = $derived(steps.reduce((n, s) => n + s.findings.length, 0));

  async function runAll() {
    running = true;
    ctl = new AbortController();
    for (const s of steps) {
      s.status = s.on ? "idle" : "skipped";
      s.findings = [];
      s.error = undefined;
    }
    for (const s of steps) {
      if (!s.on) continue;
      if (ctl.signal.aborted) {
        s.status = "skipped";
        continue;
      }
      s.status = "running";
      const t0 = Date.now();
      try {
        const r = (await app.call(s.name, s.args(), { signal: ctl.signal })) as { findings?: Finding[] } | undefined;
        s.findings = r?.findings ?? [];
        s.status = "ok";
      } catch (e) {
        s.status = ctl.signal.aborted ? "skipped" : "error";
        s.error = e instanceof Error ? e.message : String(e);
      }
      s.ms = Date.now() - t0;
    }
    running = false;
    app.toast(total ? "ok" : "info", "Scan all finished", `${total} result${total === 1 ? "" : "s"}`);
  }
</script>

<div class="cols">
  <Panel title="Scan everything" subtitle="Runs the selected scans one after another over the same channels. Same as the firmware's “A” command, with control over each step.">
    <RangeField bind:start bind:end min={4} roles={{}} />
    <PinsLowField bind:value={pinsLow} />
    <div class="steps">
      {#each steps as s (s.id)}
        <label class="step" class:off={!s.on}>
          <input type="checkbox" bind:checked={s.on} disabled={running} />
          <span class="st">
            {#if s.status === "running"}<Loader size={15} class="spin" />
            {:else if s.status === "ok"}<CircleCheck size={15} />
            {:else if s.status === "error"}<CircleX size={15} />
            {:else}<CircleDashed size={15} />{/if}
          </span>
          <span class="lbl">{s.label}</span>
          {#if s.id === "txd"}
            <input class="input mono secs" type="number" min="1" bind:value={txdSeconds} disabled={running} /> <span class="faint">s</span>
          {/if}
          <span class="meta">
            {#if s.status === "ok"}{s.findings.length} found · {fmtMs(s.ms)}{:else if s.status === "error"}<span class="err">{s.error}</span>{:else if s.status === "skipped"}skipped{/if}
          </span>
        </label>
      {/each}
    </div>
    {#snippet footer()}
      {#if running}
        <button class="btn danger" onclick={() => (ctl?.abort(), app.stop())}><Square size={13} /> Stop all</button>
        <span class="muted">Running {steps.find((s) => s.status === "running")?.label ?? ""}…</span>
      {:else}
        <RunButton label="Run selected scans" onclick={runAll} disabled={!steps.some((s) => s.on)} />
      {/if}
    {/snippet}
  </Panel>

  <Panel title="Results" badge={String(total)}>
    {#each steps.filter((s) => s.findings.length) as s (s.id)}
      <div class="group">
        <div class="label">{s.label}</div>
        {#each s.findings as f, i (i)}<FindingCard finding={f} />{/each}
      </div>
    {:else}
      <div class="faint empty">Findings from every step collect here.</div>
    {/each}
  </Panel>
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr));
    gap: 14px;
    align-items: start;
  }
  .steps {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .step:last-child {
    border-bottom: none;
  }
  .step.off .lbl {
    color: var(--text-faint);
  }
  .st {
    display: flex;
    color: var(--text-muted);
  }
  .st :global(.spin) {
    animation: spin 1s linear infinite;
    color: var(--accent);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .secs {
    width: 64px;
    height: 26px;
  }
  .meta {
    margin-left: auto;
    font-size: 12px;
    color: var(--text-muted);
  }
  .err {
    color: var(--danger);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty {
    padding: 20px;
    text-align: center;
  }
</style>
