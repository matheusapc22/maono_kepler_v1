import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type {
  MaonoId,
  MaonoOrganization,
} from "../../../auth/session";

type OrganizationWorkspaceSwitcherProps = {
  activeOrganization: MaonoOrganization | null;
  organizations: MaonoOrganization[];
  expanded: boolean;
  switching?: boolean;
  error?: string | null;
  onSwitch: (organizationId: MaonoId) => Promise<void>;
  onDismissError?: () => void;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

function sameId(left: MaonoId | null | undefined, right: MaonoId) {
  return String(left ?? "") === String(right);
}

function getInitials(name?: string) {
  const parts = String(name || "Organização")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return `${parts[0]?.charAt(0) || "O"}${parts[1]?.charAt(0) || ""}`
    .toUpperCase();
}

function accessLabel(organization: MaonoOrganization) {
  const accessLevel = String(
    organization.accessLevel ?? organization.access_level ?? organization.role ?? "",
  )
    .trim()
    .toLowerCase();

  if (accessLevel === "super_admin") return "Super Admin";
  if (accessLevel === "admin") return "Administrador";
  if (accessLevel === "owner" || accessLevel === "client") return "Proprietário";
  if (accessLevel === "editor") return "Editor";
  if (accessLevel === "viewer") return "Visualizador";

  return "Membro";
}

const OrganizationWorkspaceSwitcher: React.FC<
  OrganizationWorkspaceSwitcherProps
> = ({
  activeOrganization,
  organizations,
  expanded,
  switching = false,
  error = null,
  onSwitch,
  onDismissError,
}) => {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const availableOrganizations = useMemo(
    () => organizations.filter((organization) => organization.active !== false),
    [organizations],
  );

  const activeIndex = useMemo(
    () =>
      Math.max(
        0,
        availableOrganizations.findIndex((organization) =>
          sameId(activeOrganization?.id, organization.id),
        ),
      ),
    [activeOrganization?.id, availableOrganizations],
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;

    if (!trigger || typeof window === "undefined") {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const width = expanded ? Math.max(rect.width, 250) : 286;
    const preferredLeft = expanded ? rect.left : rect.right + 8;
    const left = Math.max(
      viewportPadding,
      Math.min(preferredLeft, window.innerWidth - width - viewportPadding),
    );
    const preferredTop = expanded ? rect.bottom + 8 : rect.top;
    const top = Math.max(
      viewportPadding,
      Math.min(preferredTop, window.innerHeight - 180),
    );

    setMenuPosition({
      left,
      top,
      width,
      maxHeight: Math.max(160, window.innerHeight - top - viewportPadding),
    });
  }, [expanded]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuPosition(null);
  }, []);

  const openMenu = useCallback(
    (index = activeIndex) => {
      if (availableOrganizations.length === 0 || switching) {
        return;
      }

      setHighlightedIndex(index);
      setOpen(true);
    },
    [activeIndex, availableOrganizations.length, switching],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    updatePosition();

    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }

    optionRefs.current[highlightedIndex]?.focus();
  }, [highlightedIndex, menuPosition, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeMenu, open]);

  useEffect(() => {
    if (open && !switching) {
      setHighlightedIndex(activeIndex);
    }
  }, [activeIndex, open, switching]);

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      setHighlightedIndex((current) => {
        const count = availableOrganizations.length;
        return count === 0 ? 0 : (current + direction + count) % count;
      });
    },
    [availableOrganizations.length],
  );

  const handleSelection = useCallback(
    async (organization: MaonoOrganization) => {
      if (sameId(activeOrganization?.id, organization.id) || switching) {
        return;
      }

      try {
        onDismissError?.();
        await onSwitch(organization.id);
        closeMenu();
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      } catch {
        // A mensagem normalizada da sessão permanece visível no seletor.
      }
    },
    [
      activeOrganization?.id,
      closeMenu,
      onDismissError,
      onSwitch,
      switching,
    ],
  );

  const menu =
    open && menuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className="mm-organization-menu"
            role="listbox"
            aria-label="Trocar organização ativa"
            aria-busy={switching}
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              width: menuPosition.width,
              maxHeight: menuPosition.maxHeight,
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveHighlight(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveHighlight(-1);
              } else if (event.key === "Home") {
                event.preventDefault();
                setHighlightedIndex(0);
              } else if (event.key === "End") {
                event.preventDefault();
                setHighlightedIndex(availableOrganizations.length - 1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeMenu();
                triggerRef.current?.focus();
              } else if (event.key === "Tab") {
                closeMenu();
              }
            }}
          >
            <div className="mm-organization-menu-header">
              <strong>Trocar organização</strong>
              <span>Selecione o contexto de trabalho</span>
            </div>

            <div className="mm-organization-options">
              {availableOrganizations.map((organization, index) => {
                const selected = sameId(activeOrganization?.id, organization.id);

                return (
                  <button
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    key={String(organization.id)}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? "mm-organization-option selected" : "mm-organization-option"}
                    tabIndex={index === highlightedIndex ? 0 : -1}
                    disabled={switching}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => void handleSelection(organization)}
                  >
                    <span className="mm-organization-avatar" aria-hidden="true">
                      {getInitials(organization.name)}
                    </span>
                    <span className="mm-organization-option-copy">
                      <strong>{organization.name || "Organização"}</strong>
                      <span>{accessLabel(organization)}</span>
                    </span>
                    <span className="mm-organization-check" aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            {switching ? (
              <div className="mm-organization-menu-status" role="status">
                Validando acesso e atualizando projetos…
              </div>
            ) : null}

            {error ? (
              <div className="mm-organization-menu-error" role="alert">
                {error}
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  const triggerLabel = activeOrganization?.name
    ? `${activeOrganization.name} Workspace`
    : "Selecionar organização";

  return (
    <div className="mm-organization-switcher">
      <button
        ref={triggerRef}
        type="button"
        className="mm-organization-trigger"
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-label={`${triggerLabel}. Trocar organização ativa`}
        title={expanded ? "Trocar organização ativa" : triggerLabel}
        disabled={availableOrganizations.length === 0 || switching}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(
              event.key === "ArrowUp"
                ? Math.max(0, availableOrganizations.length - 1)
                : activeIndex,
            );
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu();
          }
        }}
      >
        <span className="mm-organization-avatar" aria-hidden="true">
          {getInitials(activeOrganization?.name)}
        </span>
        <span className="mm-organization-trigger-copy">
          <strong>{triggerLabel}</strong>
          <span>
            {activeOrganization
              ? accessLabel(activeOrganization)
              : "Nenhuma organização ativa"}
          </span>
        </span>
        <span className="mm-organization-chevron" aria-hidden="true">
          {switching ? "…" : open ? "⌃" : "⌄"}
        </span>
      </button>

      {expanded && error && !open ? (
        <p className="mm-organization-inline-error" role="alert">
          {error}
        </p>
      ) : null}

      {menu}
    </div>
  );
};

export default OrganizationWorkspaceSwitcher;
