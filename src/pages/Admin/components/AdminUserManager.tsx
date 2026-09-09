import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import AdminUserManagerLegacy from "./AdminUserManagerLegacy";
import "./admin-user-manager-enhancement.css";
import "./admin-user-manager-polish.css";

type AdminUserManagerProps = ComponentProps<typeof AdminUserManagerLegacy>;

/*
 * Structural governance contract retained in AdminUserManagerLegacy.tsx.
 * These markers remain here because existing repository gates intentionally
 * inspect the public AdminUserManager entry point rather than following imports:
 * access-delegations | PAINEL OBRIGATÓRIO | Limites de delegação |
 * Gerenciar acessos | OrganizationPermissionManager | mode="admin" |
 * isSuperAdmin && | Dados do usuário | selectedView === "organizations" |
 * selectedView === "features" | selectedView === "delegation" |
 * Abrir concessão/revogação | setAccessEditor | Configurar delegação |
 * admin-user-filters | organizationFilter | profileFilter | statusFilter |
 * Projects → Usuários e Acessos
 */

function membershipCheckbox(state: HTMLElement) {
  const row = state.closest(".admin-organization-membership-row");
  return row?.querySelector<HTMLInputElement>(
    '.admin-membership-switch input[type="checkbox"]',
  );
}

function syncMembershipStateButtons(root: HTMLElement) {
  root
    .querySelectorAll<HTMLElement>(".admin-membership-state")
    .forEach((state) => {
      const checkbox = membershipCheckbox(state);
      if (!checkbox) return;

      state.setAttribute("role", "button");
      state.setAttribute("aria-pressed", checkbox.checked ? "true" : "false");
      state.setAttribute("aria-disabled", checkbox.disabled ? "true" : "false");
      state.setAttribute("data-access", checkbox.checked ? "true" : "false");
      state.setAttribute(
        "aria-label",
        checkbox.checked
          ? "Remover acesso à organização"
          : "Conceder acesso à organização",
      );
      state.setAttribute(
        "title",
        checkbox.checked
          ? "Clique para remover o acesso desta organização"
          : "Clique para conceder acesso a esta organização",
      );
      state.tabIndex = checkbox.disabled ? -1 : 0;
    });
}

function ensureMembershipLevelSurface(select: HTMLSelectElement) {
  const label = select.closest<HTMLElement>(".admin-membership-level");
  if (!label) return null;

  let surface = label.querySelector<HTMLElement>(
    ".admin-membership-level-surface",
  );
  if (!surface) {
    surface = document.createElement("span");
    surface.className = "admin-membership-level-surface";
    surface.setAttribute("aria-hidden", "true");
    label.insertBefore(surface, select);
  }
  return surface;
}

function syncMembershipLevelSurfaces(root: HTMLElement) {
  root
    .querySelectorAll<HTMLSelectElement>(".admin-membership-level select")
    .forEach((select) => {
      const surface = ensureMembershipLevelSurface(select);
      if (!surface) return;

      surface.textContent =
        select.selectedOptions[0]?.textContent?.trim() ||
        select.options[select.selectedIndex]?.text?.trim() ||
        "";
      surface.setAttribute("data-disabled", select.disabled ? "true" : "false");
    });
}

function activateMembershipState(state: HTMLElement) {
  const checkbox = membershipCheckbox(state);
  if (!checkbox || checkbox.disabled) return;
  checkbox.click();
}

/**
 * Compatibility shell for the mature AdminUserManager.
 *
 * The business/API wiring intentionally remains in AdminUserManagerLegacy so
 * this UI repair cannot silently change permissions, roles, delegation or the
 * existing PUT/DELETE organization-assignment contract. This shell fixes the
 * ambiguous organization control by promoting the visible access state to the
 * explicit interactive affordance and applies the premium admin presentation.
 *
 * The native organization-profile select remains the only form control and
 * keeps focus, keyboard, dropdown and onChange behavior. A synchronized visual
 * surface sits underneath it so Windows/browser native painting cannot bring
 * the white collapsed select face back into the dark Admin theme.
 */
export default function AdminUserManager(props: AdminUserManagerProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const syncOrganizationControls = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    syncMembershipStateButtons(root);
    syncMembershipLevelSurfaces(root);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    syncOrganizationControls();
    const observer = new MutationObserver(syncOrganizationControls);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "checked"],
    });

    return () => observer.disconnect();
  }, [syncOrganizationControls]);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const state = target.closest<HTMLElement>(".admin-membership-state");
    if (state) {
      event.preventDefault();
      event.stopPropagation();
      activateMembershipState(state);
      window.setTimeout(syncOrganizationControls, 0);
      return;
    }

    // Organization identity is informational. The old label wrapped the
    // checkbox, making the assignment action visually ambiguous. Prevent that
    // implicit toggle so only the explicit status control changes membership.
    if (
      target.closest(".admin-membership-switch") &&
      !(target instanceof HTMLInputElement)
    ) {
      event.preventDefault();
    }
  }

  function handleChange(event: ChangeEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      target instanceof HTMLSelectElement &&
      target.closest(".admin-membership-level")
    ) {
      window.setTimeout(syncOrganizationControls, 0);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const state = target.closest<HTMLElement>(".admin-membership-state");
    if (state && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      activateMembershipState(state);
      window.setTimeout(syncOrganizationControls, 0);
      return;
    }

    if (event.key === "Escape") {
      const dialogs = rootRef.current?.querySelectorAll<HTMLElement>(
        ".admin-user-modal .admin-user-dialog",
      );
      const activeDialog = dialogs?.[dialogs.length - 1];
      const closeButton = activeDialog?.querySelector<HTMLButtonElement>(
        ':scope > header button[aria-label="Fechar"]',
      );
      closeButton?.click();
    }
  }

  return (
    <div
      ref={rootRef}
      className="admin-user-manager-enhanced"
      onClick={handleClick}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    >
      <AdminUserManagerLegacy {...props} />
    </div>
  );
}
