<script lang="ts">
  import type { Terminal } from "@xterm/xterm";
  import { Plug, Unplug, Send } from "@lucide/svelte";
  import type { PassthroughHandle } from "../../core/jtagulator";
  import type { Finding, PinsLow } from "../../core/types";
  import { app } from "../../stores/app.svelte";
  import Field from "../Field.svelte";
  import OpResults from "../OpResults.svelte";
  import Panel from "../Panel.svelte";
  import PinSelect from "../PinSelect.svelte";
  import PinsLowField from "../PinsLowField.svelte";
  import RangeField from "../RangeField.svelte";
  import RunButton from "../RunButton.svelte";
  import Tabs from "../Tabs.svelte";
  import XTerm from "./XTerm.svelte";
  import { pinMap } from "../signals";

  const BAUDS = [300, 600, 1200, 1800, 2400, 3600, 4800, 7200, 9600, 14400, 19200, 28800, 31250, 38400, 57600, 76800, 115200, 153600, 230400, 250000, 307200];

  let tab = $state<"scan" | "txd" | "passthrough">("scan");
  const t = app.target;
  let start = $state(t.range.start);
  let end = $state(t.range.end);
  let pinsLow = $state<PinsLow | false>(false);
  let text = $state("");
  let hex = $state(false);
  let delay = $state(10);
  let printable = $state(true);
  let knownTx = $state<number | null>(null);
  let knownRx = $state<number | null>(null);
  let txdSeconds = $state(10);
  let ignoreNonStd = $state(true);

  let ptTx = $state<number | null>(t.uart.txd ?? 0);
  let ptRx = $state<number | null>(t.uart.rxd ?? 1);
  let ptBaud = $state(t.uart.baud ?? 115200);
  let ptEcho = $state(false);
  let handle = $state<PassthroughHandle | null>(null);
  let term: Terminal | null = null;
  let lineInput = $state("");
  let lineEnd = $state<"\r" | "\n" | "\r\n">("\r");

  const roles = $derived(pinMap([["txd", app.target.uart.txd], ["rxd", app.target.uart.rxd]]));
  const hexOk = $derived(!hex || /^([0-9a-fA-F]{2}){1,16}$/.test(text.replace(/\s+/g, "")));

  function runScan() {
    const payload = hex ? Uint8Array.from((text.replace(/\s+/g, "").match(/../g) ?? []).map((h) => parseInt(h, 16))) : text || undefined;
    app.run("uart.scan", {
      start,
      end,
      known: { txd: knownTx, rxd: knownRx },
      text: payload,
      delayMs: delay,
      printableOnly: printable,
      pinsLow: pinsLow || undefined,
    });
  }

  function use(f: Finding) {
    if (f.kind === "uart") {
      ptTx = f.txd;
      ptRx = f.rxd;
      ptBaud = f.baud;
      tab = "passthrough";
    } else if (f.kind === "uart-txd") {
      ptTx = f.txd;
      if (f.bestFit) ptBaud = f.bestFit;
      tab = "passthrough";
    }
  }

  async function open() {
    if (!app.dev) return;
    try {
      handle = await app.dev.uartPassthrough({ txd: ptTx, rxd: ptRx, baud: ptBaud, localEcho: ptEcho });
      app.recordLine(`const pt = await uart.passthrough(${JSON.stringify({ txd: ptTx, rxd: ptRx, baud: ptBaud })});`);
      term?.clear();
      term?.writeln(`\x1b[2m-- passthrough TXD ${ptTx ?? "off"} / RXD ${ptRx ?? "off"} @ ${ptBaud} baud --\x1b[0m`);
      handle.onData((d) => term?.write(d));
      void handle.closed.then(() => {
        handle = null;
        term?.writeln("\r\n\x1b[2m-- passthrough closed --\x1b[0m");
      });
      term?.focus();
    } catch (e) {
      app.error(e, "Passthrough");
    }
  }

  async function close() {
    await handle?.close().catch((e) => app.error(e));
    app.recordLine("await uart.close(pt);");
  }

  function sendLine() {
    if (!handle) return;
    void handle.write(lineInput + lineEnd);
    app.recordLine(`await uart.send(pt, ${JSON.stringify(lineInput + lineEnd)});`);
    lineInput = "";
  }

  $effect(() => () => void handle?.close());
</script>

{#snippet useAction(f: Finding)}
  <button class="btn sm" onclick={() => use(f)}>Open terminal</button>
{/snippet}

<div class="view">
  <Tabs
    tabs={[
      { id: "scan", label: "Active scan" },
      { id: "txd", label: "Passive TXD scan" },
      { id: "passthrough", label: "Passthrough terminal" },
    ]}
    bind:value={tab}
  />
  <div class="note muted">Pin names are from the target's side: TXD is where the target transmits.</div>

  {#if tab === "scan"}
    <div class="cols">
      <Panel title="UART discovery" subtitle="Sends a string on every TXD/RXD pair at 21 standard baud rates and shows any reply.">
        <RangeField bind:start bind:end min={2} {roles} permutations={(n) => n * (n - 1)} />
        <div class="grid2">
          <PinSelect role="txd" optional bind:value={knownTx} />
          <PinSelect role="rxd" optional bind:value={knownRx} />
        </div>
        <div class="grid2">
          <Field label="Text to send" hint={hex ? "Up to 16 bytes, e.g. 0D 0A" : "Up to 16 printable chars, CR is added. Empty = CR."}>
            <div class="inline">
              <input class="input mono" bind:value={text} placeholder={hex ? "0D" : "CR"} />
              <label class="check"><input type="checkbox" bind:checked={hex} /> hex</label>
            </div>
          </Field>
          <Field label="Wait for reply (ms)">
            <input class="input mono" type="number" min="0" max="1000" bind:value={delay} />
          </Field>
        </div>
        <label class="check"><input type="checkbox" bind:checked={printable} /> Only show replies that are printable text</label>
        <PinsLowField bind:value={pinsLow} />
        {#snippet footer()}
          <RunButton label="Start UART scan" onclick={runScan} disabled={!hexOk || end - start < 1} reason="Invalid hex" />
        {/snippet}
      </Panel>
      <Panel title="Results"><OpResults names={["uart.scan"]} actions={useAction} /></Panel>
    </div>
  {:else if tab === "txd"}
    <div class="cols">
      <Panel title="Passive TXD scan" subtitle="Listens on every channel for UART traffic and measures the baud rate. Nothing is transmitted.">
        <RangeField bind:start bind:end min={1} {roles} />
        <div class="grid2">
          <Field label="Listen for (seconds)" hint="Power-cycle the target during the scan to catch its boot log.">
            <input class="input mono" type="number" min="1" max="3600" bind:value={txdSeconds} />
          </Field>
          <label class="check end"><input type="checkbox" bind:checked={ignoreNonStd} /> Ignore non-standard baud rates</label>
        </div>
        {#snippet footer()}
          <RunButton
            label="Start listening"
            onclick={() => app.run("uart.txdScan", { start, end, ignoreNonStandard: ignoreNonStd, durationMs: txdSeconds * 1000 })}
          />
        {/snippet}
      </Panel>
      <Panel title="Results"><OpResults names={["uart.txdScan"]} actions={useAction} /></Panel>
    </div>
  {:else}
    <Panel title="UART passthrough" subtitle="Bridges this terminal to the target's serial console. Ctrl-X is reserved for exiting.">
      {#snippet aside()}
        {#if handle}
          <span class="badge ok">Live</span>
          <button class="btn danger sm" onclick={close}><Unplug size={13} /> Close</button>
        {/if}
      {/snippet}
      {#if !handle}
        <div class="ptcfg">
          <PinSelect role="txd" optional optionalLabel="Off" bind:value={ptTx} />
          <PinSelect role="rxd" optional optionalLabel="Off" bind:value={ptRx} />
          <select class="input mono" bind:value={ptBaud}>
            {#each BAUDS as b (b)}<option value={b}>{b}</option>{/each}
          </select>
          <label class="check"><input type="checkbox" bind:checked={ptEcho} /> Local echo</label>
          <RunButton label="Open" onclick={open} disabled={ptTx === null && ptRx === null} />
        </div>
      {/if}
      <div class="term"><XTerm onready={(t) => (term = t)} ondata={(d) => handle?.write(d)} /></div>
      <form
        class="sendline"
        onsubmit={(e) => {
          e.preventDefault();
          sendLine();
        }}
      >
        <input class="input mono" placeholder="Send a line…" bind:value={lineInput} disabled={!handle} />
        <select class="input" bind:value={lineEnd}>
          <option value={"\r"}>CR</option>
          <option value={"\n"}>LF</option>
          <option value={"\r\n"}>CR LF</option>
        </select>
        <button class="btn" disabled={!handle}><Send size={13} /> Send</button>
      </form>
    </Panel>
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .note {
    font-size: 12px;
    margin-top: -6px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
    gap: 14px;
    align-items: start;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .inline {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .inline input {
    flex: 1;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    cursor: pointer;
    white-space: nowrap;
  }
  .check.end {
    align-self: center;
  }
  .ptcfg {
    display: grid;
    grid-template-columns: 1fr 1fr 130px auto auto;
    gap: 8px;
    align-items: center;
  }
  .term {
    height: 420px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .sendline {
    display: flex;
    gap: 8px;
  }
  .sendline input {
    flex: 1;
  }
</style>
