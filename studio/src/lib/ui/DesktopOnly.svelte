<script lang="ts" module>
  export const DOWNLOAD_URL = "https://github.com/gilbertorconde/pinhound/releases/latest";
</script>

<script lang="ts">
  // Shown in the web version in place of features that need the desktop app.
  import { MonitorDown } from "@lucide/svelte";

  let { feature, why = "a web page can't start programs on your computer" }: { feature: string; why?: string } = $props();
</script>

<div class="desktop-only">
  <MonitorDown size={15} />
  <span>
    <b>{feature}</b> needs the desktop app: {why}.
    <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Download PinHound Studio</a> for Windows, macOS or Linux.
  </span>
</div>

<style>
  .desktop-only {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 12.5px;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px dashed var(--border);
    border-radius: 6px;
    padding: 8px 10px;
  }
  .desktop-only :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--accent);
  }
</style>
