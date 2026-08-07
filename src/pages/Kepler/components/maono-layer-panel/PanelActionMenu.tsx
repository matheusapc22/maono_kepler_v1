import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import LayerPanelIcon, {
  type LayerPanelIconName,
} from "./LayerPanelIcon";

export type PanelActionMenuItem = {
  label: string;
  icon: LayerPanelIconName;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
};

type Props = {
  label: string;
  items: PanelActionMenuItem[];
  className?: string;
};

type MenuPosition = {
  top: number;
  left: number;
};

const MENU_WIDTH = 220;
const VIEWPORT_MARGIN = 8;

export default function PanelActionMenu({ label, items, className }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const rect = trigger.getBoundingClientRect();
    const maximumHeight = Math.max(0, window.innerHeight - VIEWPORT_MARGIN * 2);
    const measuredHeight =
      menuRef.current?.offsetHeight ?? Math.min(360, items.length * 42 + 16);
    const menuHeight = Math.min(measuredHeight, maximumHeight);
    const roomBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const openAbove = roomBelow < menuHeight && rect.top > roomBelow;
    const preferredTop = openAbove
      ? rect.top - menuHeight - 6
      : rect.bottom + 6;
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(
        window.innerHeight - menuHeight - VIEWPORT_MARGIN,
        preferredTop,
      ),
    );
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(
        window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
        rect.right - MENU_WIDTH,
      ),
    );

    setPosition({ top, left });
  }, [items.length]);

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, positionMenu]);

  return (
    <div className={`maono-panel-menu${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="maono-panel-menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <LayerPanelIcon name="more" />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="maono-panel-menu__popover"
              role="menu"
              aria-label={label}
              style={{ top: position.top, left: position.left }}
            >
              {items.map((item, index) => (
                <button
                  type="button"
                  role="menuitem"
                  key={`${item.label}-${index}`}
                  className={[
                    item.danger ? "is-danger" : "",
                    item.separatorBefore ? "has-separator" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={item.disabled}
                  title={item.label}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <LayerPanelIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
