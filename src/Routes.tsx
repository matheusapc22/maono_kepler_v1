// AppRoutes.tsx
import React, { lazy, Suspense, useEffect } from "react";
import { Navigate, Routes, Route, useLocation } from "react-router";

import {
  can,
  type AccessControlOrganization,
  type AccessControlUser,
  type PermissionContext,
} from "./access-control/can";
import { PERMISSION } from "./access-control/permissions";
import { useSession, type MaonoUser } from "./auth/session";
import {
  AdminPageSkeleton,
  ProjectsPageSkeleton,
  Skeleton,
} from "./components/loading/Skeleton";
import {
  getCloudProvider,
  DEFAULT_CLOUD_PROVIDER,
} from "./pages/Kepler/cloud-providers";

const KeplerApp = lazy(() => import("./pages/Kepler"));
const LoginPage = lazy(() => import("./pages/Login"));
const ProjectsPage = lazy(() => import("./pages/Projects"));
const AdminPage = lazy(() => import("./pages/Admin"));

const RouteLoading: React.FC = () => (
  <main className="mm-loading-screen" aria-busy="true">
    <div className="mm-skeleton-stack" style={{ width: "min(360px, 82vw)" }}>
      <Skeleton width="58%" height={24} />
      <Skeleton width="100%" height={12} />
      <Skeleton width="82%" height={12} />
    </div>
    <span className="mm-sr-only" role="status">
      Carregando página.
    </span>
  </main>
);

const WithSuspense: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback = <RouteLoading /> }) => (
  <Suspense fallback={fallback}>{children}</Suspense>
);

function buildSessionPermissionContext(
  user: MaonoUser | null,
): PermissionContext {
  if (!user) {
    return {};
  }

  const accessUser = user as AccessControlUser & {
    activeOrganization?: AccessControlOrganization | null;
    organization?: AccessControlOrganization | null;
  };

  const organization =
    accessUser.activeOrganization ?? accessUser.organization ?? undefined;

  const organizationId =
    accessUser.activeOrganizationId ??
    accessUser.organizationId ??
    accessUser.organization_id ??
    organization?.id ??
    organization?.organizationId ??
    undefined;

  return {
    organizationId,
    organization: organization ?? undefined,
    permissions: accessUser.permissions,
    scopes: accessUser.scopes,
  };
}

function buildLoginRedirect(location: ReturnType<typeof useLocation>) {
  const next = `${location.pathname}${location.search || ""}`;

  return `/login?next=${encodeURIComponent(next)}`;
}

const RestrictedAccess: React.FC = () => (
  <main style={{ padding: 24 }}>
    <h1>Acesso restrito</h1>
    <p>
      Você não possui permissão para acessar esta área administrativa neste
      contexto.
    </p>
  </main>
);

const AdminRouteGuard: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { authenticated, loading, user } = useSession();
  const location = useLocation();

  if (loading) {
    return <AdminPageSkeleton />;
  }

  if (!authenticated) {
    return (
      <Navigate
        to={buildLoginRedirect(location)}
        replace
      />
    );
  }

  const permissionContext = buildSessionPermissionContext(user);
  const allowed = can(
    user as AccessControlUser | null,
    PERMISSION.ADMIN_PANEL_ACCESS,
    permissionContext,
  );

  if (!allowed) {
    return <RestrictedAccess />;
  }

  return <>{children}</>;
};

const AuthCallback: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const authProvider = getCloudProvider(DEFAULT_CLOUD_PROVIDER);

    // @ts-expect-error: Unresolved
    const token = authProvider.getAccessTokenFromLocation(location);

    if (window.opener) {
      window.opener.postMessage({ token }, window.location.origin);

      if (typeof window.close === "function") {
        window.close();
      }
    }
  }, [location]);

  return (
    <div style={{ padding: 16 }}>
      Authenticating… you can close this window.
    </div>
  );
};

const NotFound: React.FC = () => (
  <div style={{ padding: 16 }}>Page not found.</div>
);

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />

      <Route
        path="/login"
        element={
          <WithSuspense>
            <LoginPage />
          </WithSuspense>
        }
      />

      <Route
        path="/projects"
        element={
          <WithSuspense fallback={<ProjectsPageSkeleton />}>
            <ProjectsPage />
          </WithSuspense>
        }
      />

      <Route
        path="/admin"
        element={
          <AdminRouteGuard>
            <WithSuspense fallback={<AdminPageSkeleton />}>
              <AdminPage />
            </WithSuspense>
          </AdminRouteGuard>
        }
      />

      <Route
        path="/admin/files"
        element={<Navigate to="/admin?section=organizations" replace />}
      />

      <Route
        path="/projects/:projectSlug/map"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />

      <Route path="/auth" element={<AuthCallback />} />

      <Route
        path="map"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />

      <Route path="(:id)" element={<KeplerApp />} />
      <Route path="map/:provider" element={<KeplerApp />} />
      <Route path="demo/map" element={<KeplerApp />} />
      <Route path="demo/map/:provider" element={<KeplerApp />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default AppRoutes;
