<script lang="ts">
  // Live (or last) results for one registry call: progress + findings.
  import { CircleCheck, CircleAlert, Square, SearchX } from "@lucide/svelte";
  import type { Finding } from "../core/types";
  import type { CallName } from "../scripting/api";
  import { app } from "../stores/app.svelte";
  import FindingCard from "./FindingCard.svelte";
  import { fmtMs } from "./signals";
  import type { Snippet } from "svelte";

  let {
    names,
    empty = "Run it to see results here.",
    actions,
    extra,
  }: { names: CallName[]; empty?: string; actions?: Snippet<[Finding]>; extra?: Snippet<[unknown]> } = $props();

  const live = $derived(app.op && names.includes(app.op.name) ? app.op : null);
  const last = $derived(app.history.find((h) => names.includes(h.name)) ?? null);
  const findings = $derived(live ? [...live.findings.values()] : (last?.findings ?? []));

  let now = $state(Date.now());
  $effect(() => {
    if (!live) return;
    const t = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(t);
  });
</script>

<div class="results">
  {#if live}
    <div class="status running">
      <div class="spinner"></div>
      <div class="grow">
        <div class="title">
          {live.phase === "configuring" ? "Configuring…" : "Scanning…"}
          <span class="faint">{fmtMs(now - live.startedAt)}</span>
          {#if live.permutations}<span class="faint">· {live.permutations.toLocaleString()} permutations</span>{/if}
        </div>
        {#if live.phase === "running"}
          <div class="bar" class:indeterminate={live.progress === null}>
            <div style:width={live.progress === null ? "30%" : `${Math.max(2, live.progress * 100)}%`}></div>
          </div>
        {/if}
      </div>
      <span class="pct mono">{live.progress !== null && live.phase === "running" ? Math.round(live.progress * 100) + "%" : ""}</span>
      <button class="btn danger sm" onclick={() => live?.abort()}><Square size={12} /> Stop</button>
    </div>
  {:else if last}
    <div class="status" class:err={last.status === "error"}>
      {#if last.status === "error"}
        <CircleAlert size={16} />
        <span><b>Failed</b> — {last.error}</span>
      {:else}
        <CircleCheck size={16} />
        <span>
          <b>{last.status === "aborted" ? "Stopped" : "Done"}</b> in {fmtMs(last.durationMs)} ·
          {findings.length} result{findings.length === 1 ? "" : "s"}
        </span>
      {/if}
      <span class="faint when">{new Date(last.startedAt).toLocaleTimeString()}</span>
    </div>
  {/if}

  {#if live?.messages.length}
    {#each live.messages as m, i (i)}
      <div class="msg {m.level}">{m.text}</div>
    {/each}
  {/if}

  {#if findings.length}
    <div class="list">
      {#each findings as f, i (i)}
        <FindingCard finding={f} {actions} />
      {/each}
    </div>
  {:else if !live && last && last.status !== "error"}
    <div class="empty"><SearchX size={18} /> Nothing found. Check wiring, ground, channel range and target voltage.</div>
  {:else if !live && !last}
    <div class="empty faint">{empty}</div>
  {/if}

  {#if extra && last && !live}{@render extra(last.result)}{/if}
</div>

<style>
  .results {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--ok-soft);
    color: var(--ok);
  }
  .status span {
    color: var(--text);
  }
  .status.err {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .status.running {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .when {
    margin-left: auto;
    font-size: 12px;
  }
  .grow {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .title {
    color: var(--text);
    font-weight: 600;
  }
  .pct {
    color: var(--text);
    min-width: 40px;
    text-align: right;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--accent-strong), var(--accent));
    transition: width 0.3s var(--ease);
  }
  .bar.indeterminate div {
    animation: slide 1.2s infinite var(--ease);
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(350%);
    }
  }
  .spinner {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 18px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    color: var(--text-muted);
    justify-content: center;
  }
  .msg {
    font-size: 12.5px;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--overlay);
  }
  .msg.warn {
    color: var(--warn);
  }
  .msg.error {
    color: var(--danger);
  }
</style>
