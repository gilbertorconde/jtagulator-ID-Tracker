// In-app updates for the desktop app (Tauri updater). Releases publish a signed
// latest.json; the app checks it, downloads the installer for this platform,
// verifies the signature, installs it and restarts.
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

type Status = "idle" | "checking" | "none" | "available" | "downloading" | "installing" | "error";

class Updates {
  status = $state<Status>("idle");
  version = $state<string | null>(null);
  notes = $state<string | null>(null);
  date = $state<string | null>(null);
  /** 0..1 while downloading (null when the size is unknown). */
  progress = $state<number | null>(null);
  error = $state<string | null>(null);
  checkedAt = $state<number | null>(null);
  private update: Update | null = null;

  /** Ask the release feed for a newer version. Returns true when one is available. */
  async check(): Promise<boolean> {
    if (this.status === "checking" || this.status === "downloading" || this.status === "installing") return this.status !== "checking";
    this.status = "checking";
    this.error = null;
    try {
      this.update = await check({ timeout: 15000 });
      this.checkedAt = Date.now();
      if (!this.update) {
        this.status = "none";
        return false;
      }
      this.version = this.update.version;
      this.notes = this.update.body ?? null;
      this.date = this.update.date ?? null;
      this.status = "available";
      return true;
    } catch (e) {
      this.status = "error";
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /** Download, verify and install the update, then restart the app. */
  async install() {
    const u = this.update;
    if (!u) return;
    this.status = "downloading";
    this.progress = 0;
    let total = 0;
    let got = 0;
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          this.progress = total ? got / total : null;
        } else if (ev.event === "Finished") this.status = "installing";
      });
      await relaunch();
    } catch (e) {
      this.status = "error";
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}

export const updates = new Updates();
