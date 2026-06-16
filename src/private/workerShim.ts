// circomlibjs touches the Worker constructor at module load even on the single-thread path that never
// uses one; a service worker has none, so stub it to avoid a load-time throw (no-op in a document).
const scope = globalThis as { Worker?: unknown }
if (typeof scope.Worker === 'undefined') {
  scope.Worker = class {}
}
