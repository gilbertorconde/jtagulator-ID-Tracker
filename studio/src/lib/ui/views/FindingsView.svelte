<script lang="ts">
  import { Download, FileJson, FilePlus2, Trash2, Upload } from "@lucide/svelte";
  import { openTextFile, saveTextAs } from "../../files";
  import { markdownReport } from "../../report";
  import { app } from "../../stores/app.svelte";
  import { parseTarget, serializeTarget } from "../../target/profile";
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
    await saveTextAs(`${slug()}.jtarget`, serializeTarget($state.snapshot(t)), "jtarget").catch((e) => app.error(e, "Export"));
  }
  async function exportMd() {
    await saveTextAs(`${slug()}-report.md`, markdownReport(t), "md").catch((e) => app.error(e, "Export"));
  }
  async function importJson() {
    try {
      const file = await openTextFile(["jtarget", "json"]);
      if (!file) return;
      const { target: data, skipped } = parseTarget(file.text);
      const same = app.targets.find((x) => x.id === data.id);
      const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
      const summary = `“${data.name}”: ${n(data.findings.length, "finding")}, ${n(Object.keys(data.channelNames).length, "channel label")}.`;
      const how = await app.choose(
        "Open target",
        same
          ? `${summary}\n\nYou already have this target (“${same.name}”, saved ${new Date(same.updatedAt).toLocaleString()}). Replace it with the file, keep both, or merge the file into the current target?`
          : `${summary}\n\nOpen it as a new saved target, or merge it into the current target “${t.name}”? Merging keeps your pins and labels and adds what the file knows that you don't.`,
        [
          { value: "merge", label: "Merge into current", kind: "plain" },
          ...(same ? [{ value: "new", label: "Keep both", kind: "plain" as const }, { value: "replace", label: "Replace", kind: "danger" as const }] : [{ value: "new", label: "Open as new" }]),
        ],
      );
      if (!how) return;
      const conflicts = app.importTarget(data, how as "new" | "replace" | "merge");
      const notes = [skipped ? `${skipped} unreadable findings skipped.` : "", conflicts.length ? `Kept your values where they differ:\n${conflicts.join("\n")}` : ""].filter(Boolean).join("\n");
      app.toast(conflicts.length || skipped ? "warn" : "ok", how === "merge" ? "Target merged" : "Target opened", notes || data.name, conflicts.length ? 10000 : undefined);
    } catch (e) {
      app.error(e, "Import");
    }
  }
  function newTarget() {
    app.newTarget();
  }
  async function removeTarget() {
    if (!(await app.ask("Delete target", `Delete “${t.name}” and its ${t.findings.length} findings? Export it first if you want to keep it.`, "Delete", true))) return;
    app.deleteTarget(t.id);
  }
</script>

<div class="cols">
  <Panel title="Target" subtitle="Everything learned about the board under test. Saved automatically.">
    {#snippet aside()}
      <button class="btn sm" onclick={newTarget}><FilePlus2 size={13} /> New</button>
      <button class="btn sm ghost icon" title="Delete this target" onclick={removeTarget}><Trash2 size={13} /></button>
      <button class="btn sm" onclick={importJson}><Upload size={13} /> Open</button>
      <button class="btn sm" onclick={exportJson}><FileJson size={13} /> Save</button>
      <button class="btn sm primary" onclick={exportMd}><Download size={13} /> Report</button>
    {/snippet}
    {#if app.targets.length > 1}
      <div class="switch">
        <span class="label">Saved targets</span>
        <select class="input" value={t.id} onchange={(e) => app.switchTarget((e.currentTarget as HTMLSelectElement).value)}>
          {#each [...app.targets].sort((a, b) => b.updatedAt - a.updatedAt) as x (x.id)}
            <option value={x.id}>{x.name} · {x.findings.length} finding{x.findings.length === 1 ? "" : "s"} · {new Date(x.updatedAt).toLocaleDateString()}</option>
          {/each}
        </select>
      </div>
    {/if}
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
  .switch {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .switch select {
    flex: 1;
    min-width: 0;
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
