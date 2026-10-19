<script lang="ts">
  import type { Snippet } from "svelte";
  interface Props {
    title: string;
    subtitle?: string;
    badge?: string;
    children: Snippet;
    footer?: Snippet;
    aside?: Snippet;
  }
  let { title, subtitle, badge, children, footer, aside }: Props = $props();
</script>

<section class="card panel">
  <header>
    <div>
      <h3>{title} {#if badge}<span class="badge">{badge}</span>{/if}</h3>
      {#if subtitle}<p>{subtitle}</p>{/if}
    </div>
    {#if aside}<div class="aside">{@render aside()}</div>{/if}
  </header>
  <div class="body">{@render children()}</div>
  {#if footer}<footer>{@render footer()}</footer>{/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px 0;
  }
  h3 {
    font-size: 14.5px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  p {
    margin: 3px 0 0;
    color: var(--text-muted);
    font-size: 12.5px;
    max-width: 70ch;
  }
  .body {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
  }
</style>
