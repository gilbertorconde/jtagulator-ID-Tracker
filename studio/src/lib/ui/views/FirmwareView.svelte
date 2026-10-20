<script lang="ts">
  import { CircleCheck, CircleAlert, Database, Download, FileUp, HardDriveDownload, Package, RefreshCw, Search, Square, TestTube } from "@lucide/svelte";
  import { openBytes } from "../../files";
  import { describeImage, type LoadMode, type LoadProgress } from "../../firmware/loader";
  import {
    BUNDLED,
    BUNDLED_VERSION,
    compareVersions,
    downloadAsset,
    fetchAsset,
    installFirmware,
    listFirmwareReleases,
    probeDatabase,
    writeDatabase,
    type DatabaseProgress,
    type DatabaseStatus,
    type FirmwareRelease,
    type ReleaseAsset,
  } from "../../firmware/manager";
  import { app } from "../../stores/app.svelte";
  import Field from "../Field.svelte";
  import Panel from "../Panel.svelte";
  import Tabs from "../Tabs.svelte";

  type Source = "bundled" | "releases" | "file";
  interface Picked {
    label: string;
    bytes: Uint8Array;
    info: ReturnType<typeof describeImage>;
  }

  let source = $state<Source>("bundled");
  let picked = $state<Picked | null>(null);
  let loadProgress = $state<LoadProgress | null>(null);
  let lastInstall = $state<{ mode: LoadMode; label: string; at: number } | null>(null);

  let releases = $state<FirmwareRelease[] | null>(null);
  let checking = $state(false);
  let downloading = $state<string | null>(null);

  let db = $state<DatabaseStatus | null>(null);
  let dbProgress = $state<DatabaseProgress | null>(null);
  let dbCtl: AbortController | null = null;

  const device = $derived(app.info);
  const variant = $derived(!device ? null : device.idTracker ? "ID Tracker" : "Stock");
  const busy = $derived(!!app.firmwareBusy);
  const why = $derived(
    app.status !== "connected"
      ? "Connect a JTAGulator first."
      : app.transportKind === "sim"
        ? "The simulator can't be flashed. Connect a real JTAGulator."
        : !app.canFlash
          ? "This connection can't control the reset line."
          : null,
  );
  const updateAvailable = $derived(
    !!device?.idTracker && !!device.version && compareVersions(BUNDLED_VERSION, device.version) > 0,
  );

  async function pickBundled() {
    try {
      const bytes = await fetchAsset(BUNDLED.firmware);
      picked = { label: `ID Tracker ${BUNDLED_VERSION} (bundled)`, bytes, info: describeImage(bytes) };
    } catch (e) {
      app.error(e, "Bundled firmware");
    }
  }

  async function pickFile() {
    try {
      const f = await openBytes(["binary", "eeprom"]);
      if (!f) return;
      picked = { label: f.name, bytes: f.bytes, info: describeImage(f.bytes) };
    } catch (e) {
      app.error(e, "Firmware file");
    }
  }

  async function checkReleases() {
    checking = true;
    try {
      releases = await listFirmwareReleases(app.settings.firmwareRepo.trim());
      if (!releases.length) app.toast("info", "No firmware releases", `${app.settings.firmwareRepo} has no releases with .binary or .eeprom files.`);
    } catch (e) {
      app.error(e, "Checking for updates");
    } finally {
      checking = false;
    }
  }

  async function pickAsset(r: FirmwareRelease, a: ReleaseAsset) {
    downloading = a.url;
    try {
      const bytes = await downloadAsset(a);
      picked = { label: `${a.name} (${r.tag})`, bytes, info: describeImage(bytes) };
    } catch (e) {
      app.error(e, "Download");
    } finally {
      downloading = null;
    }
  }

  $effect(() => {
    if (source === "bundled" && !picked) void pickBundled();
  });

  async function install(mode: LoadMode) {
    if (!picked) return;
    const p = picked;
    if (mode === "eeprom") {
      const ok = await app.ask(
        "Install firmware",
        `Write “${p.label}” (${p.info.firmware ?? "unknown firmware"}) to the JTAGulator's EEPROM?\n\nThis replaces the current firmware. The manufacturer database in the upper half of the EEPROM is kept. Don't unplug the JTAGulator while it's writing.`,
        "Install",
        true,
      );
      if (!ok) return;
    }
    try {
      await app.firmwareTask(mode === "ram" ? "Test run" : "Firmware install", (t) => installFirmware(t, p.bytes, mode, (pr) => (loadProgress = pr)));
      lastInstall = { mode, label: p.label, at: Date.now() };
      app.toast("ok", mode === "ram" ? "Running from RAM" : "Firmware installed", mode === "ram" ? "It runs until the next reset or power cycle." : p.info.firmware ?? p.label);
    } catch (e) {
      app.error(e, "Firmware");
    } finally {
      loadProgress = null;
    }
  }

  async function checkDatabase() {
    try {
      db = await app.firmwareTask("Database check", (t) => probeDatabase(t, (pr) => (loadProgress = pr)));
    } catch (e) {
      app.error(e, "Database check");
    } finally {
      loadProgress = null;
    }
  }

  async function writeDb() {
    const ok = await app.ask(
      "Write manufacturer database",
      "Writes the 1,953-entry JEP106 manufacturer table into the upper 32 KB of the EEPROM. It takes about 20 minutes. The firmware isn't touched, but the saved operating mode and voltage are reset.\n\nKeep the JTAGulator plugged in until it finishes.",
      "Write database",
    );
    if (!ok) return;
    dbCtl = new AbortController();
    try {
      const r = await app.firmwareTask("Database write", (t) => writeDatabase(t, (p) => (dbProgress = p), dbCtl!.signal));
      if (r.result === "already") app.toast("info", "Database already written", "The completion flag is set, so the writer skipped it.");
      else if (r.result === "success") app.toast("ok", "Database written and verified");
      else app.toast("error", "Database written with errors", "Run it again; if it keeps failing the EEPROM may be faulty.");
      void checkDatabase();
    } catch (e) {
      app.error(e, "Database write");
    } finally {
      dbCtl = null;
    }
  }

  const PHASE: Record<LoadProgress["phase"], string> = {
    reset: "Resetting",
    handshake: "Finding the Propeller",
    sending: "Sending",
    checksum: "Checking",
    programming: "Writing EEPROM",
    verifying: "Verifying",
    done: "Done",
  };
  const DB_PHASE: Record<DatabaseProgress["phase"], string> = {
    loading: "Starting",
    clearing: "Clearing",
    writing: "Writing",
    verifying: "Verifying",
    done: "Done",
  };
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
</script>

<div class="view">
  {#if why}
    <div class="note warn">{why} Firmware tools need a real JTAGulator over USB{app.tauri ? "" : " (Chrome, Edge or Opera in a browser)"}.</div>
  {/if}

  <div class="cols">
    <Panel title="Your JTAGulator">
      {#snippet aside()}
        {#if variant}<span class="badge {device?.idTracker ? 'accent' : ''}">{variant}</span>{/if}
      {/snippet}
      {#if device}
        <div class="big mono">{device.firmware}</div>
        <div class="muted small">{device.lines.slice(1).join(" · ")}</div>
      {:else}
        <div class="muted">{app.status === "connected" ? "Firmware version not read yet." : "Not connected."}</div>
      {/if}
      {#if updateAvailable}
        <div class="note ok"><HardDriveDownload size={14} /> ID Tracker {BUNDLED_VERSION} is available (you have {device?.version}).</div>
      {:else if device && !device.idTracker}
        <div class="note info">
          Stock firmware. ID Tracker adds manufacturer names to JTAG and SWD results; this app decodes them either way.
        </div>
      {/if}

      <div class="dbline">
        <Database size={15} />
        <span class="grow">
          Manufacturer database:
          {#if !db}<span class="muted">not checked</span>
          {:else if db.complete && db.samples.arm}<b class="okc">present</b> <span class="muted">(e.g. “{db.samples.arm}”, “{db.samples.st}”)</span>
          {:else if db.samples.arm}<b class="warnc">partial</b> <span class="muted">(names found, completion flag missing)</span>
          {:else}<b class="badc">missing</b>{/if}
        </span>
        <button class="btn sm" disabled={!!why || busy} onclick={checkDatabase}><Search size={13} /> Check</button>
      </div>
      <div class="faint small">The check runs a small program from RAM; nothing is written. The board restarts afterwards.</div>
    </Panel>

    <Panel title="Install firmware" subtitle="Test-run firmware from RAM (gone after a reset) or install it to EEPROM.">
      <Tabs
        tabs={[
          { id: "bundled", label: "Bundled" },
          { id: "releases", label: "GitHub releases" },
          { id: "file", label: "From file" },
        ]}
        bind:value={source}
      />

      {#if source === "bundled"}
        <div class="muted small">ID Tracker {BUNDLED_VERSION}, built from this repository and shipped with the app.</div>
        {#if !picked || !picked.label.includes("bundled")}
          <button class="btn sm" onclick={pickBundled}><Package size={13} /> Use bundled firmware</button>
        {/if}
      {:else if source === "releases"}
        <div class="row">
          <Field label="Repository">
            <input class="input mono" bind:value={app.settings.firmwareRepo} placeholder="owner/name" />
          </Field>
          <button class="btn" onclick={checkReleases} disabled={checking}><RefreshCw size={13} /> {checking ? "Checking…" : "Check for updates"}</button>
        </div>
        {#if releases && !releases.length}
          <div class="faint small">No releases with firmware files in {app.settings.firmwareRepo} yet.</div>
        {/if}
        {#if releases}
          <div class="releases">
            {#each releases as r (r.tag)}
              <div class="rel">
                <div class="rel-head">
                  <b>{r.name}</b>
                  <span class="faint small">{new Date(r.published).toLocaleDateString()}</span>
                  {#if r.version && device?.idTracker && device.version && compareVersions(r.version, device.version) > 0}<span class="badge ok">newer</span>{/if}
                  <a class="small" href={r.htmlUrl} target="_blank" rel="noreferrer">notes</a>
                </div>
                <div class="assets">
                  {#each r.assets as a (a.url)}
                    <button class="btn sm" disabled={!!downloading} onclick={() => pickAsset(r, a)}>
                      <Download size={12} /> {downloading === a.url ? "Downloading…" : `${a.name} · ${kb(a.size)}`}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <button class="btn" onclick={pickFile}><FileUp size={13} /> Open .binary or .eeprom…</button>
        <div class="faint small">Any Propeller image built for the JTAGulator, e.g. from Propeller Tool or OpenSpin.</div>
      {/if}

      {#if picked}
        <div class="picked">
          <div><b>{picked.label}</b></div>
          <div class="mono small">{picked.info.firmware ?? "Not a recognized JTAGulator firmware"} · {kb(picked.info.bytes)}</div>
          {#if !picked.info.firmware}<div class="warnc small">This image doesn't contain a JTAGulator version string. Only install it if you know what it is.</div>{/if}
        </div>
      {/if}

      {#if loadProgress}
        <div class="progress">
          <span>{PHASE[loadProgress.phase]}</span>
          <div class="bar"><div style:width="{(loadProgress.phase === 'sending' ? loadProgress.fraction : loadProgress.phase === 'done' ? 1 : loadProgress.phase === 'reset' || loadProgress.phase === 'handshake' ? 0.02 : 1) * 100}%"></div></div>
        </div>
      {:else if lastInstall}
        <div class="note ok small">
          <CircleCheck size={14} />
          {lastInstall.mode === "ram" ? "Running" : "Installed"} {lastInstall.label} at {new Date(lastInstall.at).toLocaleTimeString()}{lastInstall.mode === "ram" ? ". Reset or replug to go back to the installed firmware." : "."}
        </div>
      {/if}

      {#snippet footer()}
        <button class="btn" disabled={!picked || !!why || busy} onclick={() => install("ram")} title="Load into RAM and run. Nothing is written; a reset brings back the installed firmware.">
          <TestTube size={13} /> Test run (RAM)
        </button>
        <button class="btn primary" disabled={!picked || !!why || busy} onclick={() => install("eeprom")}>
          <HardDriveDownload size={13} /> Install to EEPROM
        </button>
      {/snippet}
    </Panel>

    <Panel title="Manufacturer database" subtitle="ID Tracker reads manufacturer names from the upper 32 KB of the EEPROM. Write it once; it survives firmware updates.">
      {#if dbProgress && busy}
        <div class="progress">
          <span>{DB_PHASE[dbProgress.phase]} {dbProgress.percent}%</span>
          <div class="bar"><div style:width="{dbProgress.phase === 'clearing' ? dbProgress.percent / 10 : dbProgress.phase === 'writing' ? 10 + dbProgress.percent * 0.45 : dbProgress.phase === 'verifying' ? 55 + dbProgress.percent * 0.45 : dbProgress.phase === 'done' ? 100 : 1}%"></div></div>
        </div>
        <pre class="log mono">{dbProgress.log.split(/\r?\n/).filter(Boolean).slice(-4).join("\n")}</pre>
      {:else if db && !db.complete}
        <div class="note warn small"><CircleAlert size={14} /> The database isn't on this JTAGulator yet.</div>
      {/if}
      <div class="faint small">
        The writer runs from RAM, so you don't have to flash it and then re-flash the main firmware. The
        names are only shown by ID Tracker firmware; this app shows them for any firmware.
      </div>
      {#snippet footer()}
        {#if busy && dbProgress}
          <button class="btn danger" onclick={() => dbCtl?.abort()}><Square size={12} /> Stop</button>
          <span class="muted small">Keep the JTAGulator plugged in.</span>
        {:else}
          <button class="btn" disabled={!!why || busy} onclick={writeDb}><Database size={13} /> Write database (~20 min)</button>
        {/if}
      {/snippet}
    </Panel>
  </div>
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr));
    gap: 14px;
    align-items: start;
  }
  .big {
    font-size: 15px;
    font-weight: 600;
  }
  .small {
    font-size: 12px;
  }
  .note {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 9px 12px;
    border-radius: var(--radius);
    font-size: 12.5px;
  }
  .note.warn {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .note.ok {
    background: var(--ok-soft);
    color: var(--ok);
  }
  .note.info {
    background: var(--info-soft);
    color: var(--text);
  }
  .dbline {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .okc {
    color: var(--ok);
  }
  .warnc {
    color: var(--warn);
  }
  .badc {
    color: var(--danger);
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .row :global(.field) {
    flex: 1;
  }
  .releases {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rel {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rel-head {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .assets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .picked {
    border: 1px solid var(--border);
    background: var(--raised);
    border-radius: var(--radius);
    padding: 9px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .progress {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12.5px;
    font-weight: 600;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--accent-soft);
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-strong), var(--accent));
    transition: width 0.3s var(--ease);
  }
  .log {
    margin: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11.5px;
    white-space: pre-wrap;
  }
</style>
