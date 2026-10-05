import { useCallback, useEffect, useRef } from "react";

/** Restore only focus lost by the initiating native button becoming disabled. */
export function useManualRefreshFocus(busy: boolean) {
  const pending = useRef<{ target: HTMLButtonElement; cleanup: () => void } | null>(null);
  const cancel = useCallback(() => {
    pending.current?.cleanup();
    pending.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (busy) return;
    const target = pending.current?.target;
    cancel();
    if (target?.isConnected && !target.disabled && document.activeElement === document.body) {
      target.focus({ preventScroll: true });
    }
  }, [busy, cancel]);
  return useCallback((target: HTMLButtonElement) => {
    cancel();
    if (!target.isConnected || target.disabled || document.activeElement !== target) return;
    const onFocus = (event: FocusEvent) => {
      if (event.target !== target && event.target !== document.body) cancel();
    };
    // Capture-phase listeners added inside onClick cannot consume that same
    // initiating click; every later interaction cancels the restoration.
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("click", cancel, true);
    document.addEventListener("keydown", cancel, true);
    document.addEventListener("focusin", onFocus, true);
    pending.current = { target, cleanup: () => {
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("click", cancel, true);
      document.removeEventListener("keydown", cancel, true);
      document.removeEventListener("focusin", onFocus, true);
    } };
  }, [cancel]);
}
