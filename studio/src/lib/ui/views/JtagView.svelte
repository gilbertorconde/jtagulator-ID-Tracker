<script lang="ts">
  import type { Finding, PinsLow } from "../../core/types";
  import { app } from "../../stores/app.svelte";
  import Field from "../Field.svelte";
  import OpResults from "../OpResults.svelte";
  import Panel from "../Panel.svelte";
  import PinHeader from "../PinHeader.svelte";
  import PinSelect from "../PinSelect.svelte";
  import PinsLowField from "../PinsLowField.svelte";
  import RangeField from "../RangeField.svelte";
  import RunButton from "../RunButton.svelte";
  import Tabs from "../Tabs.svelte";
  import { pinMap } from "../signals";

  type Mode = "scan" | "idcode" | "bypass" | "rtck";
  let tab = $state<"discover" | "known">("discover");
  let mode = $state<Mode>("scan");

  const t = app.target;
  let start = $state(t.range.start);
  let end = $state(t.range.end);
  let pinsLow = $state<PinsLow | false>(false);
  let known = $state<{ tdi: number | null; tdo: number | null; tck: number | null; tms: number | null }>({
    tdi: null,
    tdo: null,
    tck: null,
    tms: null,
  });
  let rtckTck = $state<number | null>(null);

  let pins = $state({ tdi: t.jtag.tdi ?? 0, tdo: t.jtag.tdo ?? 1, tck: t.jtag.tck ?? 2, tms: t.jtag.tms ?? 3 });
  let ignoreSingle = $state(true);
  let extestIr = $state("0");
  let fill = $state<"low" | "high">("low");
  let passes = $state(2);

  const MODES: { id: Mode; label: string; min: number; r: number; desc: string }[] = [
    { id: "scan", label: "Combined", min: 4, r: 3, desc: "IDCODE scan for TDO/TCK/TMS, then a BYPASS test for TDI. The best default." },
    { id: "idcode", label: "IDCODE", min: 3, r: 3, desc: "Fast. Finds TDO, TCK and TMS when devices reset into IDCODE. Cannot find TDI." },
    { id: "bypass", label: "BYPASS", min: 4, r: 4, desc: "Finds all four pins through the BYPASS register. Slow, so fill in any pins you already know." },
    { id: "rtck", label: "RTCK", min: 2, r: 2, desc: "Finds the adaptive-clocking return pin by toggling TCK and watching for an echo." },
  ];
  const cur = $derived(MODES.find((m) => m.id === mode)!);

  function perms(n: number) {
    let fixed = 0;
    if (mode === "bypass") fixed = Object.values(known).filter((v) => v !== null).length;
    if (mode === "rtck" && rtckTck !== null) fixed = 1;
    const r = cur.r - fixed;
    const free = n - fixed;
    let v = 1;
    for (let i = free - r + 1; i <= free; i++) v *= i;
    return v;
  }

  function runDiscover() {
    const base = { start, end, pinsLow: pinsLow || undefined };
    if (mode === "scan") app.run("jtag.scan", base);
    else if (mode === "idcode") app.run("jtag.idcodeScan", base);
    else if (mode === "bypass") app.run("jtag.bypassScan", { ...base, known: { ...known } });
    else app.run("jtag.rtckScan", { ...base, tck: rtckTck });
  }

  const roles = $derived(
    pinMap([
      ["tdi", app.target.jtag.tdi],
      ["tdo", app.target.jtag.tdo],
      ["tck", app.target.jtag.tck],
      ["tms", app.target.jtag.tms],
      ["trst", app.target.jtag.trst],
      ["rtck", app.target.jtag.rtck],
    ]),
  );
  const knownRoles = $derived(
    pinMap([
      ["tdi", pins.tdi],
      ["tdo", pins.tdo],
      ["tck", pins.tck],
      ["tms", pins.tms],
    ]),
  );
  const unique = $derived(new Set([pins.tdi, pins.tdo, pins.tck, pins.tms]).size === 4);
  const irValid = $derived(/^[0-9a-fA-F]{1,8}$/.test(extestIr));

  function usePins(f: Finding) {
    if (f.kind !== "jtag") return;
    pins = { tdi: f.tdi ?? pins.tdi, tdo: f.tdo, tck: f.tck, tms: f.tms };
    tab = "known";
  }

  function fromTarget() {
    const j = app.target.jtag;
    pins = { tdi: j.tdi ?? pins.tdi, tdo: j.tdo ?? pins.tdo, tck: j.tck ?? pins.tck, tms: j.tms ?? pins.tms };
  }
</script>

{#snippet useAction(f: Finding)}
  {#if f.kind === "jtag" && f.tdo >= 0}
    <button class="btn sm" onclick={() => usePins(f)}>Use pinout</button>
  {/if}
{/snippet}

<div class="view">
  <Tabs
    tabs={[
      { id: "discover", label: "Discover pinout" },
      { id: "known", label: "Known pinout tools" },
    ]}
    bind:value={tab}
  />

  {#if tab === "discover"}
    <div class="cols">
      <Panel title="JTAG discovery" subtitle={cur.desc}>
        <Tabs tabs={MODES.map((m) => ({ id: m.id, label: m.label }))} bind:value={mode} />
        <RangeField bind:start bind:end min={cur.min} {roles} permutations={perms} />
        {#if mode === "bypass"}
          <div class="pins4">
            <PinSelect role="tdi" optional bind:value={known.tdi} />
            <PinSelect role="tdo" optional bind:value={known.tdo} />
            <PinSelect role="tck" optional bind:value={known.tck} />
            <PinSelect role="tms" optional bind:value={known.tms} />
          </div>
        {:else if mode === "rtck"}
          <div class="pins4"><PinSelect role="tck" optional optionalLabel="Search" bind:value={rtckTck} /></div>
        {/if}
        <PinsLowField bind:value={pinsLow} />
        {#snippet footer()}
          <RunButton label="Start {cur.label.toLowerCase()} scan" onclick={runDiscover} disabled={end - start + 1 < cur.min} />
        {/snippet}
      </Panel>
      <Panel title="Results">
        <OpResults names={["jtag.scan", "jtag.idcodeScan", "jtag.bypassScan", "jtag.rtckScan"]} actions={useAction} />
      </Panel>
    </div>
  {:else}
    <Panel title="Pinout" subtitle="Used by every tool below. Filled in automatically from scan results.">
      {#snippet aside()}<button class="btn sm" onclick={fromTarget}>Load from target</button>{/snippet}
      <div class="pins4">
        <PinSelect role="tdi" bind:value={pins.tdi} />
        <PinSelect role="tdo" bind:value={pins.tdo} />
        <PinSelect role="tck" bind:value={pins.tck} />
        <PinSelect role="tms" bind:value={pins.tms} />
      </div>
      {#if !unique}<div class="bad">Each pin must be on a different channel.</div>{/if}
      <PinHeader compact roles={knownRoles} />
    </Panel>

    <div class="cols">
      <Panel title="Device IDs" subtitle="Read the IDCODE of every device in the chain. TDI is not needed.">
        <OpResults names={["jtag.deviceIds"]} />
        {#snippet footer()}
          <RunButton label="Read IDs" onclick={() => app.run("jtag.deviceIds", { tdo: pins.tdo, tck: pins.tck, tms: pins.tms })} disabled={!unique} />
        {/snippet}
      </Panel>

      <Panel title="Test BYPASS" subtitle="Shift a random 32-bit pattern from TDI to TDO and compare.">
        <OpResults names={["jtag.testBypass"]} empty="Checks that TDI and TDO are right.">
          {#snippet extra(r)}
            {@const b = r as { devices: number; patternIn: string | null; patternOut: string | null; match: boolean } | undefined}
            {#if b}
              <div class="bypass">
                <span class="badge {b.match ? 'ok' : 'danger'}">{b.match ? "Match" : "No match"}</span>
                <span class="muted">{b.devices} device{b.devices === 1 ? "" : "s"} in chain</span>
                {#if b.patternIn}<div class="mono small">in&nbsp; {b.patternIn}<br />out {b.patternOut}</div>{/if}
              </div>
            {/if}
          {/snippet}
        </OpResults>
        {#snippet footer()}
          <RunButton label="Test" onclick={() => app.run("jtag.testBypass", { ...pins })} disabled={!unique} />
        {/snippet}
      </Panel>

      <Panel title="IR / DR discovery" subtitle="Find the data register length behind every instruction. Needs one device in the chain.">
        <label class="check"><input type="checkbox" bind:checked={ignoreSingle} /> Hide single-bit registers (usually BYPASS)</label>
        <OpResults names={["jtag.irdr"]}>
          {#snippet extra(r)}
            {@const x = r as { irLength: number | null; instructions: number | null } | undefined}
            {#if x}<div class="muted small">IR length {x.irLength ?? "n/a"} · {x.instructions ?? "?"} instructions tried</div>{/if}
          {/snippet}
        </OpResults>
        {#snippet footer()}
          <RunButton label="Discover" onclick={() => app.run("jtag.irdr", { pins: { ...pins }, ignoreSingleBit: ignoreSingle })} disabled={!unique} />
        {/snippet}
      </Panel>

      <Panel title="Pin mapper (EXTEST)" subtitle="Walk a bit through the Boundary Scan Register and see which channel each bit drives.">
        <div class="row3">
          <Field label="EXTEST opcode (hex)">
            <input class="input mono" bind:value={extestIr} />
          </Field>
          <Field label="Fill">
            <select class="input" bind:value={fill}>
              <option value="low">LOW, walking 1</option>
              <option value="high">HIGH, walking 0</option>
            </select>
          </Field>
          <Field label="Passes">
            <input class="input mono" type="number" min="1" max="50" bind:value={passes} />
          </Field>
        </div>
        <OpResults names={["jtag.pinMapper"]}>
          {#snippet extra(r)}
            {@const x = r as { findings: { channel: number; bit: number }[]; bsrLength: number | null } | undefined}
            {#if x}
              <div class="muted small">Boundary Scan Register: {x.bsrLength ?? "n/a"} bits</div>
              <PinHeader compact roles={pinMap(x.findings.map((f) => ["bsr", f.channel] as ["bsr", number]))} />
            {/if}
          {/snippet}
        </OpResults>
        {#snippet footer()}
          <RunButton
            label="Map pins"
            onclick={() => app.run("jtag.pinMapper", { pins: { ...pins }, instruction: parseInt(extestIr, 16), fill, passes })}
            disabled={!unique || !irValid}
          />
        {/snippet}
      </Panel>

      <Panel title="OpenOCD mode" subtitle="Hand the JTAGulator to OpenOCD as a Bus Pirate-compatible adapter.">
        <div class="note">
          This mode stays on through resets and power cycles until you exit it. After entering, disconnect here and run:
          <pre class="mono">openocd -f interface/buspirate.cfg -c "transport select jtag; buspirate port {app.portName ?? '/dev/ttyUSB0'}"</pre>
          Reconnect afterwards and choose <b>Exit mode</b> in the top bar.
        </div>
        {#snippet footer()}
          <RunButton label="Enter OpenOCD mode" onclick={() => app.run("jtag.openocd", { ...pins })} disabled={!unique} />
        {/snippet}
      </Panel>
    </div>
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .pins4 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
  }
  .row3 {
    display: grid;
    grid-template-columns: 1fr 1.4fr 0.8fr;
    gap: 10px;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    cursor: pointer;
  }
  .bad {
    color: var(--danger);
    font-size: 12.5px;
  }
  .bypass {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .small {
    font-size: 12px;
  }
  .note {
    font-size: 12.5px;
    color: var(--text-muted);
  }
  pre {
    white-space: pre-wrap;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
    color: var(--text);
  }
</style>
