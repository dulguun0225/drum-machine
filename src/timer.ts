// Scheduler tick. A Worker created from a Blob URL keeps ticking at 25 ms when the tab is in
// the background (main-thread timers are throttled there); setTimeout is the fallback when the
// Worker cannot be created or reports an error.

export const TICK_MS = 25;

const WORKER_SOURCE = `
let id = null;
onmessage = (e) => {
  if (e.data === "start" && id === null) id = setInterval(() => postMessage("tick"), ${TICK_MS});
  if (e.data === "stop") { clearInterval(id); id = null; }
};
`;

export interface Ticker {
  start(): void;
  stop(): void;
}

export function createTicker(onTick: () => void): Ticker {
  let running = false;
  let timeout: number | undefined;
  let worker: Worker | null = null;

  const loop = () => {
    onTick();
    timeout = window.setTimeout(loop, TICK_MS);
  };

  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    worker = new Worker(url);
    worker.onmessage = () => {
      if (running) onTick();
    };
    worker.onerror = () => {
      worker = null;
      if (running && timeout === undefined) timeout = window.setTimeout(loop, TICK_MS);
    };
  } catch {
    worker = null;
  }

  return {
    start() {
      running = true;
      if (worker) worker.postMessage("start");
      else if (timeout === undefined) timeout = window.setTimeout(loop, TICK_MS);
    },
    stop() {
      running = false;
      worker?.postMessage("stop");
      clearTimeout(timeout);
      timeout = undefined;
    },
  };
}
