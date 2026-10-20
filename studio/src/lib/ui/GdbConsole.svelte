<script lang="ts">
  // Starts GDB connected to OpenOCD's GDB server, with its output and a command line in the app.
  import { Bug, FolderOpen, Square, X } from "@lucide/svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import { spawn, which, type ProcessHandle } from "../core/process";
  import { app } from "../stores/app.svelte";
  import DesktopOnly from "./DesktopOnly.svelte";
  import { onDestroy } from "svelte";

  let { port, ocdRunning }: { port: number; ocdRunning: boolean } = $props();

  /** Multi-architecture builds first; plain gdb only debugs the host's architecture. */
  const CANDIDATES = ["gdb-multiarch", "arm-none-eabi-gdb", "gdb"];
  let found = $state<string[] | undefined>(undefined);
  let program = $state("");
  let elf = $state<string | null>(null);
  let proc = $state<ProcessHandle | null>(null);
  let lines = $state<{ text: string; kind: "out" | "err" | "in" }[]>([]);
  let input = $state("");
  let history: string[] = [];
  let histPos = 0;
  let logEl: HTMLDivElement | undefined = $state();

  // A process left behind would keep the serial port or OpenOCD's GDB connection busy.
  onDestroy(() => void proc?.kill());

  $effect(() => {
    if (app.tauri && found === undefined) {
      void Promise.all(CANDIDATES.map((c) => which(c).then((p) => (p ? c : null)))).then((r) => {
        found = r.filter((x): x is string => !!x);
        program = found[0] ?? "";
      });
    }
  });

  const QUICK = ["monitor reset halt", "info registers", "x/16xw $sp", "bt", "monitor resume"];

  const push = (text: string, kind: "out" | "err" | "in") => {
    lines = [...lines.slice(-3000), { text, kind }];
    queueMicrotask(() => logEl?.scrollTo({ top: logEl.scrollHeight }));
  };

  async function pickElf() {
    const p = await open({ multiple: false, filters: [{ name: "Program with symbols", extensions: ["elf", "axf", "out", "*"] }] });
    if (typeof p === "string") elf = p;
  }

  async function start() {
    lines = [];
    const args = ["-q", "-nx", ...(elf ? [elf] : []), "-ex", `target extended-remote localhost:${port}`];
    try {
      push(`$ ${program} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`, "in");
      proc = await spawn(
        program,
        args,
        (raw, s) => {
          // GDB prints its "(gdb) " prompt without a newline, so it lands in front of the next output.
          const text = raw.replace(/^(\(gdb\) ?)+/, "");
          if (!text) return;
          push(text, s);
          // GDB stops reading piped input after a failed connect, so end it with an explanation.
          if (/could not connect|Connection (refused|timed out)/i.test(text)) {
            push(`OpenOCD's GDB server isn't answering on port ${port}. Check that OpenOCD is running and found the target, then start GDB again.`, "err");
            void proc?.kill();
          }
        },
        { interactive: true },
      );
      const code = await proc.exited;
      push(`-- gdb exited (${code ?? "killed"}) --`, code ? "err" : "out");
    } catch (e) {
      app.error(e, "Could not start GDB");
    } finally {
      proc = null;
    }
  }

  async function send(cmd: string) {
    if (!proc) return;
    push(`(gdb) ${cmd}`, "in");
    if (cmd.trim()) history = [...history.filter((h) => h !== cmd), cmd].slice(-100);
    histPos = history.length;
    await proc.write(cmd + "\n").catch((e) => app.error(e, "GDB"));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      void send(input);
      input = "";
    } else if (e.key === "ArrowUp" && history.length) {
      histPos = Math.max(0, histPos - 1);
      input = history[histPos];
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      histPos = Math.min(history.length, histPos + 1);
      input = history[histPos] ?? "";
      e.preventDefault();
    }
  }
</script>

<div class="gdb">
  <div class="head">
    <Bug size={14} class="faint" />
    <strong>GDB</strong>
    <span class="faint small">connects to OpenOCD on localhost:{port}</span>
  </div>
  {#if !app.tauri}
    <DesktopOnly feature="Starting GDB" />
  {:else if found && !found.length}
    <div class="warn small">
      No GDB found on your PATH (looked for {CANDIDATES.join(", ")}). Install <code>gdb-multiarch</code> (Debian/Ubuntu), <code>gdb</code> with multiarch support (Arch, Fedora),
      or the Arm GNU Toolchain for <code>arm-none-eabi-gdb</code>.
    </div>
  {:else if found}
    <div class="row">
      <select class="input mono" bind:value={program} disabled={!!proc} title="GDB program">
        {#each found as f (f)}<option value={f}>{f}</option>{/each}
      </select>
      <button class="btn sm" onclick={pickElf} disabled={!!proc} title="Optional: the firmware's ELF file, for symbols and source">
        <FolderOpen size={13} />
        {elf ? elf.split(/[\\/]/).pop() : "ELF file (optional)"}
      </button>
      {#if elf && !proc}<button class="btn sm ghost icon" title="No ELF file" onclick={() => (elf = null)}><X size={12} /></button>{/if}
      <span class="spacer"></span>
      {#if proc}
        <button class="btn sm danger" onclick={() => proc?.kill()}><Square size={12} /> Stop GDB</button>
      {:else}
        <button class="btn sm primary" onclick={start} disabled={!program || !ocdRunning} title={ocdRunning ? "" : "Launch OpenOCD first"}><Bug size={13} /> Start GDB</button>
      {/if}
    </div>
    {#if program === "gdb"}
      <div class="faint small">Plain <code>gdb</code> only debugs other architectures if it was built with multiarch support (Arch and Fedora builds are).</div>
    {/if}
    {#if lines.length}
      <div class="log mono" bind:this={logEl}>
        {#each lines as l, i (i)}<div class={l.kind}>{l.text}</div>{/each}
      </div>
    {/if}
    {#if proc}
      <div class="row">
        <input class="input mono cmdline" placeholder="GDB command, e.g. monitor reset halt" bind:value={input} onkeydown={onKey} />
      </div>
      <div class="row quick">
        {#each QUICK as q (q)}<button class="btn sm ghost mono" onclick={() => send(q)}>{q}</button>{/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .gdb {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }
  .head,
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .small {
    font-size: 12px;
  }
  .warn {
    color: var(--warn);
  }
  .cmdline {
    flex: 1;
  }
  .quick :global(.btn) {
    font-size: 11.5px;
  }
  .log {
    max-height: 280px;
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11.5px;
    white-space: pre-wrap;
  }
  .log .err {
    color: var(--warn);
  }
  .log .in {
    color: var(--accent);
  }
</style>
