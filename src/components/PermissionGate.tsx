import type { ReactNode } from "react";

import {
  can,
  type AccessControlUser,
  type PermissionContext,
} from "../access-control/can";
import type { Permission } from "../access-control/permissions";
import { useSession } from "../auth/session";

export interface PermissionGateProps {
  action: Permission;
  context?: PermissionContext;
  user?: AccessControlUser | null;
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * PermissionGate adapta apenas a experiência visual da interface.
 *
 * Ele pode ocultar botões, links, abas e seções, mas não é controle
 * de segurança real. Toda ação sensível precisa continuar sendo
 * validada no backend.
 */
export function PermissionGate({
  action,
  context = {},
  user,
  fallback = null,
  children,
}: PermissionGateProps) {
  const session = useSession();
  const currentUser = user ?? (session.user as AccessControlUser | null) ?? null;

  if (!can(currentUser, action, context)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

export default PermissionGate;