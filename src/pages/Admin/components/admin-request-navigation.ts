import type { MaonoOrganization, MaonoUser } from "../../../auth/session";

/** A session membership is required even for an Admin navigation shortcut.
 * The destination validates membership and permissions again on every read.
 */
export function adminTicketDestination(
  user: MaonoUser | null,
  activeOrganization: MaonoOrganization | null,
  organizations: MaonoOrganization[],
): { href: string; organizationName: string } | null {
  if (user?.role !== "super_admin" || !activeOrganization || activeOrganization.active === false) return null;
  const id = String(activeOrganization.id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
  const membership = organizations.find(organization => String(organization.id) === id && organization.active !== false);
  if (!membership) return null;
  return {
    href: `/projects?cc_org=${encodeURIComponent(id)}&cc_view=list`,
    organizationName: membership.name || `Organização ${id}`,
  };
}
