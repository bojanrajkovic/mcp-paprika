<script>
  import { onMount } from "svelte";

  // The ext-apps App instance, constructed in main.ts and handed in as a prop.
  let { app } = $props();

  let payload = $state(undefined);
  let connected = $state(false);

  onMount(() => {
    // Handlers must be registered BEFORE connect() completes the handshake.
    app.ontoolresult = (result) => {
      const text = result?.content?.[0]?.text;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { error: "Tool result was not valid JSON", raw: text };
      }
    };
    Promise.resolve(app.connect()).then(() => {
      connected = true;
    });
  });

  function sendAction() {
    app.sendMessage({
      role: "user",
      content: [{ type: "text", text: "Demo widget button was clicked." }],
    });
  }
</script>

<main>
  <h1>mcp-paprika widget demo</h1>
  <p class="status" class:connected>{connected ? "Connected to host" : "Connecting…"}</p>

  {#if payload === undefined}
    <p class="empty">Waiting for a tool result…</p>
  {:else}
    <pre>{JSON.stringify(payload, null, 2)}</pre>
    <button onclick={sendAction}>Send a demo action</button>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    color-scheme: light dark;
  }
  main {
    padding: 1rem;
    font-size: 14px;
    line-height: 1.5;
  }
  h1 {
    font-size: 1rem;
    margin: 0 0 0.5rem;
  }
  .status {
    font-size: 0.8rem;
    color: #888;
    margin: 0 0 0.75rem;
  }
  .status.connected {
    color: #2e7d32;
  }
  .empty {
    color: #888;
  }
  pre {
    margin: 0;
    padding: 0.75rem;
    border-radius: 6px;
    background: rgba(127, 127, 127, 0.12);
    overflow-x: auto;
  }
  button {
    margin-top: 0.75rem;
    padding: 0.5rem 0.9rem;
    border: 0;
    border-radius: 6px;
    background: #2d6cdf;
    color: #fff;
    font: inherit;
    cursor: pointer;
  }
</style>
