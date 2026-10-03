import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type {
  MaonoId,
  MaonoOrganization,
} from "../../../auth/session";
import { UniversalLoader } from "../../../components/loading";
import { organizationMenuPosition } from "./organization-switcher-position";

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

function OrganizationSearch({ inputRef, value, listboxId, onChange, onKeyDown }: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  listboxId: string;
  onChange: (value: string) => void;
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <label className="mm-organization-search">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="10.5" cy="10.5" r="7" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="m16 16 5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        aria-label="Buscar organização"
        aria-controls={listboxId}
        placeholder="Buscar organização..."
        autoComplete="off"
        onChange={event => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </label>
  );
}

function OrganizationItem({ organization, selected, highlighted, busy, buttonRef, onFocus, onSelect }: {
  organization: MaonoOrganization;
  selected: boolean;
  highlighted: boolean;
  busy: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={selected}
      className={selected ? "mm-organization-option selected" : "mm-organization-option"}
      tabIndex={highlighted ? 0 : -1}
      disabled={busy}
      onFocus={onFocus}
      onClick={onSelect}
      title={organization.name || "Organização"}
    >
      <span className="mm-organization-avatar" aria-hidden="true">{getInitials(organization.name)}</span>
      <span className="mm-organization-option-copy">
        <strong>{organization.name || "Organização"}</strong>
        <span>{accessLabel(organization)}</span>
      </span>
      <span className="mm-organization-check" aria-hidden="true">{selected ? "✓" : ""}</span>
    </button>
  );
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
  const panelId = useId();
  const listboxId = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectionPendingRef = useRef(false);
  const menuEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const initialOptionRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectionPending, setSelectionPending] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const busy = switching || selectionPending;

  const availableOrganizations = useMemo(
    () => organizations.filter((organization) => organization.active !== false),
    [organizations],
  );
  const filteredOrganizations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return availableOrganizations.filter(organization =>
      String(organization.name || "Organização").toLocaleLowerCase().includes(query),
    );
  }, [availableOrganizations, search]);
  const activeIndex = Math.max(0, availableOrganizations.findIndex(organization =>
    sameId(activeOrganization?.id, organization.id),
  ));

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; menuEpochRef.current += 1; };
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const next = organizationMenuPosition(
      trigger.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      expanded,
      146 + Math.min(380, Math.max(56, filteredOrganizations.length * 60)) + (busy ? 42 : 0) + (error ? 64 : 0),
    );
    setMenuPosition(current => current && Object.keys(next).every(key =>
      current[key as keyof MenuPosition] === next[key as keyof MenuPosition],
    ) ? current : next);
  }, [expanded, filteredOrganizations.length, busy, error]);

  const closeMenu = useCallback((restoreFocus = false) => {
    menuEpochRef.current += 1;
    setOpen(false);
    setMenuPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback((optionIndex: number | null = null) => {
    if (availableOrganizations.length === 0 || busy || selectionPendingRef.current) return;
    menuEpochRef.current += 1;
    initialOptionRef.current = optionIndex;
    setSearch("");
    setHighlightedIndex(optionIndex ?? activeIndex);
    setOpen(true);
  }, [activeIndex, availableOrganizations.length, busy]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const observer = new ResizeObserver(updatePosition);
    if (triggerRef.current) observer.observe(triggerRef.current);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      observer.disconnect();
    };
  }, [open, updatePosition]);

  const positioned = menuPosition !== null;
  useLayoutEffect(() => {
    if (!open || !positioned) return;
    const index = initialOptionRef.current;
    if (index === null) searchRef.current?.focus();
    else optionRefs.current[index]?.focus();
    // Focus only once when opening; typing, scrolling and resizing must not steal it.
  }, [open, positioned]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    };
    const handleFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocus);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocus);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeMenu, open]);

  const focusOption = (index: number) => {
    if (!filteredOrganizations.length || busy) return;
    const next = (index + filteredOrganizations.length) % filteredOrganizations.length;
    setHighlightedIndex(next);
    optionRefs.current[next]?.focus();
  };

  const handleSelection = useCallback(async (organization: MaonoOrganization) => {
    if (busy || selectionPendingRef.current) return;
    if (sameId(activeOrganization?.id, organization.id)) { closeMenu(true); return; }
    selectionPendingRef.current = true;
    setSelectionPending(true);
    const epoch = menuEpochRef.current;
    try {
      onDismissError?.();
      await onSwitch(organization.id);
      if (mountedRef.current && epoch === menuEpochRef.current) closeMenu(true);
    } catch {
      // Keep the previous context and the existing normalized session error visible.
      // Some browsers blur a disabled option while the request is pending.
      if (mountedRef.current && epoch === menuEpochRef.current && document.activeElement === document.body) {
        searchRef.current?.focus();
      }
    } finally {
      selectionPendingRef.current = false;
      if (mountedRef.current) setSelectionPending(false);
    }
  }, [activeOrganization?.id, busy, closeMenu, onDismissError, onSwitch]);

  const menu = open && menuPosition && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={menuRef}
        id={panelId}
        className="mm-organization-menu"
        role="dialog"
        aria-labelledby={titleId}
        aria-busy={busy}
        style={menuPosition}
        onKeyDown={event => {
          if (event.key === "Tab") {
            const option = optionRefs.current[highlightedIndex];
            if (event.target === searchRef.current && !event.shiftKey && option && !busy) {
              event.preventDefault(); option.focus();
            } else if (event.target !== searchRef.current && event.shiftKey) {
              event.preventDefault(); searchRef.current?.focus();
            } else {
              // The portal is at the end of body. Continue from its trigger in page order.
              triggerRef.current?.focus(); closeMenu();
            }
          }
        }}
      >
        <div className="mm-organization-menu-header">
          <strong id={titleId}>Trocar organização</strong>
          <span>Selecione um contexto de trabalho</span>
        </div>
        <OrganizationSearch
          inputRef={searchRef}
          value={search}
          listboxId={listboxId}
          onChange={value => { setSearch(value); setHighlightedIndex(0); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              focusOption(event.key === "ArrowUp" ? filteredOrganizations.length - 1 : highlightedIndex);
            }
          }}
        />
        <div
          id={listboxId}
          className="mm-organization-options"
          role="listbox"
          aria-label="Organizações disponíveis"
          aria-busy={busy}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); focusOption(highlightedIndex + (event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault(); focusOption(event.key === "Home" ? 0 : filteredOrganizations.length - 1);
            }
          }}
        >
          {filteredOrganizations.map((organization, index) => (
            <OrganizationItem
              key={String(organization.id)}
              organization={organization}
              selected={sameId(activeOrganization?.id, organization.id)}
              highlighted={index === highlightedIndex}
              busy={busy}
              buttonRef={element => { optionRefs.current[index] = element; }}
              onFocus={() => setHighlightedIndex(index)}
              onSelect={() => void handleSelection(organization)}
            />
          ))}
        </div>
        {filteredOrganizations.length === 0 ? (
          <p className="mm-organization-empty" role="status">Nenhuma organização encontrada.</p>
        ) : null}
        {busy ? (
          <div className="mm-organization-menu-status">
            <UniversalLoader size="inline" accessibleLabel="Trocando organização" />
          </div>
        ) : null}
        {error ? <div className="mm-organization-menu-error" role="alert">{error}</div> : null}
      </div>, document.body,
    ) : null;

  const triggerLabel = activeOrganization?.name
    ? `${activeOrganization.name} Workspace`
    : "Selecionar organização";

  return (
    <div className="mm-organization-switcher">
      <button
        ref={triggerRef}
        type="button"
        className="mm-organization-trigger"
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={`${triggerLabel}. Trocar organização ativa`}
        title={expanded ? "Trocar organização ativa" : triggerLabel}
        disabled={availableOrganizations.length === 0}
        aria-disabled={busy}
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
        <span className="mm-organization-chevron">
          {busy ? (
            <UniversalLoader
              size="inline"
              accessibleLabel="Trocando organização"
            />
          ) : (
            <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
          )}
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
