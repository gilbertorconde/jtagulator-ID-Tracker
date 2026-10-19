// Saved BSDL files: <app data>/bsdl in the desktop app, localStorage in a browser.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../core/transports/tauri";
import { parseBsdl, type BsdlFile } from "./parser";

export interface BsdlEntry {
  /** File name, unique in the library. */
  name: string;
  file: BsdlFile;
}

const LS = "jts.bsdl";
const safe = (name: string) => name.replace(/[^\w.\- ]+/g, "_");

async function dir() {
  return invoke<string>("app_dir", { sub: "bsdl" });
}

export async function loadLibrary(): Promise<BsdlEntry[]> {
  const raw: { name: string; text: string }[] = [];
  if (isTauri()) {
    const d = await dir();
    const entries = await invoke<{ name: string; path: string }[]>("list_dir", { path: d });
    for (const e of entries) raw.push({ name: e.name, text: await invoke<string>("read_text_file", { path: e.path }) });
  } else {
    raw.push(...(JSON.parse(localStorage.getItem(LS) ?? "[]") as { name: string; text: string }[]));
  }
  const out: BsdlEntry[] = [];
  for (const r of raw) {
    try {
      out.push({ name: r.name, file: parseBsdl(r.text) });
    } catch {
      /* skip files that no longer parse */
    }
  }
  return out.sort((a, b) => a.file.entity.localeCompare(b.file.entity));
}

/** Parse and save a BSDL file. Throws if it isn't valid BSDL. */
export async function addToLibrary(name: string, text: string): Promise<BsdlEntry> {
  const file = parseBsdl(text);
  const n = safe(name);
  if (isTauri()) {
    await invoke("write_text_file", { path: `${await dir()}/${n}`, contents: text });
  } else {
    const all = (JSON.parse(localStorage.getItem(LS) ?? "[]") as { name: string; text: string }[]).filter((e) => e.name !== n);
    all.push({ name: n, text });
    localStorage.setItem(LS, JSON.stringify(all));
  }
  return { name: n, file };
}

export async function removeFromLibrary(name: string) {
  if (isTauri()) {
    await invoke("delete_file", { path: `${await dir()}/${safe(name)}` });
  } else {
    const all = (JSON.parse(localStorage.getItem(LS) ?? "[]") as { name: string; text: string }[]).filter((e) => e.name !== name);
    localStorage.setItem(LS, JSON.stringify(all));
  }
}
