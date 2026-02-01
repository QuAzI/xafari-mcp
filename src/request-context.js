import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

function runWithRequestContext(context, fn) {
  return storage.run(context, fn);
}

function getRequestContext() {
  return storage.getStore() || null;
}

function trackFileRead(filePath) {
  const ctx = storage.getStore();
  if (!ctx || !ctx.filesRead) {
    return;
  }
  ctx.filesRead.add(filePath);
}

export { runWithRequestContext, getRequestContext, trackFileRead };
