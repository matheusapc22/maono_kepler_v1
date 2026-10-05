import { useEffect, useState, useSyncExternalStore } from "react";

import {
  advanceInitialLoadingPresentation,
  readInitialLoadingPresentation,
  scheduleInitialLoadingPresentation,
} from "./initial-loading-presentation";
import type { InitialLoadingPresentationOptions } from "./initial-loading-presentation";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const now = () => typeof performance === "undefined" ? Date.now() : performance.now();

function getReducedMotionSnapshot() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * Never feed these presentation gates into request effects or cache ownership.
 * Mount once for the region, use its access/query identity as scopeKey, and keep
 * ready data mounted after the first reveal. A refresh never restarts the stage.
 */
export function useInitialLoadingPresentation(options: InitialLoadingPresentationOptions) {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, () => false);
  const input = { ...options, reducedMotion };
  const [state, setState] = useState(() => advanceInitialLoadingPresentation(null, input, now()));
  const presentation = advanceInitialLoadingPresentation(state, input, now());
  // Adjust this component's state during render so a changed access scope or
  // terminal error cannot paint a frame using the previous scope's gates.
  if (presentation !== state) setState(presentation);

  useEffect(() => scheduleInitialLoadingPresentation(presentation, {
    now,
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: handle => window.clearTimeout(handle as number),
  }, () => {
    // An old scope/timer cannot release a replacement request's presentation.
    setState(current => current === presentation
      ? advanceInitialLoadingPresentation(current, current.input, now())
      : current);
  }), [presentation]);

  return {
    ...readInitialLoadingPresentation(presentation),
    // Share this clock with query-keyed children without tying their independent
    // data readiness to this region's request or restarting a presentation.
    stagePending: presentation.phase === "structure" || presentation.phase === "content",
  };
}
