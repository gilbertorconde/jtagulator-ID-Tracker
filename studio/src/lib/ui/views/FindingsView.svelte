<script lang="ts">
  import { Download, FileJson, FilePlus2, Trash2, Upload } from "@lucide/svelte";
  import { openText, saveTextAs } from "../../files";
  import { markdownReport } from "../../report";
  import { app, type TargetProfile } from "../../stores/app.svelte";
  import FindingCard from "../FindingCard.svelte";
  import Panel from "../Panel.svelte";
  import PinHeader from "../PinHeader.svelte";
  import { pinMap } from "../signals";

  const t = $derived(app.target);
  const roles = $derived(
    pinMap([
      ["tdi", t.jtag.tdi],
      ["tdo", t.jtag.tdo],
      ["tck", t.jtag.tck],
      ["tms", t.jtag.tms],
      ["trst", t.jtag.trst],
      ["rtck", t.jtag.rtck],
      ["swdio", t.swd.swdio],
      ["swclk", t.swd.swclk],
      ["txd", t.uart.txd],
      ["rxd", t.uart.rxd],
    ]),
  );
  let filter = $state<string>("all");
  const kinds = $derived([...new Set(t.findings.map((f) => f.finding.kind))]);
  const shown = $derived(filter === "all" ? t.findings : t.findings.filter((f) => f.finding.kind === filter));
  let editing = $state<number | null>(null);

  const slug = () => t.name.replace(/[^\w-]+/g, "_").toLowerCase() || "target";

  async function exportJson() {
    await saveTextAs(`${slug()}.jtarget.json`, JSON.stringify(t, null, 2), "json").catch((e) => app.error(e, "Export"));
  }
  async function exportMd() {
    await saveTextAs(`${slug()}-report.md`, markdownReport(t), "md").catch((e) => app.error(e, "Export"));
  }
  async function importJson() {
    try {
      const text = await openText("json");
      if (!text) return;
      const data = JSON.parse(text) as TargetProfile;
      if (!data.jtag || !Array.isArray(data.findings)) throw new Error("Not a JTAGulator Studio target file");
      app.target = data;
      app.toast("ok", "Target loaded", data.name);
    } catch (e) {
      app.error(e, "Import");
    }
  }
  async function newTarget() {
    if (t.findings.length && !(await app.ask("New target", "Start a new target? Export this one first if you want to keep it.", "Start new", true))) return;
    app.newTarget();
  }
</script>

<div class="cols">
  <Panel title="Target" subtitle="Everything learned about the board under test. Saved automatically.">
    {#snippet aside()}
      <button class="btn sm" onclick={newTarget}><FilePlus2 size={13} /> New</button>
      <button class="btn sm" onclick={importJson}><Upload size={13} /> Open</button>
      <button class="btn sm" onclick={exportJson}><FileJson size={13} /> Save</button>
      <button class="btn sm primary" onclick={exportMd}><Download size={13} /> Report</button>
    {/snippet}
    <input class="input title" bind:value={app.target.name} />
    <textarea class="input" rows="3" placeholder="Notes: board, test points, what you tried…" bind:value={app.target.notes}></textarea>
    <PinHeader {roles} names={t.channelNames} onpin={(ch) => (editing = ch)} />
    {#if editing !== null}
      <div class="rename">
        <span class="mono">CH{editing}</span>
        <input
          class="input"
          placeholder="Label, e.g. TP12 or J3 pin 4"
          value={t.channelNames[editing] ?? ""}
          oninput={(e) => (app.target.channelNames = { ...t.channelNames, [editing!]: (e.currentTarget as HTMLInputElement).value })}
        />
        <button class="btn sm" onclick={() => (editing = null)}>Done</button>
      </div>
    {:else}
      <div class="faint small">Click a channel to label it with where it's wired on the board.</div>
    {/if}
    <table class="data">
      <tbody>
        <tr><td class="muted">Voltage</td><td class="mono">{t.voltage ?? "—"} V</td></tr>
        <tr><td class="muted">JTAG</td><td class="mono">TDI {t.jtag.tdi ?? "—"} · TDO {t.jtag.tdo ?? "—"} · TCK {t.jtag.tck ?? "—"} · TMS {t.jtag.tms ?? "—"} · TRST# {t.jtag.trst ?? "—"} · RTCK {t.jtag.rtck ?? "—"}</td></tr>
        <tr><td class="muted">SWD</td><td class="mono">SWDIO {t.swd.swdio ?? "—"} · SWCLK {t.swd.swclk ?? "—"}</td></tr>
        <tr><td class="muted">UART</td><td class="mono">TXD {t.uart.txd ?? "—"} · RXD {t.uart.rxd ?? "—"} · {t.uart.baud ?? "—"} baud</td></tr>
      </tbody>
    </table>
  </Panel>

  <Panel title="Findings" badge={String(t.findings.length)}>
    {#snippet aside()}
      <select class="input" bind:value={filter}>
        <option value="all">All kinds</option>
        {#each kinds as k (k)}<option value={k}>{k}</option>{/each}
      </select>
      <button class="btn sm ghost" disabled={!t.findings.length} onclick={async () => (await app.ask("Clear findings", "Remove every finding from this target?", "Clear", true)) && (app.target.findings = [])}>
        <Trash2 size={13} />
      </button>
    {/snippet}
    {#each shown as f (f.at + JSON.stringify(f.finding))}
      <div class="when faint">{new Date(f.at).toLocaleString()} · {f.op}</div>
      <FindingCard finding={f.finding} />
    {:else}
      <div class="faint empty">No findings yet. Run a scan.</div>
    {/each}
  </Panel>
</div>

<style>
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(480px, 100%), 1fr));
    gap: 14px;
    align-items: start;
  }
  .title {
    font-size: 16px;
    font-weight: 600;
    height: 38px;
  }
  .rename {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .rename input {
    flex: 1;
  }
  .small {
    font-size: 12px;
  }
  .when {
    font-size: 11.5px;
    margin-bottom: -8px;
  }
  .empty {
    padding: 20px;
    text-align: center;
  }
</style>
