// Save / open text files: native dialogs in the desktop app, download/upload in a browser.
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./core/transports/tauri";

export async function saveTextAs(defaultName: string, text: string, ext: string): Promise<string | null> {
  if (isTauri()) {
    const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    await invoke("write_text_file", { path, contents: text });
    return path;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: defaultName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return defaultName;
}

export async function openText(ext: string | string[]): Promise<string | null> {
  return (await openTextFile(ext))?.text ?? null;
}

/** Pick a text file; returns its name and contents, or null if cancelled. */
export async function openTextFile(ext: string | string[]): Promise<{ name: string; text: string } | null> {
  const exts = Array.isArray(ext) ? ext : [ext];
  if (isTauri()) {
    const path = await open({ multiple: false, filters: [{ name: exts.join(", ").toUpperCase(), extensions: exts }] });
    if (!path || Array.isArray(path)) return null;
    return { name: path.split(/[\\/]/).pop() ?? path, text: await invoke<string>("read_text_file", { path }) };
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: exts.map((e) => "." + e).join(",") });
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

/** Pick a binary file. Returns its name and bytes, or null if cancelled. */
export async function openBytes(exts: string[]): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (isTauri()) {
    const path = await open({ multiple: false, filters: [{ name: exts.join(", "), extensions: exts }] });
    if (!path || Array.isArray(path)) return null;
    const data = await invoke<number[]>("read_binary_file", { path });
    return { name: path.split(/[\\/]/).pop() ?? path, bytes: Uint8Array.from(data) };
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: exts.map((e) => "." + e).join(",") });
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.click();
  });
}
