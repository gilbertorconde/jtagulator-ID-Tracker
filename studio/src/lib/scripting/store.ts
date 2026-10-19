// Script library. Files under <app data>/scripts in the desktop app, localStorage in a browser.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../core/transports/tauri";
import { EXAMPLES } from "./examples";

export interface ScriptFile {
  name: string;
  code: string;
  modified: number;
}

const LS = "jts.scripts";

async function dir() {
  return invoke<string>("app_dir", { sub: "scripts" });
}

const safe = (name: string) => name.replace(/[^\w.\- ]+/g, "_").replace(/\.js$/i, "") + ".js";

export async function listScripts(): Promise<ScriptFile[]> {
  if (isTauri()) {
    const d = await dir();
    let entries = await invoke<{ name: string; path: string; modified_ms: number }[]>("list_dir", { path: d });
    if (!entries.length) {
      for (const ex of EXAMPLES) await saveScript(ex.name, ex.code);
      entries = await invoke("list_dir", { path: d });
    }
    const files = await Promise.all(
      entries
        .filter((e) => e.name.endsWith(".js"))
        .map(async (e) => ({ name: e.name.replace(/\.js$/, ""), code: await invoke<string>("read_text_file", { path: e.path }), modified: e.modified_ms })),
    );
    return files;
  }
  const raw = localStorage.getItem(LS);
  if (!raw) {
    const seeded = EXAMPLES.map((e) => ({ ...e, modified: Date.now() }));
    localStorage.setItem(LS, JSON.stringify(seeded));
    return seeded;
  }
  return JSON.parse(raw);
}

export async function saveScript(name: string, code: string) {
  if (isTauri()) {
    const d = await dir();
    await invoke("write_text_file", { path: `${d}/${safe(name)}`, contents: code });
    return;
  }
  const all: ScriptFile[] = JSON.parse(localStorage.getItem(LS) ?? "[]");
  const i = all.findIndex((s) => s.name === name);
  const f = { name, code, modified: Date.now() };
  if (i >= 0) all[i] = f;
  else all.push(f);
  localStorage.setItem(LS, JSON.stringify(all));
}

export async function deleteScript(name: string) {
  if (isTauri()) {
    const d = await dir();
    await invoke("delete_file", { path: `${d}/${safe(name)}` });
    return;
  }
  const all: ScriptFile[] = JSON.parse(localStorage.getItem(LS) ?? "[]");
  localStorage.setItem(LS, JSON.stringify(all.filter((s) => s.name !== name)));
}

export async function scriptsFolder(): Promise<string | null> {
  return isTauri() ? dir() : null;
}
