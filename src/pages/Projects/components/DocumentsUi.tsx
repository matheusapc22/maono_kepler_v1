import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const id = useId();

  const closeToTrigger = () => {
    trigger.current?.focus({ preventScroll: true });
    setOpen(false);
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
      panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
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

    document.addEventListener("pointerdown", outsidePointer);
    document.addEventListener("focusin", outsideFocus);
    window.addEventListener("resize", closeForGeometry);
    window.addEventListener("scroll", closeForGeometry, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outsidePointer);
      document.removeEventListener("focusin", outsideFocus);
      window.removeEventListener("resize", closeForGeometry);
      window.removeEventListener("scroll", closeForGeometry, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

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
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
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
            window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
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
