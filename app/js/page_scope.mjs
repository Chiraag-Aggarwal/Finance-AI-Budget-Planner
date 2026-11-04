import { registerPageSave } from "./pending_saves.mjs";

// A page owns its listeners and timers. Leaving it must not leave old handlers
// running against removed form fields or a different signed-in account.
export function createPageScope(root) {
  const controller = new AbortController();
  const cleanups = [];
  const readyHandlers = [];
  return {
    getById(id) { return root.querySelector("#" + id); },
    get active() { return !controller.signal.aborted; },
    listen(target, type, listener) {
      target.addEventListener(type, listener, { signal: controller.signal });
    },
    onReady(listener) { readyHandlers.push(listener); },
    onDispose(cleanup) { cleanups.push(cleanup); },
    registerSave(handler) { cleanups.push(registerPageSave(handler)); },
    async start(user) {
      for (const listener of readyHandlers) {
        if (controller.signal.aborted) return;
        await listener({ detail: user });
      }
    },
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      for (const cleanup of cleanups) cleanup();
    },
  };
}
