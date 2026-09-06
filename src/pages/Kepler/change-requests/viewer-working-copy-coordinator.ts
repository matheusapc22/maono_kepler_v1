import {
  ViewerWorkingCopyStore,
  type ViewerChangeOperation,
  type ViewerLayerStyleUpdatePayload,
} from "./viewer-working-copy.ts";

type MutationTask<T> = () => Promise<T>;

type CoordinatedMethods = {
  ensure: ViewerWorkingCopyStore["ensure"];
  appendOperation: ViewerWorkingCopyStore["appendOperation"];
  upsertLayerStyleOperation: ViewerWorkingCopyStore["upsertLayerStyleOperation"];
  removeOperation: ViewerWorkingCopyStore["removeOperation"];
  completeSubmission: ViewerWorkingCopyStore["completeSubmission"];
};

const coordinatedStores = new WeakSet<ViewerWorkingCopyStore>();

/**
 * The Viewer currently composes two capture/replay runtimes over the same
 * Working Copy instance. IndexedDB only serializes individual storage
 * transactions; the store methods themselves are read-modify-write sequences.
 * Without a coordinator, concurrent captures can both read the same snapshot
 * and the last write can silently drop the other operation.
 *
 * Coordination is installed on the shared store instance before either runtime
 * mounts. The original method contracts stay unchanged, so callers outside the
 * runtimes (for example point creation/submission) participate in the same
 * mutation queue as soon as the composed runtime is rendered.
 */
export function coordinateViewerWorkingCopyStore(
  store: ViewerWorkingCopyStore | null,
): ViewerWorkingCopyStore | null {
  if (!store || coordinatedStores.has(store)) return store;

  coordinatedStores.add(store);
  let tail: Promise<void> = Promise.resolve();
  let internalEnsureCall = false;

  const original: CoordinatedMethods = {
    ensure: store.ensure.bind(store),
    appendOperation: store.appendOperation.bind(store),
    upsertLayerStyleOperation: store.upsertLayerStyleOperation.bind(store),
    removeOperation: store.removeOperation.bind(store),
    completeSubmission: store.completeSubmission.bind(store),
  };

  function enqueue<T>(task: MutationTask<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  store.ensure = ((baseRevision: number) => {
    // appendOperation/upsertLayerStyleOperation call this.ensure() before their
    // first await. During that synchronous nested call we must reuse the lock
    // already held by the outer mutation instead of enqueueing a second lock.
    if (internalEnsureCall) return original.ensure(baseRevision);
    return enqueue(() => original.ensure(baseRevision));
  }) as ViewerWorkingCopyStore["ensure"];

  store.appendOperation = ((
    baseRevision: number,
    operation: ViewerChangeOperation,
  ) =>
    enqueue(() => {
      internalEnsureCall = true;
      try {
        return original.appendOperation(baseRevision, operation);
      } finally {
        // The async method has already invoked this.ensure() synchronously by
        // the time it returns its Promise, so the bypass does not leak across
        // event-loop turns or unrelated callers.
        internalEnsureCall = false;
      }
    })) as ViewerWorkingCopyStore["appendOperation"];

  store.upsertLayerStyleOperation = ((
    baseRevision: number,
    payload: ViewerLayerStyleUpdatePayload,
  ) =>
    enqueue(() => {
      internalEnsureCall = true;
      try {
        return original.upsertLayerStyleOperation(baseRevision, payload);
      } finally {
        internalEnsureCall = false;
      }
    })) as ViewerWorkingCopyStore["upsertLayerStyleOperation"];

  store.removeOperation = ((operationId: string) =>
    enqueue(() => original.removeOperation(operationId))) as ViewerWorkingCopyStore["removeOperation"];

  store.completeSubmission = ((operationIds: string[]) =>
    enqueue(() => original.completeSubmission(operationIds))) as ViewerWorkingCopyStore["completeSubmission"];

  return store;
}
