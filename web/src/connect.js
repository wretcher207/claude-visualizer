// The connection panel, in the app only. It says what was added to Claude
// Code's settings (with OK and Undo), offers to remove the old Claude
// Visualizer's hooks, or says why nothing could be changed. The app does the
// work (src-tauri/src/connection.rs).

export async function showConnection() {
  const core = globalThis.__TAURI__?.core;
  if (!core) return;
  const $ = (id) => document.getElementById(id);
  const panel = $('connect');
  const cards = { problem: $('connect-problem'), added: $('connect-added'), old: $('connect-old') };
  let status = await core.invoke('claude_connection');
  let dismissed = null; // the problem already seen

  function show() {
    const card = status.problem && status.problem !== dismissed ? 'problem'
      : status.just_added ? 'added'
      : status.old_hooks > 0 ? 'old'
      : null;
    for (const [name, el] of Object.entries(cards)) el.hidden = name !== card;
    panel.hidden = card === null;
    if (card === 'problem') $('connect-problem-text').textContent = status.problem;
    if (card === 'old') $('connect-old-count').textContent = status.old_hooks === 1 ? '1 hook' : `${status.old_hooks} hooks`;
    if (card) cards[card].querySelector('.connect-actions button:last-child').focus({ preventScroll: true });
  }

  panel.addEventListener('click', async (e) => {
    const choice = e.target.closest('button')?.dataset.choice;
    if (!choice) return;
    if (choice === 'dismiss') dismissed = status.problem;
    else status = await core.invoke('claude_answer', { choice });
    show();
  });
  show();
}
