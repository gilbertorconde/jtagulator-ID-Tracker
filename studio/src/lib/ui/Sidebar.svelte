<script lang="ts">
  import { Cable, Code2, Cpu, LayoutDashboard, Layers, ListChecks, Settings, ToggleRight, Waves, Zap } from "@lucide/svelte";
  import { app, type View } from "../stores/app.svelte";

  export const NAV: { id: View; label: string; icon: typeof Cpu }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "all", label: "Scan all", icon: Layers },
    { id: "jtag", label: "JTAG", icon: Cpu },
    { id: "swd", label: "SWD", icon: Zap },
    { id: "uart", label: "UART", icon: Cable },
    { id: "gpio", label: "GPIO", icon: ToggleRight },
    { id: "logic", label: "Logic analyzer", icon: Waves },
    { id: "scripts", label: "Scripts", icon: Code2 },
    { id: "findings", label: "Target & findings", icon: ListChecks },
  ];
</script>

<nav class="sidebar" class:open={app.navOpen}>
  <div class="brand">
    <div class="logo">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /><circle cx="12" cy="12" r="2.5" />
      </svg>
    </div>
    <div>
      <div class="name">JTAGulator</div>
      <div class="sub">Studio</div>
    </div>
  </div>
  {#each NAV as item, i (item.id)}
    <button class="nav" class:active={app.view === item.id} onclick={() => ((app.view = item.id), (app.navOpen = false))} title="Ctrl+{i + 1}">
      <item.icon size={16} />
      <span>{item.label}</span>
      {#if item.id === "findings" && app.target.findings.length}<span class="count">{app.target.findings.length}</span>{/if}
    </button>
  {/each}
  <div class="grow"></div>
  <button class="nav" class:active={app.view === "settings"} onclick={() => ((app.view = "settings"), (app.navOpen = false))}>
    <Settings size={16} /><span>Settings</span>
  </button>
</nav>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 10px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    width: 212px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 16px;
  }
  .logo {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    color: white;
    background: linear-gradient(135deg, var(--accent-strong), #6d28d9);
    box-shadow: 0 4px 14px rgb(139 92 246 / 0.35);
  }
  .name {
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .sub {
    font-size: 11px;
    color: var(--text-faint);
    margin-top: -2px;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    font: 500 13px var(--font-sans);
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }
  .nav:hover {
    background: var(--overlay);
    color: var(--text);
  }
  .nav.active {
    background: var(--accent-soft);
    color: var(--text);
  }
  .nav.active :global(svg) {
    color: var(--accent);
  }
  .count {
    margin-left: auto;
    font-size: 11px;
    padding: 0 6px;
    border-radius: 10px;
    background: var(--overlay);
    color: var(--text-muted);
  }
  .grow {
    flex: 1;
  }
  @media (max-width: 860px) {
    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 40;
      width: 250px;
      transform: translateX(-100%);
      transition: transform 0.2s var(--ease);
      box-shadow: var(--shadow);
    }
    .sidebar.open {
      transform: none;
    }
  }
</style>
