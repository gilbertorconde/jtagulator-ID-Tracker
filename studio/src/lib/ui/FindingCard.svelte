<script lang="ts">
  import { Cpu, Radio, Cable, Zap, Map as MapIcon, ListTree, ArrowRight } from "@lucide/svelte";
  import type { Finding } from "../core/types";
  import CopyButton from "./CopyButton.svelte";
  import IdBits from "./IdBits.svelte";
  import { instructionNames } from "../bsdl/parser";
  import { app } from "../stores/app.svelte";
  import { ROLE_COLOR, ROLE_LABEL, fmtBaud, type Role } from "./signals";

  let { finding, actions }: { finding: Finding; actions?: import("svelte").Snippet<[Finding]> } = $props();

  const pin = (role: Role, v: number | null | undefined) => ({ role, v });
  const pins = $derived.by(() => {
    const f = finding;
    switch (f.kind) {
      case "jtag":
        return [pin("tdi", f.tdi), pin("tdo", f.tdo), pin("tck", f.tck), pin("tms", f.tms), ...f.trst.map((t) => pin("trst", t))];
      case "rtck":
        return [pin("tck", f.tck), pin("rtck", f.rtck)];
      case "swd":
        return [pin("swdio", f.swdio), pin("swclk", f.swclk)];
      case "uart":
        return [pin("txd", f.txd), pin("rxd", f.rxd)];
      case "uart-txd":
        return [pin("txd", f.txd)];
      case "extest":
        return [pin("bsr", f.channel)];
      default:
        return [];
    }
  });
</script>

<div class="finding fade-in">
  <div class="head">
    <div class="icon">
      {#if finding.kind === "jtag"}<Cpu size={16} />
      {:else if finding.kind === "swd"}<Zap size={16} />
      {:else if finding.kind === "uart" || finding.kind === "uart-txd"}<Cable size={16} />
      {:else if finding.kind === "rtck"}<Radio size={16} />
      {:else if finding.kind === "extest"}<MapIcon size={16} />
      {:else}<ListTree size={16} />{/if}
    </div>
    <div class="pins">
      {#each pins as p, i (i)}
        {#if p.v !== null && p.v !== undefined && p.v >= 0}
          <span class="pin" style:--c={ROLE_COLOR[p.role]}><b>{ROLE_LABEL[p.role]}</b> CH{p.v}</span>
        {:else if p.role === "tdi" || p.role === "rxd"}
          <span class="pin unknown" style:--c={ROLE_COLOR[p.role]}><b>{ROLE_LABEL[p.role]}</b> n/a</span>
        {/if}
      {/each}
      {#if finding.kind === "uart"}
        <span class="badge accent">{fmtBaud(finding.baud)} baud</span>
      {:else if finding.kind === "uart-txd"}
        <span class="badge accent">{finding.bestFit ? fmtBaud(finding.bestFit) + " baud" : "non-standard"}</span>
        <span class="badge">measured {finding.measuredBaud.toLocaleString()}</span>
      {:else if finding.kind === "jtag" && finding.deviceCount !== undefined}
        <span class="badge">{finding.deviceCount} device{finding.deviceCount === 1 ? "" : "s"} in chain</span>
      {:else if finding.kind === "extest"}
        <span class="badge accent">BSR bit {finding.bit}</span>
      {:else if finding.kind === "irdr"}
        <span class="mono">IR <b>0x{finding.ir.toString(16).toUpperCase()}</b> <span class="faint">{finding.irBits}</span></span>
        {#if app.activeBsdlFile}
          {@const names = instructionNames(app.activeBsdlFile, finding.ir, finding.irBits.length)}
          {#if names.length}<span class="badge ok">{names.join(" / ")}</span>{/if}
        {/if}
        <ArrowRight size={13} />
        <span class="badge accent">DR {finding.dr} bits</span>
      {/if}
    </div>
    {#if actions}<div class="actions">{@render actions(finding)}</div>{/if}
  </div>

  {#if finding.kind === "jtag" && finding.devices.length}
    <div class="devices">
      {#each finding.devices as d (d.index)}
        <div class="dev">
          <div class="dev-head">
            <span class="faint">#{d.index}</span>
            <span class="idc mono">{d.idcode.hex}</span>
            <CopyButton text={d.idcode.hex} />
            <span class="mf">{d.idcode.manufacturer ?? "Unknown manufacturer"}</span>
            {#if d.idcode.part}<span class="badge info">{d.idcode.part}</span>{/if}
            {#each app.bsdlFor(d.idcode.raw) as b (b.name)}<span class="badge ok" title={b.name}>BSDL: {b.file.entity}</span>{/each}
          </div>
          <div class="meta mono faint">
            part 0x{d.idcode.partNumber.toString(16).toUpperCase().padStart(4, "0")} · ver {d.idcode.version} · JEP106 bank {d.idcode.bank} code 0x{d.idcode.code
              .toString(16)
              .toUpperCase()
              .padStart(2, "0")}
            {#if d.firmwareManufacturer && d.firmwareManufacturer !== d.idcode.manufacturer}· firmware DB: “{d.firmwareManufacturer}”{/if}
          </div>
          <IdBits raw={d.idcode.raw} kind="jtag" />
        </div>
      {/each}
    </div>
  {:else if finding.kind === "swd" && finding.dpidr}
    {@const d = finding.dpidr}
    <div class="devices">
      <div class="dev">
        <div class="dev-head">
          <span class="faint">DPIDR</span>
          <span class="idc mono">{d.hex}</span>
          <CopyButton text={d.hex} />
          <span class="mf">{d.designer ?? "Unknown designer"}</span>
          {#if d.part}<span class="badge info">{d.part}</span>{/if}
        </div>
        <div class="meta mono faint">
          DPv{d.version} · rev {d.revision} · partno 0x{d.partNo.toString(16).toUpperCase().padStart(2, "0")}{d.min ? " · MINDP" : ""}
        </div>
        <IdBits raw={d.raw} kind="swd" />
      </div>
    </div>
  {:else if finding.kind === "uart" && finding.ascii !== undefined}
    <div class="data">
      <div class="mono ascii">{finding.ascii}</div>
      <div class="mono faint hex">{finding.hex?.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}</div>
    </div>
  {/if}
</div>

<style>
  .finding {
    border: 1px solid var(--border);
    background: var(--raised);
    border-radius: var(--radius);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .icon {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
    flex: none;
  }
  .pins {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    flex: 1;
  }
  .pin {
    font: 500 12px var(--font-mono);
    padding: 2px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--c) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
  }
  .pin b {
    color: var(--c);
    margin-right: 2px;
  }
  .pin.unknown {
    opacity: 0.55;
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .devices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dev {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px 10px;
    background: var(--surface);
    border-radius: 8px;
    border: 1px solid var(--border);
  }
  .dev-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .idc {
    font-size: 14px;
    font-weight: 600;
  }
  .mf {
    font-weight: 600;
  }
  .meta {
    font-size: 11px;
  }
  .data {
    padding: 8px 10px;
    background: var(--surface);
    border-radius: 8px;
    border: 1px solid var(--border);
  }
  .ascii {
    white-space: pre-wrap;
  }
  .hex {
    font-size: 11px;
  }
</style>
