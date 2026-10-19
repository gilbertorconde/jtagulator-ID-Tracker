<script lang="ts">
  import { Check, Copy } from "@lucide/svelte";
  let { text, title = "Copy" }: { text: string; title?: string } = $props();
  let done = $state(false);
  async function copy() {
    await navigator.clipboard.writeText(text).catch(() => {});
    done = true;
    setTimeout(() => (done = false), 1200);
  }
</script>

<button class="btn ghost sm icon" {title} onclick={copy}>
  {#if done}<Check size={13} />{:else}<Copy size={13} />{/if}
</button>
