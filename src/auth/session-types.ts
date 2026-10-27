import type {ProjectThumbnailState} from '../pages/Kepler/thumbnail/thumbnail-api';
import type {Permission} from '../access-control/permissions';
import type {SessionHealth} from './session-resilience';

export type MaonoFeatureFlag = string;

export type MaonoId = number | string;

export type MaonoLimits = Record<string, unknown>;

export type MaonoOrganization = {
  id: MaonoId;
  organizationId?: MaonoId | null;
  organization_id?: MaonoId | null;
  name?: string;
  slug?: string;
  role?: MaonoRole;
  accessLevel?: string;
  access_level?: string;
  active?: boolean;
  plan?: string;
  permissions?: Permission[];
  deniedPermissions?: Permission[];
  scopes?: string[];
  featureFlags?: MaonoFeatureFlag[];
  limits?: MaonoLimits;
};

export type MaonoProject = Partial<ProjectThumbnailState> & {
  id: MaonoId;
  name: string;
  slug: string;
  description?: string;
  organizationId?: MaonoId | null;
  organization_id?: MaonoId | null;
  accessLevel: "owner" | "editor" | "viewer" | string;
  access_level?: "owner" | "editor" | "viewer" | string;
  permissions?: Permission[];
  deniedPermissions?: Permission[];
  active?: boolean;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  createdBy?: ProjectActor | null;
  updatedBy?: ProjectActor | null;
  metadataVersion?: number;
  createdAt?: string;
  updatedAt?: string;

  /**
   * Não incluir no payload público:
   * - dropboxRootPath
   * - defaultConfigFile
   * - caminhos internos
   * - tokens
   * - metadados administrativos sensíveis
   */
};

export type MaonoRole =
  | "super_admin"
  | "admin"
  | "owner"
  | "editor"
  | "viewer"
  | "client"
  | string;

export type ProjectActor = {
  id: MaonoId;
  name: string;
};

export type MaonoUser = {
  id: MaonoId;
  email: string;
  name?: string;
  role: MaonoRole;

  /**
   * Mantém rastreabilidade temporária para migração de roles legadas.
   * Exemplo: backend antigo pode retornar "client", mas a UI deve operar como "owner".
   */
  rawRole?: string;

  organizationId?: MaonoId | null;
  organization_id?: MaonoId | null;
  activeOrganizationId?: MaonoId | null;
  activeOrganization?: MaonoOrganization | null;
  organization?: MaonoOrganization | null;
  organizations?: MaonoOrganization[];

  permissions?: Permission[];
  deniedPermissions?: Permission[];
  scopes?: string[];
  accessLevel?: string | null;
  access_level?: string | null;
  featureFlags?: MaonoFeatureFlag[];
  limits?: MaonoLimits;
};

export type PublicSession = {
  authenticated: boolean;
  user: MaonoUser | null;
  projects: MaonoProject[];
  activeOrganization?: MaonoOrganization | null;
  organizations?: MaonoOrganization[];
  deniedPermissions?: Permission[];
};

export type SessionState = {
  authenticated: boolean;
  loading: boolean;
  health: SessionHealth;
  user: MaonoUser | null;
  projects: MaonoProject[];
  activeOrganization: MaonoOrganization | null;
  organizations: MaonoOrganization[];
  switchingOrganization: boolean;
  organizationSwitchError: string | null;
  switchOrganization: (organizationId: MaonoId) => Promise<void>;
  clearOrganizationSwitchError: () => void;
  refreshSession: (options?: { signal?: AbortSignal }) => Promise<void>;
  login: (
    email: string,
    password: string,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
  logout: () => Promise<void>;
};
