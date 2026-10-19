<script lang="ts">
  import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "@lucide/svelte";
  import { app } from "../stores/app.svelte";
</script>

<div class="toasts">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.level}">
      <span class="ic">
        {#if t.level === "ok"}<CircleCheck size={16} />{:else if t.level === "error"}<CircleAlert size={16} />{:else if t.level === "warn"}<TriangleAlert size={16} />{:else}<Info size={16} />{/if}
      </span>
      <div class="txt">
        <div class="title">{t.title}</div>
        {#if t.detail}<div class="detail">{t.detail}</div>{/if}
      </div>
      <button class="btn ghost sm icon" onclick={() => app.dismiss(t.id)}><X size={12} /></button>
    </div>
  {/each}
</div>

{#if app.dialog}
  {@const d = app.dialog}
  <div class="backdrop" role="presentation" onclick={() => d.resolve(false)}>
    <div class="card dialog" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === "Escape" && d.resolve(false)}>
      <h3>{d.title}</h3>
      <p>{d.body}</p>
      <div class="buttons">
        <button class="btn" onclick={() => d.resolve(false)}>Cancel</button>
        <!-- svelte-ignore a11y_autofocus -->
        <button class="btn {d.danger ? 'danger' : 'primary'}" autofocus onclick={() => d.resolve(true)}>{d.ok}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .toasts {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 50;
    width: min(360px, calc(100vw - 32px));
  }
  .toast {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 8px 10px 12px;
    background: var(--overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    animation: in 0.2s var(--ease);
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  .ic {
    display: flex;
    margin-top: 1px;
  }
  .ok .ic {
    color: var(--ok);
  }
  .error .ic {
    color: var(--danger);
  }
  .warn .ic {
    color: var(--warn);
  }
  .info .ic {
    color: var(--info);
  }
  .txt {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 600;
  }
  .detail {
    font-size: 12.5px;
    color: var(--text-muted);
    word-break: break-word;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.45);
    display: grid;
    place-items: center;
    z-index: 60;
    animation: fade 0.15s;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .dialog {
    width: min(420px, calc(100vw - 32px));
    padding: 18px 20px;
    box-shadow: var(--shadow);
  }
  .dialog p {
    color: var(--text-muted);
    white-space: pre-wrap;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
