import { useLayoutEffect, useRef, type RefObject } from "react";
import "./ticket-accessibility.css";

// A callback update must not restart focus management or steal focus from a field.
const dialogs: HTMLElement[] = [];
export function useTicketDialog(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogs.push(panel);
    function targets() {
      return Array.from(
        panel!.querySelectorAll<HTMLElement>(
          "button, input, textarea, select, a[href], [tabindex]",
        ),
      ).filter(
        (el) =>
          el.tabIndex >= 0 &&
          !el.matches(":disabled") &&
          !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
          el.getClientRects().length > 0 &&
          getComputedStyle(el).visibility !== "hidden",
      );
    }
    const timer = window.setTimeout(() => (targets()[0] || panel).focus(), 0);
    function keydown(event: KeyboardEvent) {
      if (dialogs.at(-1) !== panel || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = targets(),
        first = elements[0],
        last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        panel!.focus();
        return;
      }
      if (
        !panel!.contains(document.activeElement) ||
        document.activeElement === panel ||
        (event.shiftKey
          ? document.activeElement === first
          : document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last! : first).focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", keydown);
      dialogs.splice(dialogs.indexOf(panel), 1);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open, ref]);
}
