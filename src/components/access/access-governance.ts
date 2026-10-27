import {requestJson} from '../../lib/api-transport';

type ApiId=number|string;

export type AccessGovernanceCapabilities = {
  mode: "super_admin" | "organization";
  organizationId: ApiId;
  canManageAdditionalAccesses: boolean;
  canGrant: boolean;
  canRevoke: boolean;
  allowedPermissions: string[];
  grantPermissions: string[];
  revokePermissions: string[];
  allowedTargetLevels: string[];
  delegation?: {
    enabled?: boolean;
    expired?: boolean;
    expiresAt?: string | null;
    version?: number;
  } | null;
  reason: string;
};

export async function loadAccessGovernance(
  organizationId: ApiId,
): Promise<AccessGovernanceCapabilities> {
  const data = await requestJson<{
    ok?: boolean;
    capabilities?: AccessGovernanceCapabilities;
  }>(
    "/api/organizations/" +
      encodeURIComponent(String(organizationId)) +
      "/access-governance",
    { cache: "no-store" },
  );

  if (data?.ok === false || !data?.capabilities) {
    throw new Error("Não foi possível carregar a governança de acessos.");
  }

  return data.capabilities;
}
