<script lang="ts">
  import { BookOpen, Circle, FilePlus, FolderOpen, Play, Save, Square, Trash2 } from "@lucide/svelte";
  import { CALL_SPECS as CALLS } from "../../scripting/api";
  import { runScript, type ScriptLog, type ScriptRun } from "../../scripting/runner";
  import { deleteScript, listScripts, saveScript, scriptsFolder, type ScriptFile } from "../../scripting/store";
  import { app } from "../../stores/app.svelte";
  import CodeEditor from "../CodeEditor.svelte";

  let scripts = $state<ScriptFile[]>([]);
  let current = $state<string | null>(null);
  let nameDraft = $state("");
  let code = $state("");
  let saved = $state("");
  let logs = $state<ScriptLog[]>([]);
  let run = $state<ScriptRun | null>(null);
  let showRef = $state(false);
  let folder = $state<string | null>(null);
  let logEl: HTMLDivElement | undefined = $state();

  const dirty = $derived(code !== saved || (current !== null && nameDraft !== current));

  async function refresh() {
    try {
      scripts = await listScripts();
      folder = await scriptsFolder();
      if (!current && scripts.length) open(scripts[0]);
    } catch (e) {
      app.error(e, "Could not load scripts");
    }
  }
  $effect(() => void refresh());

  function open(s: ScriptFile) {
    current = s.name;
    nameDraft = s.name;
    code = s.code;
    saved = s.code;
  }

  async function save() {
    const name = nameDraft.trim() || "Untitled";
    try {
      await saveScript(name, code);
      if (current && current !== name) await deleteScript(current);
    } catch (e) {
      return app.error(e, "Save failed");
    }
    current = name;
    saved = code;
    await refresh();
  }

  function newScript(body = "// Write JavaScript here. Every device call is async: use await.\n\nconst info = await device.info();\nlog(info.firmware);\n") {
    current = null;
    nameDraft = "New script";
    code = body;
    saved = "";
  }

  async function remove() {
    if (!current || !(await app.ask("Delete script", `Delete “${current}”?`, "Delete", true))) return;
    await deleteScript(current);
    current = null;
    code = saved = "";
    await refresh();
  }

  function start() {
    if (run) return;
    logs = [];
    run = runScript(code, (l) => {
      logs = [...logs, l];
      queueMicrotask(() => logEl?.scrollTo({ top: logEl.scrollHeight }));
    });
    void run.done.then(() => (run = null));
  }

  function toggleRecord() {
    if (app.recording) {
      const body = app.stopRecording();
      newScript(body);
      app.toast("ok", "Recording saved to a new script", "Review it, then Save.");
    } else {
      app.startRecording();
      app.toast("info", "Recording", "Use the app normally. Each action becomes a line of script.");
    }
  }
</script>

<div class="scripts">
  <aside class="card list">
    <div class="list-head">
      <span class="label">Library</span>
      <button class="btn ghost sm icon" title="New script" onclick={() => newScript()}><FilePlus size={14} /></button>
    </div>
    {#each scripts as s (s.name)}
      <button class="item" class:active={s.name === current} onclick={() => open(s)}>{s.name}</button>
    {/each}
    {#if current === null && code}<div class="item active new">Unsaved script</div>{/if}
    <div class="grow"></div>
    <button class="btn" class:danger={app.recording} onclick={toggleRecord}>
      {#if app.recording}<Square size={13} /> Stop recording ({app.recorded.length}){:else}<Circle size={13} /> Record macro{/if}
    </button>
    {#if folder}<div class="folder faint" title={folder}><FolderOpen size={12} /> {folder}</div>{/if}
  </aside>

  <section class="card main">
    <div class="toolbar">
      <input class="input name" bind:value={nameDraft} spellcheck="false" />
      {#if dirty}<span class="badge warn">unsaved</span>{/if}
      <div class="grow"></div>
      <button class="btn sm" class:primary={showRef} onclick={() => (showRef = !showRef)}><BookOpen size={13} /> Reference</button>
      <button class="btn sm" onclick={save} disabled={!dirty && !!current}><Save size={13} /> Save</button>
      <button class="btn sm ghost icon" title="Delete" onclick={remove} disabled={!current}><Trash2 size={13} /></button>
      {#if run}
        <button class="btn sm danger" onclick={() => run?.stop()}><Square size={12} /> Stop</button>
      {:else}
        <button class="btn sm primary" onclick={start} title="Ctrl+Enter"><Play size={12} /> Run</button>
      {/if}
    </div>
    <div class="split">
      <div class="code"><CodeEditor bind:value={code} onrun={start} /></div>
      {#if showRef}
        <div class="ref">
          <p class="muted">Scripts run in a sandbox and talk to the device only through these functions. All are async.</p>
          {#each Object.entries(CALLS) as [k, v] (k)}
            <div class="fn">
              <code>{k}({v.example ?? ""})</code>
              <div class="muted">{v.doc}</div>
            </div>
          {/each}
          <div class="fn"><code>uart.passthrough(&#123; txd, rxd, baud &#125;)</code><div class="muted">Open the target console. Returns a handle for send / expect / read / close.</div></div>
          <div class="fn"><code>uart.expect(pt, /regex/, timeoutMs)</code><div class="muted">Wait for target output. Returns &#123; match, groups, before &#125;.</div></div>
          <div class="fn"><code>gpio.drive(value) / gpio.release(h)</code><div class="muted">Drive outputs until released.</div></div>
          <div class="fn"><code>term.send(text) / term.expect(re)</code><div class="muted">Raw access to the JTAGulator's own text UI.</div></div>
          <div class="fn"><code>target.get()</code><div class="muted">Known pins and findings for the current target.</div></div>
          <div class="fn"><code>sleep(ms) · log(...) · hex(n) · bytes([..])</code></div>
        </div>
      {/if}
    </div>
    <div class="console" bind:this={logEl}>
      {#each logs as l, i (i)}
        <div class="line {l.level}"><span class="faint">{new Date(l.at).toLocaleTimeString()}</span> <span>{l.level === "call" ? "→ " + l.text : l.text}</span></div>
      {:else}
        <div class="faint">Output appears here. Ctrl+Enter runs the script.</div>
      {/each}
    </div>
  </section>
</div>

<style>
  .scripts {
    display: grid;
    grid-template-columns: 230px 1fr;
    gap: 14px;
    height: 100%;
    min-height: 0;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px;
    min-height: 0;
    overflow: auto;
  }
  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px 8px;
  }
  .item {
    text-align: left;
    border: none;
    background: transparent;
    color: var(--text-muted);
    padding: 7px 9px;
    border-radius: 7px;
    font: 500 13px var(--font-sans);
    cursor: pointer;
  }
  .item:hover {
    background: var(--overlay);
    color: var(--text);
  }
  .item.active {
    background: var(--accent-soft);
    color: var(--text);
  }
  .item.new {
    font-style: italic;
  }
  .grow {
    flex: 1;
  }
  .folder {
    margin-top: 8px;
    font-size: 11px;
    display: flex;
    gap: 4px;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .main {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr 180px;
    min-height: 0;
    overflow: hidden;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .name {
    font-weight: 600;
    width: 260px;
    height: 28px;
    background: transparent;
    border-color: transparent;
  }
  .name:hover {
    border-color: var(--border-strong);
  }
  .split {
    display: flex;
    min-height: 0;
  }
  .code {
    flex: 1;
    min-width: 0;
  }
  .ref {
    width: 360px;
    border-left: 1px solid var(--border);
    overflow: auto;
    padding: 10px 12px;
    font-size: 12.5px;
  }
  .ref p {
    margin: 0 0 8px;
  }
  .fn {
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  .fn code {
    color: var(--sig-tdi);
    font-size: 12px;
  }
  .console {
    border-top: 1px solid var(--border);
    background: var(--bg);
    padding: 8px 12px;
    overflow: auto;
    font: 12px/1.6 var(--font-mono);
  }
  .line {
    white-space: pre-wrap;
  }
  .line.warn {
    color: var(--warn);
  }
  .line.error {
    color: var(--danger);
  }
  .line.call {
    color: var(--text-muted);
  }
  .line.done {
    color: var(--ok);
  }
  .line.info {
    color: var(--info);
  }
  @media (max-width: 860px) {
    .scripts {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto 1fr;
    }
    .list {
      max-height: 160px;
    }
    .ref {
      display: none;
    }
    .name {
      width: 100%;
      min-width: 0;
    }
    .toolbar {
      flex-wrap: wrap;
    }
  }
</style>
