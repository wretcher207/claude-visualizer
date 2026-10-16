// A steady tick that keeps going when the window is hidden. Browsers slow
// page timers down in background tabs; timers inside a worker are left
// alone, so the worker just says "tick" and the page does the work.

export function createTicker(intervalMs, fn) {
  let worker = null;
  try {
    const src = `let id = null;
      onmessage = (e) => {
        clearInterval(id);
        if (e.data > 0) id = setInterval(() => postMessage(0), e.data);
      };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => fn();
    worker.postMessage(intervalMs);
    return { stop: () => worker.postMessage(0), kind: 'worker' };
  } catch {
    const id = setInterval(fn, intervalMs);
    return { stop: () => clearInterval(id), kind: 'timer' };
  }
}
