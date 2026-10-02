import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OrganizationFileSort } from "../../../lib/api";

type IconName = "folder" | "file" | "search" | "upload" | "download" | "trash" | "plus" | "more" | "close" | "arrow" | "restore" | "filter" | "list" | "grid" | "chevron";
const paths: Record<IconName, string> = {
  folder: "M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5",
  download: "M12 3v13m-5-5 5 5 5-5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  plus: "M12 5v14M5 12h14", more: "M5 12h.01M12 12h.01M19 12h.01",
  close: "m6 6 12 12M6 18 18 6", arrow: "m9 5 7 7-7 7",
  restore: "M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2",
  filter: "M4 4h16l-6 7v8l-4 2V11L4 4Z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  grid: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z",
  chevron: "m9 5 7 7-7 7",
};
export function DocumentIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={`mm-docs-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3.5 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

type Action = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };
/** Small menu: portalled so table scrolling never clips destructive-action confirmations. */
export function DocumentActionMenu({ label, actions, disabled = false }: { label: string; actions: Action[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusTimer = useRef<number | null>(null);
  const id = useId();

  const clearScheduledFocus = () => {
    if (focusTimer.current !== null) {
      window.clearTimeout(focusTimer.current);
      focusTimer.current = null;
    }
  };

  const scheduleFocus = (target: HTMLElement | null) => {
    clearScheduledFocus();
    focusTimer.current = window.setTimeout(() => {
      focusTimer.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }, 0);
  };

  const closeToTrigger = () => {
    setOpen(false);
    scheduleFocus(trigger.current);
  };

  useLayoutEffect(() => {
    if (!open) return;

    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;

    const height = panel.current?.offsetHeight ?? 100;
    const width = panel.current?.offsetWidth ?? 240;
    setPosition({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: rect.bottom + height + 8 > window.innerHeight ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
    });

    const focusFirst = () => {
      // The frame is a fallback, not a reason to reset an early keyboard selection.
      if (!panel.current?.contains(document.activeElement)) {
        panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
      }
    };
    focusFirst();
    const frame = window.requestAnimationFrame(focusFirst);

    const outsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const outsideFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const closeForGeometry = () => setOpen(false);
    const closeForScroll = () => {
      const current = trigger.current?.getBoundingClientRect();
      // Focusing/clicking the trigger can queue a scroll event before the menu
      // opens. Only dismiss if the anchor actually moved since it was positioned.
      if (!current || current.top !== rect.top || current.left !== rect.left ||
        current.bottom !== rect.bottom || current.right !== rect.right) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", outsidePointer);
    document.addEventListener("focusin", outsideFocus);
    window.addEventListener("resize", closeForGeometry);
    window.addEventListener("scroll", closeForScroll, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outsidePointer);
      document.removeEventListener("focusin", outsideFocus);
      window.removeEventListener("resize", closeForGeometry);
      window.removeEventListener("scroll", closeForScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      clearScheduledFocus();
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => () => clearScheduledFocus(), []);

  if (actions.length === 0) return null;

  return <>
    <button
      ref={trigger}
      type="button"
      className="mm-docs-button mm-docs-menu-trigger"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      disabled={disabled}
      onClick={() => {
        clearScheduledFocus();
        setOpen(value => !value);
      }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          clearScheduledFocus();
          setOpen(true);
        }
        if (event.key === "Escape" && open) {
          event.preventDefault();
          closeToTrigger();
        }
      }}
    ><DocumentIcon name="more" /></button>
    {open && createPortal(
      <div
        ref={panel}
        id={id}
        className="mm-docs-action-menu"
        role="menu"
        aria-label={label}
        style={position}
        onKeyDown={event => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeToTrigger();
            return;
          }

          const items = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
            event.preventDefault();
            const next = event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next]?.focus({ preventScroll: true });
            return;
          }

          if (event.key === "Tab") {
            event.preventDefault();
            const stops = Array.from(document.querySelectorAll<HTMLElement>(
              'button, a[href], input, select, textarea, [tabindex]'
            )).filter(element =>
              element.tabIndex >= 0 &&
              !element.matches(":disabled") &&
              element.getClientRects().length > 0 &&
              !panel.current?.contains(element)
            );
            const triggerIndex = stops.indexOf(trigger.current!);
            const target = stops[triggerIndex + (event.shiftKey ? -1 : 1)] ?? trigger.current;
            setOpen(false);
            scheduleFocus(target);
          }
        }}
      >
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            className={action.danger ? "is-danger" : ""}
            disabled={action.disabled}
            onClick={() => {
              clearScheduledFocus();
              setOpen(false);
              trigger.current?.focus({ preventScroll: true });
              action.onSelect();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>,
      document.body,
    )}
  </>;
}


type DocumentSortColumn = "name" | "type" | "size" | "updated";

/** One semantic button for the heading and its arrow; all ordering is server-side. */
export function DocumentSortHeading({ column, label, sort, onSort }: {
  column: DocumentSortColumn;
  label: string;
  sort: OrganizationFileSort;
  onSort: (sort: OrganizationFileSort) => void;
}) {
  const active = sort.startsWith(`${column}_`);
  const ascending = active && sort.endsWith("_asc");
  const nextAscending = active ? !ascending : column !== "updated";
  const nextSort: OrganizationFileSort = `${column}_${nextAscending ? "asc" : "desc"}`;
  const nextLabel = column === "updated"
    ? nextAscending ? "Classificar de mais antigas primeiro" : "Classificar de mais recentes primeiro"
    : column === "size"
      ? nextAscending ? "Classificar de menores para maiores" : "Classificar de maiores para menores"
      : nextAscending ? "Classificar de A a Z" : "Classificar de Z a A";
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const id = useId();
  const open = (hovered || focused) && !dismissed;
  const enterTooltip = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    setHovered(true);
    setDismissed(false);
  };
  const leaveTooltip = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    // Allow the pointer to cross the small gap into the portalled tooltip.
    hoverTimer.current = window.setTimeout(() => setHovered(false), 120);
  };
  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      const panel = tooltip.current;
      if (!rect || !panel) return;
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
      const { width, height } = panel.getBoundingClientRect();
      setPosition({
        left: Math.max(leftEdge, Math.min(rect.right - width, rightEdge - width)),
        top: Math.max(topEdge, Math.min(
          rect.bottom + height + 8 > bottomEdge ? rect.top - height - 6 : rect.bottom + 6,
          bottomEdge - height,
        )),
      });
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    reposition();
    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, nextLabel]);

  return <th scope="col" className={`mm-docs-sort-heading${column === "name" ? " is-name" : ""}`} aria-sort={active ? ascending ? "ascending" : "descending" : "none"}>
    <button ref={trigger} type="button" className={`mm-docs-sort-button${active ? " is-active" : ""}`}
      aria-label={`${label}: ${nextLabel}`} aria-describedby={open ? id : undefined}
      onClick={() => onSort(nextSort)}
      onPointerEnter={enterTooltip}
      onPointerLeave={leaveTooltip}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={() => { setFocused(false); setDismissed(false); }}
      onKeyDown={event => { if (event.key === "Escape") setDismissed(true); }}>
      <span>{label}</span>
      <span className="mm-docs-sort-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
          <path d={active ? ascending ? "M12 20V4m-7 7 7-7 7 7" : "M12 4v16m-7-7 7 7 7-7" : "M8 20V4m-4 4 4-4 4 4M16 4v16m-4-4 4 4 4-4"} />
        </svg>
      </span>
    </button>
    {open && createPortal(<div ref={tooltip} id={id} role="tooltip" className="mm-docs-sort-tooltip" style={position} onPointerEnter={enterTooltip} onPointerLeave={leaveTooltip}>{nextLabel}</div>, document.body)}
  </th>;
}
