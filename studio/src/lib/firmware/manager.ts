// Firmware management on top of the loader: probing the EEPROM, installing
// firmware, writing the manufacturer database, and finding updates.
import { invoke } from "@tauri-apps/api/core";
import { latin1 } from "../core/transport";
import { isTauri } from "../core/transports/tauri";
import { loadPropeller, type DtrTransport, type LoadMode, type LoadProgress } from "./loader";
import probeUrl from "./assets/eeprom-probe.binary?url";
import updaterUrl from "./assets/eeprom-update.binary?url";
import firmwareUrl from "./assets/jtagulator.binary?url";

export const BUNDLED = { firmware: firmwareUrl, updater: updaterUrl, probe: probeUrl };
/** Version of the bundled ID Tracker firmware (built from this repository). */
export const BUNDLED_VERSION = "1.4";

export async function fetchAsset(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reset the Propeller so it boots the firmware stored in EEPROM. */
export async function resetBoard(t: DtrTransport) {
  await t.setDtr(true);
  await sleep(10);
  await t.setDtr(false);
}

/** Collect text from the transport until `done` matches or the timeout passes. */
function collect(t: DtrTransport, done: RegExp, timeoutMs: number, onText?: (all: string) => void): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    const timer = setTimeout(finish, timeoutMs);
    const unsub = t.onData((d) => {
      out += latin1(d);
      onText?.(out);
      if (done.test(out)) finish();
    });
    function finish() {
      clearTimeout(timer);
      unsub();
      resolve(out);
    }
  });
}

export interface DatabaseStatus {
  /** Completion flag written by the database writer (0x5A when complete). */
  flag: number;
  complete: boolean;
  /** Names read back from three known slots; null when the slot is blank. */
  samples: { amd: string | null; arm: string | null; st: string | null };
  /** Stored operating mode long (0 normal, 1 logic analyzer, 2 OpenOCD). */
  mode: number;
}

export function parseProbe(text: string): DatabaseStatus | null {
  const m = text.match(/JTS-PROBE flag=([0-9A-F]{2}) mode=(-?\d+) vtarget=(-?\d+) amd=(\S*) arm=(\S*) st=(\S*) end/);
  if (!m) return null;
  // The probe prints spaces and unprintable bytes as "_" (the line is space
  // separated); an erased slot (all 0xFF) comes out as only underscores.
  const name = (s: string) => {
    const n = s.replace(/_/g, " ").trim();
    return n || null;
  };
  const flag = parseInt(m[1], 16);
  return { flag, complete: flag === 0x5a, samples: { amd: name(m[4]), arm: name(m[5]), st: name(m[6]) }, mode: +m[2] };
}

/** Run the probe from RAM (nothing is written), read the result, reset the board. */
export async function probeDatabase(t: DtrTransport, onProgress?: (p: LoadProgress) => void): Promise<DatabaseStatus> {
  const image = await fetchAsset(BUNDLED.probe);
  const out = collect(t, /JTS-PROBE .* end/, 8000);
  try {
    await loadPropeller(t, image, "ram", onProgress);
    const status = parseProbe(await out);
    if (!status) throw new Error("The probe didn't report back");
    return status;
  } finally {
    await resetBoard(t);
  }
}

/** Load firmware into RAM (test run until reset) or program it into EEPROM. */
export async function installFirmware(t: DtrTransport, image: Uint8Array, mode: LoadMode, onProgress?: (p: LoadProgress) => void) {
  return loadPropeller(t, image, mode, onProgress);
}

export interface DatabaseProgress {
  phase: "loading" | "clearing" | "writing" | "verifying" | "done";
  percent: number;
  log: string;
}

/**
 * Write the manufacturer database into the upper 32 KB of the EEPROM by running
 * the database writer from RAM. The firmware in the lower half is untouched.
 * Takes about 20 minutes.
 */
export async function writeDatabase(
  t: DtrTransport,
  onProgress: (p: DatabaseProgress) => void,
  signal?: AbortSignal,
): Promise<{ result: "success" | "errors" | "already"; log: string }> {
  const image = await fetchAsset(BUNDLED.updater);
  onProgress({ phase: "loading", percent: 0, log: "" });
  let log = "";
  const done = new Promise<string>((resolve, reject) => {
    const unsub = t.onData((d) => {
      log += latin1(d);
      const phase = /Verifying:/.test(log) ? "verifying" : /Writing:/.test(log) ? "writing" : /Clearing EEPROM/.test(log) ? "clearing" : "loading";
      const pct = [...log.matchAll(/Percent: (\d+)%/g)].pop();
      onProgress({ phase, percent: pct ? +pct[1] : 0, log });
      if (/Press any key/.test(log)) {
        unsub();
        resolve(log);
      }
    });
    signal?.addEventListener("abort", () => {
      unsub();
      reject(new Error("Stopped. The database is incomplete; run it again to finish."));
    });
  });
  try {
    await loadPropeller(t, image, "ram");
    const text = await done;
    const result = /Already programmed/.test(text) ? "already" : /Result: Success/.test(text) ? "success" : "errors";
    onProgress({ phase: "done", percent: 100, log: text });
    return { result, log: text };
  } finally {
    await resetBoard(t);
  }
}

// ------------------------------------------------------------------ updates

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface FirmwareRelease {
  tag: string;
  name: string;
  version: string | null;
  published: string;
  notes: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
}

async function httpGet(url: string, accept?: string): Promise<Uint8Array> {
  if (isTauri()) return Uint8Array.from(await invoke<number[]>("http_get", { url, accept }));
  const r = await fetch(url, { headers: accept ? { Accept: accept } : {} });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Releases of `repo` ("owner/name") that carry a .binary or .eeprom file, newest first. */
export async function listFirmwareReleases(repo: string): Promise<FirmwareRelease[]> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Repository must look like owner/name");
  const body = await httpGet(`https://api.github.com/repos/${repo}/releases?per_page=20`, "application/vnd.github+json");
  const list = JSON.parse(new TextDecoder().decode(body)) as {
    tag_name: string;
    name: string | null;
    published_at: string;
    body: string | null;
    html_url: string;
    draft: boolean;
    assets: { name: string; url: string; browser_download_url: string; size: number }[];
  }[];
  return list
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      version: r.tag_name.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null,
      published: r.published_at,
      notes: r.body ?? "",
      htmlUrl: r.html_url,
      assets: r.assets
        .filter((a) => /\.(binary|eeprom)$/i.test(a.name))
        .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    }))
    .filter((r) => r.assets.length);
}

export function downloadAsset(a: ReleaseAsset) {
  return httpGet(a.url, "application/octet-stream");
}

/** -1 / 0 / 1 comparing dotted versions ("1.12" > "1.3"). */
export function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
