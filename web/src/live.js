// Live mode. In the app, Claude Code's own events arrive from the listener
// (src-tauri/src/listener.rs), already trimmed to the fields the world reads,
// so the world takes them exactly like the demo's. On the demo web page there
// is no app around and this does nothing.

export function listenForClaude(onEvent) {
  const events = globalThis.__TAURI__?.event;
  if (!events) return false;
  events.listen('claude-hook', (message) => onEvent(message.payload));
  return true;
}
