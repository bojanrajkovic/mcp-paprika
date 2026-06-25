<script lang="ts">
  // The shared toast: positioned, animated, `role=status`, with an explicit `kind` (error is
  // danger-styled, info is neutral — no inverted default) and an optional action button (the pantry
  // Undo). Rendered as a child of WidgetShell's `<main>` so its absolute positioning anchors there.
  interface ToastModel {
    kind: "error" | "info";
    msg: string;
    action?: { label: string; fn: () => void };
  }
  let { toast }: { toast: ToastModel | null } = $props();
</script>

{#if toast}
  <div class="toast" class:error={toast.kind === "error"} role="status">
    <span class="tmsg">{toast.msg}</span>
    {#if toast.action}
      <button class="undo" onclick={toast.action.fn}
        >{toast.action.label}</button
      >
    {/if}
  </div>
{/if}

<style>
  .toast {
    position: absolute;
    left: 12px;
    right: 12px;
    top: calc(12px + env(safe-area-inset-top));
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--hover);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 13px;
    font-weight: 550;
    box-shadow: 0 8px 24px -12px oklch(0 0 0 / 0.5);
    animation: toastIn 0.2s ease-out;
  }
  .toast.error {
    background: var(--danger-bg);
    color: var(--danger);
    border-color: color-mix(in oklch, var(--danger) 40%, transparent);
  }
  .tmsg {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .undo {
    flex: none;
    color: var(--accent);
    font-weight: 700;
    padding: 2px 4px;
  }
  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
