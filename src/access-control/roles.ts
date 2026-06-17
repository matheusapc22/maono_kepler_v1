export const MAONO_ROLES = [
  "super_admin",
  "admin",
  "owner",
  "editor",
  "viewer",
] as const;

export type MaonoRole = (typeof MAONO_ROLES)[number];
export type LegacyMaonoRole = "client";

const ROLE_ALIASES: Record<LegacyMaonoRole, MaonoRole> = {
  client: "owner",
};

const ROLE_SET = new Set<string>(MAONO_ROLES);

export function isMaonoRole(role: unknown): role is MaonoRole {
  return typeof role === "string" && ROLE_SET.has(role);
}

export function normalizeRole(role: string | null | undefined): MaonoRole | null {
  if (!role) {
    return null;
  }

  const normalized = role.trim().toLowerCase();

  if (isMaonoRole(normalized)) {
    return normalized;
  }

  return ROLE_ALIASES[normalized as LegacyMaonoRole] ?? null;
}

export function isPlatformRole(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  return normalized === "super_admin" || normalized === "admin";
}
