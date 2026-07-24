import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type ProjectActionsMenuProps = {
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
};

type MenuPosition = {
  left: number;
  top: number;
};

const MENU_WIDTH = 224;
const VIEWPORT_MARGIN = 12;
const BUTTON_GAP = 8;

function MoreIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="5" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="19" r="1.8" fill="currentColor" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m13.5 6.5 4 4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

const ProjectActionsMenu: React.FC<ProjectActionsMenuProps> = ({
  projectName,
  open,
  onOpenChange,
  onEdit,
}) => {
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);
  const [position, setPosition] = useState<MenuPosition>({
    left: VIEWPORT_MARGIN,
    top: VIEWPORT_MARGIN,
  });

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;

    if (!button || typeof window === "undefined") {
      return;
    }

    const rect = button.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 52;
    const availableBelow = window.innerHeight - rect.bottom;
    const top =
      availableBelow >= menuHeight + BUTTON_GAP + VIEWPORT_MARGIN
        ? rect.bottom + BUTTON_GAP
        : Math.max(
            VIEWPORT_MARGIN,
            rect.top - menuHeight - BUTTON_GAP,
          );
    const preferredLeft = rect.right - MENU_WIDTH;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, preferredLeft),
      Math.max(
        VIEWPORT_MARGIN,
        window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
      ),
    );

    setPosition({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      firstItemRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;

      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }

      onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    }

    function handleViewportChange() {
      updatePosition();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onOpenChange, open, updatePosition]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      buttonRef.current?.focus();
    }

    wasOpenRef.current = open;
  }, [open]);

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="menu"
            aria-label={`Ações do projeto ${projectName}`}
            className="mm-project-actions-menu"
            style={{
              position: "fixed",
              zIndex: 10050,
              left: position.left,
              top: position.top,
              width: MENU_WIDTH,
              padding: 6,
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 12,
              background: "#0a1119",
              boxShadow: "0 18px 42px rgba(0,0,0,0.45)",
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button
              ref={firstItemRef}
              type="button"
              role="menuitem"
              className="mm-project-actions-menu__item"
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: 10,
                minHeight: 42,
                padding: "10px 12px",
                border: 0,
                borderRadius: 8,
                background: "transparent",
                color: "#f8fafc",
                font: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenChange(false);
                onEdit();
              }}
            >
              <EditIcon />
              <span>Editar informações</span>
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="mm-project-card__more"
        aria-label={`Mais ações do projeto ${projectName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Mais ações"
        style={{
          position: "static",
          display: "inline-grid",
          width: 48,
          height: 48,
          placeItems: "center",
          flex: "0 0 auto",
          padding: 0,
          border: "1px solid rgba(255,255,255,0.42)",
          borderRadius: 13,
          background: "#09111a",
          color: "#ffffff",
          boxShadow:
            "0 0 0 2px rgba(0,0,0,0.35), 0 8px 20px rgba(0,0,0,0.42)",
          cursor: "pointer",
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(!open);
        }}
        onKeyDown={(event) => {
          if (
            !open &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            onOpenChange(true);
          }

          if (open && event.key === "Escape") {
            event.preventDefault();
            onOpenChange(false);
          }
        }}
      >
        <MoreIcon />
      </button>

      {menu}
    </>
  );
};

export default ProjectActionsMenu;
export type { ProjectActionsMenuProps };
