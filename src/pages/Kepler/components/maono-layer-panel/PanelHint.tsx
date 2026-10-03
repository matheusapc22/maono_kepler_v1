import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { panelHintPosition } from "./panel-hint-position";
import "./panel-hint.css";

type Props = { label: string; children: string };
const OPEN_EVENT = "maono-panel-hint-open";

/** Local explanatory text only. Errors and actionable notices stay in the panel. */
export default function PanelHint({ label, children }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxWidth: 288, maxHeight: 240 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(false);
  const focusedRef = useRef(false);
  const hoveredRef = useRef(false);
  const settlingPositionRef = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);

  const clearCloseTimer = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  const dismiss = useCallback(() => {
    clearCloseTimer();
    pinnedRef.current = false;
    setPositioned(false);
    setOpen(false);
  }, [clearCloseTimer]);

  function show() {
    clearCloseTimer();
    // Only one hint is exposed at a time, including hover after a pinned hint.
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setOpen(true);
  }

  function leave() {
    clearCloseTimer();
    if (pinnedRef.current || focusedRef.current) return;
    // Bridge the small gap to the portal so the text stays hoverable/selectable.
    closeTimer.current = window.setTimeout(dismiss, 160);
  }

  const positionPopover = useCallback(() => {
    if (settlingPositionRef.current) return;
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const viewport = window.visualViewport;
    const anchor = trigger.getBoundingClientRect();
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const scrollBounds = trigger.closest(".maono-detail-view__scroll")?.getBoundingClientRect();
    const visibleTop = Math.max(viewportTop, scrollBounds?.top ?? viewportTop);
    const visibleBottom = Math.min(
      viewportTop + viewportHeight,
      scrollBounds?.bottom ?? viewportTop + viewportHeight,
    );
    if (anchor.bottom <= visibleTop || anchor.top >= visibleBottom) {
      dismiss();
      return;
    }
    const next = panelHintPosition(
      anchor,
      popover.getBoundingClientRect(),
      {
        width: viewport?.width ?? window.innerWidth,
        height: viewportHeight,
        left: viewport?.offsetLeft ?? 0,
        top: viewportTop,
      },
    );
    setPosition((current) =>
      current.top === next.top && current.left === next.left &&
      current.maxWidth === next.maxWidth && current.maxHeight === next.maxHeight
        ? current : next,
    );
    setPositioned(true);
  }, [dismiss]);

  useLayoutEffect(() => {
    if (!open) return;
    // Native focus can scroll a clipped trigger after focus/layout handlers
    // (notably in WebKit). Keep the portal hidden until that first paint settles;
    // never force-scroll the sidebar or dismiss from the stale focus rectangle.
    settlingPositionRef.current = true;
    setPositioned(false);
    let settledFrame: number | undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      settledFrame = window.requestAnimationFrame(() => {
        settlingPositionRef.current = false;
        positionPopover();
      });
    });
    const observer = new ResizeObserver(positionPopover);
    if (popoverRef.current) observer.observe(popoverRef.current);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (settledFrame !== undefined) window.cancelAnimationFrame(settledFrame);
      settlingPositionRef.current = false;
      observer.disconnect();
    };
  }, [open, positionPopover]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  useEffect(() => {
    if (!open) return;

    function isInside(target: EventTarget | null) {
      return target instanceof Node && (
        triggerRef.current?.contains(target) || popoverRef.current?.contains(target)
      );
    }
    function dismissOutside(event: Event) {
      if (!isInside(event.target)) dismiss();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Capture before the shell's bubble listener: Escape closes this hint only.
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
    function handleOtherHint(event: Event) {
      if ((event as CustomEvent<string>).detail !== id) dismiss();
    }
    function handleToggle(event: Event) {
      const details = event.target;
      if (details instanceof HTMLDetailsElement && !details.open &&
          triggerRef.current && details.contains(triggerRef.current)) dismiss();
    }

    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("toggle", handleToggle, true);
    document.addEventListener(OPEN_EVENT, handleOtherHint);
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    window.visualViewport?.addEventListener("resize", positionPopover);
    window.visualViewport?.addEventListener("scroll", positionPopover);

    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("toggle", handleToggle, true);
      document.removeEventListener(OPEN_EVENT, handleOtherHint);
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
      window.visualViewport?.removeEventListener("resize", positionPopover);
      window.visualViewport?.removeEventListener("scroll", positionPopover);
    };
  }, [dismiss, id, open, positionPopover]);

  return (
    <span className="maono-panel-hint">
      <button
        ref={triggerRef}
        className="maono-panel-hint__trigger"
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") { hoveredRef.current = true; show(); }
        }}
        onPointerLeave={() => { hoveredRef.current = false; leave(); }}
        onFocus={() => { focusedRef.current = true; show(); }}
        onBlur={() => {
          focusedRef.current = false;
          // Clicking/selecting the portal text must not dismiss it on blur.
          // Focus moving to another control is handled by focusin outside.
          if (!hoveredRef.current) leave();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (pinnedRef.current) dismiss();
          else { pinnedRef.current = true; show(); }
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={popoverRef}
          id={id}
          className="maono-panel-hint__popover"
          role="tooltip"
          style={{ ...position, visibility: positioned ? "visible" : "hidden" }}
          onPointerEnter={() => { hoveredRef.current = true; clearCloseTimer(); }}
          onPointerLeave={() => { hoveredRef.current = false; leave(); }}
        >
          {children}
        </div>,
        document.body,
      ) : null}
    </span>
  );
}
