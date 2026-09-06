import ViewerPersistentMutationRuntime from "./ViewerPersistentMutationRuntime.tsx";
import ViewerRequestTrackingRuntime from "./ViewerRequestTrackingRuntime.tsx";
import ViewerWorkingCopyRuntimeLegacy from "./ViewerWorkingCopyRuntimeLegacy.tsx";
import { coordinateViewerWorkingCopyStore } from "./viewer-working-copy-coordinator.ts";
import type {
  ViewerWorkingCopy,
  ViewerWorkingCopyStore,
} from "./viewer-working-copy.ts";

type Props = {
  enabled: boolean;
  store: ViewerWorkingCopyStore | null;
  workingCopy: ViewerWorkingCopy | null;
  baseRevision: number;
  onWorkingCopyChange(value: ViewerWorkingCopy | null): void;
};

/**
 * Viewer mutation runtime is intentionally split in two layers during the
 * contract-coverage migration. The legacy runtime keeps replay/capture for the
 * already shipped operation types; the supplemental runtime owns the new
 * definition/tooltip/blending contracts and the explicit session-only policy.
 * Both share the same immutable Working Copy boundary. Tracking/resubmission
 * consumes that same boundary without mutating the original reviewed request.
 */
export default function ViewerWorkingCopyRuntime(props: Props) {
  const coordinatedStore = coordinateViewerWorkingCopyStore(props.store);
  const coordinatedProps = { ...props, store: coordinatedStore };

  return (
    <>
      <ViewerWorkingCopyRuntimeLegacy {...coordinatedProps} />
      <ViewerPersistentMutationRuntime {...coordinatedProps} />
      <ViewerRequestTrackingRuntime {...coordinatedProps} />
    </>
  );
}
