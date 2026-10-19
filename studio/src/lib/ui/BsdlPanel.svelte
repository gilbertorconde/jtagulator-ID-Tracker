<script lang="ts">
  // Saved BSDL files: pick the one describing the chip, so IR/DR results get
  // instruction names, the EXTEST opcode is filled in and pin-mapper bits get pins.
  import { FileUp, Trash2 } from "@lucide/svelte";
  import { addToLibrary, removeFromLibrary } from "../bsdl/library";
  import { matchesIdcode } from "../bsdl/parser";
  import { openTextFile } from "../files";
  import { app } from "../stores/app.svelte";
  import Panel from "./Panel.svelte";

  /** IDCODEs of the devices found on the current target. */
  const idcodes = $derived(
    app.target.findings.flatMap((f) => (f.finding.kind === "jtag" ? f.finding.devices.map((d) => d.idcode.raw) : [])),
  );
  const matches = (name: string) => {
    const b = app.bsdl.find((x) => x.name === name);
    return !!b && idcodes.some((id) => matchesIdcode(b.file, id));
  };

  // Pick a matching file automatically when nothing is selected.
  $effect(() => {
    if (app.activeBsdl || !app.bsdl.length) return;
    const m = app.bsdl.find((b) => idcodes.some((id) => matchesIdcode(b.file, id)));
    if (m) app.activeBsdl = m.name;
  });

  async function add() {
    try {
      const f = await openTextFile(["bsd", "bsdl", "bsm"]);
      if (!f) return;
      const e = await addToLibrary(f.name, f.text);
      await app.reloadBsdl();
      app.activeBsdl = e.name;
      app.toast("ok", "BSDL file added", `${e.file.entity}: IR ${e.file.irLength ?? "?"} bits, ${e.file.cells.length} boundary cells`);
    } catch (e) {
      app.error(e, "BSDL file");
    }
  }

  async function remove(name: string) {
    if (!(await app.ask("Remove BSDL file", `Remove ${name} from the library?`, "Remove", true))) return;
    await removeFromLibrary(name).catch((e) => app.error(e));
    if (app.activeBsdl === name) app.activeBsdl = null;
    await app.reloadBsdl();
  }
</script>

<Panel title="BSDL file" subtitle="A chip's boundary-scan description. With one selected, results show instruction names and package pins.">
  {#snippet aside()}<button class="btn sm" onclick={add}><FileUp size={13} /> Add BSDL…</button>{/snippet}
  {#if app.bsdl.length}
    <div class="list">
      {#each app.bsdl as b (b.name)}
        <label class="row" class:active={app.activeBsdl === b.name}>
          <input type="radio" name="bsdl" checked={app.activeBsdl === b.name} onchange={() => (app.activeBsdl = b.name)} />
          <span class="ent mono">{b.file.entity}</span>
          {#if matches(b.name)}<span class="badge ok">matches this target</span>{/if}
          <span class="faint small">IR {b.file.irLength ?? "?"} · BSR {b.file.bsrLength ?? "?"} · {Object.keys(b.file.opcodes).length} instructions</span>
          <button class="btn ghost sm icon" title="Remove" onclick={(e) => (e.preventDefault(), remove(b.name))}><Trash2 size={12} /></button>
        </label>
      {/each}
      <label class="row" class:active={!app.activeBsdl}>
        <input type="radio" name="bsdl" checked={!app.activeBsdl} onchange={() => (app.activeBsdl = null)} />
        <span class="muted">None</span>
      </label>
    </div>
  {:else}
    <div class="faint small">
      No BSDL files yet. Chip vendors publish them (search for the part number + "BSDL"). The repository's
      <code>studio/examples/SIM_DEMO_CHIP.bsd</code> matches the simulator's chip.
    </div>
  {/if}
</Panel>

<style>
  .list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .row:last-child {
    border-bottom: none;
  }
  .row.active {
    background: var(--accent-soft);
  }
  .ent {
    font-weight: 600;
  }
  .small {
    font-size: 12px;
    margin-left: auto;
  }
</style>
