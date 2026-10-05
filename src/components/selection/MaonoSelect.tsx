import { forwardRef, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import "./maono-select.css";
import "./maono-filter-controls.css";

type Choice = { index: number; value: string; label: string; disabled: boolean; group: string };
function readChoices(select: HTMLSelectElement): Choice[] {
  return Array.from(select.options, (option, index) => ({
    index, value: option.value, label: option.label,
    disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
    group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : "",
  }));
}
function fieldName(select: HTMLSelectElement, includeExplicit = true) {
  if (includeExplicit && select.getAttribute("aria-label")) return select.getAttribute("aria-label")!;
  const labelled = select.getAttribute("aria-labelledby")?.split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ").trim();
  if (includeExplicit && labelled) return labelled;
  return Array.from(select.labels || [], label => {
    const clone = label.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("select, svg").forEach(element => element.remove());
    return clone.textContent?.trim() || "";
  }).join(" ") || select.title || "Opções";
}

/**
 * The real, visible select remains the form control and only focus stop: labels,
 * required/name/form/reset, refs and native React change events keep their contract.
 * Its OS popup is replaced by a branded DOM listbox, without inventing change events.
 * Multi-row/multiple controls retain native semantics rather than losing selection.
 */
export const MaonoSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function MaonoSelect({
  children, className, disabled, multiple, size, onMouseDown, onPointerDown, onClick, onKeyDown, onBlur, onChange, ...props
}, forwardedRef) {
  const id = useId();
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [active, setActive] = useState(-1);
  const [host, setHost] = useState<Element | null>(null);
  const [label, setLabel] = useState("Opções");
  const search = useRef({ text: "", at: 0 });
  const optionRevision = useRef("");
  const native = multiple || (size !== undefined && size > 1);
  const expanded = open && !disabled && !native;
  const activeChoice = choices.find(choice => choice.index === active);
  useLayoutEffect(() => {
    if (disabled || native || selectRef.current?.matches(":disabled")) setOpen(false);
  }, [disabled, native, children, props]);

  useLayoutEffect(() => {
    // Make implicit labels explicit after adding a decorative wrapper. This also
    // keeps label-based automation and assistive technology names unchanged.
    const select = selectRef.current;
    if (select && !props["aria-label"] && !props["aria-labelledby"]) setLabel(fieldName(select, false));
  }, [children, props]);

  function openMenu(edge?: "first" | "last") {
    const select = selectRef.current;
    if (!select || select.matches(":disabled") || native) return;
    const available = readChoices(select);
    const enabled = available.filter(choice => !choice.disabled);
    setChoices(available);
    optionRevision.current = JSON.stringify(available);
    setActive(edge === "first" ? enabled[0]?.index ?? -1 : edge === "last" ? enabled.at(-1)?.index ?? -1 : enabled.find(choice => choice.index === select.selectedIndex)?.index ?? enabled[0]?.index ?? -1);
    setLabel(fieldName(select));
    // Stay inside a modal's inert/focus boundary; the popover top layer still
    // escapes clipped/scrolling ancestors. Body is used only outside dialogs.
    setHost(select.closest("dialog, [role='dialog']") || document.body);
    select.focus({ preventScroll: true });
    setOpen(true);
  }

  function commit(index: number) {
    const select = selectRef.current;
    const option = select?.options[index];
    if (!select || select.matches(":disabled") || !option || option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)) return;
    setOpen(false);
    select.focus({ preventScroll: true });
    if (select.selectedIndex !== index) {
      select.selectedIndex = index;
      // Dispatch on the real control: target/currentTarget, selectedOptions,
      // form data and controlled React updates all see the original select.
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  useLayoutEffect(() => {
    if (!expanded) return;
    const select = selectRef.current;
    const menu = menuRef.current;
    if (!select || !menu) return;
    if (typeof menu.showPopover === "function") menu.showPopover();
    function position() {
      if (!select || !menu) return;
      const rect = select.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const offsetX = viewport?.offsetLeft || 0;
      const offsetY = viewport?.offsetTop || 0;
      if (rect.bottom < offsetY || rect.top > offsetY + height || rect.right < offsetX || rect.left > offsetX + width) {
        setOpen(false);
        return;
      }
      const availableBelow = Math.max(0, offsetY + height - rect.bottom - 12);
      const availableAbove = Math.max(0, rect.top - offsetY - 12);
      const above = availableBelow < Math.min(menu.scrollHeight, 220) && availableAbove > availableBelow;
      const maxHeight = Math.max(40, Math.min(320, above ? availableAbove : availableBelow));
      const menuWidth = Math.min(Math.max(rect.width, 180), Math.max(0, width - 16));
      menu.style.width = `${menuWidth}px`;
      menu.style.maxHeight = `${maxHeight}px`;
      menu.style.left = `${Math.max(offsetX + 8, Math.min(rect.left, offsetX + width - menuWidth - 8))}px`;
      menu.style.top = `${above ? Math.max(offsetY + 8, rect.top - Math.min(menu.scrollHeight, maxHeight) - 5) : rect.bottom + 5}px`;
    }
    function outside(event: Event) {
      if (event.target instanceof Node && !menu?.contains(event.target) && event.target !== select) setOpen(false);
    }
    function reset() { setOpen(false); }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(select);
    observer.observe(menu);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    select.form?.addEventListener("reset", reset);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      select.form?.removeEventListener("reset", reset);
      if (menu.isConnected && typeof menu.hidePopover === "function") menu.hidePopover();
    };
  }, [expanded, host]);

  useLayoutEffect(() => {
    if (!expanded || !selectRef.current) return;
    const next = readChoices(selectRef.current);
    if (JSON.stringify(next) !== optionRevision.current) {
      // Async facets/permissions must never leave a stale option actionable.
      setOpen(false);
      return;
    }
    setChoices(next);
    setActive(current => next.some(choice => choice.index === current && !choice.disabled) ? current : next.find(choice => !choice.disabled)?.index ?? -1);
  }, [children, expanded]);

  useLayoutEffect(() => {
    if (expanded) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, expanded, id]);

  function keydown(event: KeyboardEvent<HTMLSelectElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled || native) return;
    if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) {
      event.preventDefault();
      if (!expanded) openMenu(event.key === "Home" ? "first" : event.key === "End" ? "last" : undefined);
      else {
        const enabled = choices.filter(choice => !choice.disabled);
        const current = enabled.findIndex(choice => choice.index === active);
        const step = event.key === "PageDown" ? 10 : event.key === "PageUp" ? -10 : event.key === "ArrowDown" ? 1 : -1;
        const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : Math.max(0, Math.min(enabled.length - 1, current + step));
        setActive(enabled[next]?.index ?? -1);
      }
    } else if (event.key === "F4") {
      event.preventDefault();
      if (expanded) setOpen(false); else openMenu();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) commit(active); else openMenu();
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false); // Keep normal form/dialog traversal and do not commit drafts.
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - search.current.at < 700 ? search.current.text : "";
      const text = previous + event.key.toLocaleLowerCase();
      search.current = { text, at: now };
      const available = readChoices(event.currentTarget).filter(choice => !choice.disabled);
      const query = Array.from(text).every(letter => letter === text[0]) ? text[0] : text;
      const start = query.length === 1 ? available.findIndex(choice => choice.index === active) + 1 : 0;
      const ordered = [...available.slice(start), ...available.slice(0, start)];
      const match = ordered.find(choice => choice.label.toLocaleLowerCase().startsWith(query));
      if (!expanded) openMenu();
      if (match) setActive(match.index);
    }
  }

  return <span className={`maono-select${native ? " maono-select--native" : ""}`} data-open={expanded || undefined} data-disabled={disabled || undefined}>
    <select {...props} ref={element => { selectRef.current = element; if (typeof forwardedRef === "function") forwardedRef(element); else if (forwardedRef) forwardedRef.current = element; }}
      className={className} data-maono-select="true" disabled={disabled} multiple={multiple} size={size}
      aria-label={props["aria-label"] || (!props["aria-labelledby"] ? label : undefined)}
      aria-haspopup={native ? props["aria-haspopup"] : "listbox"}
      aria-expanded={native ? undefined : expanded}
      aria-controls={expanded ? id : undefined}
      aria-activedescendant={expanded && activeChoice ? `${id}-option-${active}` : undefined}
      onPointerDown={event => {
        onPointerDown?.(event);
        if (!event.defaultPrevented && event.button === 0 && !disabled && !native) {
          // Cancel the platform picker before either mouse or touch activation.
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onMouseDown={event => {
        onMouseDown?.(event);
        if (!event.defaultPrevented && event.button === 0 && !disabled && !native) event.preventDefault();
      }}
      onClick={event => {
        onClick?.(event);
        if (event.defaultPrevented || disabled || native) return;
        event.preventDefault();
        if (expanded) setOpen(false); else openMenu();
      }}
      onKeyDown={keydown}
      onBlur={event => { onBlur?.(event); setOpen(false); }}
      onChange={event => { setOpen(false); onChange?.(event); }}
    >{children}</select>
    {!native ? <svg className="maono-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg> : null}
    {expanded && host ? createPortal(<div ref={menuRef} id={id} popover="manual" role="listbox" aria-label={`Opções: ${label}`} className="maono-select-menu" onMouseDown={event => event.preventDefault()}>
      {choices.length === 0 ? <div className="maono-select-menu__empty" role="status">Nenhuma opção disponível</div> : choices.map((choice, index) => <div key={`${choice.index}-${choice.value}`} role="presentation">
        {choice.group && choices[index - 1]?.group !== choice.group ? <div className="maono-select-menu__group" role="presentation">{choice.group}</div> : null}
        <div id={`${id}-option-${choice.index}`} role="option" aria-selected={selectRef.current?.selectedIndex === choice.index} aria-disabled={choice.disabled || undefined}
          className={`maono-select-menu__option${active === choice.index ? " is-active" : ""}`}
          onPointerMove={event => { if (event.pointerType === "mouse" && !choice.disabled) setActive(choice.index); }}
          onClick={() => commit(choice.index)}>
          <span>{choice.label}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6" /></svg>
        </div>
      </div>)}
    </div>, host) : null}
  </span>;
});
