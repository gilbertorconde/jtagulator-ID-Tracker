<script lang="ts">
  // Top-of-page warning in browsers that can't reach a JTAGulator (no Web Serial).
  import { TriangleAlert, X } from "@lucide/svelte";
  import { app } from "../stores/app.svelte";
  import { DOWNLOAD_URL } from "./DesktopOnly.svelte";

  let hidden = $state(sessionStorage.getItem("jts.browserNotice") === "hidden");
  const show = $derived(!app.tauri && !app.webSerial && !hidden);
  function hide() {
    hidden = true;
    sessionStorage.setItem("jts.browserNotice", "hidden");
  }
</script>

{#if show}
  <div class="notice" role="alert">
    <TriangleAlert size={16} />
    <div>
      <b>This browser can't connect to a JTAGulator.</b>
      It has no Web Serial support, which the app needs to reach the USB port. Open this page in <b>Chrome</b>, <b>Edge</b> or <b>Opera</b> on a desktop computer,
      or <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">download the desktop app</a>. The simulator works here.
    </div>
    <button class="btn icon ghost sm" title="Hide until this tab is closed" onclick={hide}><X size={14} /></button>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 12px 20px 0;
    padding: 10px 12px;
    border: 1px solid var(--warn);
    border-radius: 8px;
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    font-size: 13px;
    line-height: 1.45;
  }
  .notice > :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--warn);
  }
  .notice div {
    flex: 1;
  }
</style>
