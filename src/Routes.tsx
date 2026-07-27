// AppRoutes.tsx
import React, { lazy, Suspense, useEffect } from "react";
import {
  Navigate,
  Routes,
  Route,
  useLocation,
  useParams,
} from "react-router";

import { normalizeRole } from "./access-control/roles";
import { useSession } from "./auth/session";
import {
  AdminPageSkeleton,
  ProjectsPageSkeleton,
  Skeleton,
} from "./components/loading/Skeleton";
import {
  getCloudProvider,
  DEFAULT_CLOUD_PROVIDER,
} from "./pages/Kepler/cloud-providers";
import "./pages/Projects/projects.css";
import "./pages/Admin/admin.css";

const KeplerApp = lazy(() => import("./pages/Kepler"));
const LoginPage = lazy(() => import("./pages/Login"));
const ProjectsPage = lazy(() => import("./pages/Projects"));
const AdminPage = lazy(() => import("./pages/Admin"));
const MapManagementPage = lazy(
  () => import("./pages/Kepler/map-panel/MapManagementPage"),
);

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

  const allowed = normalizeRole(user?.role) === "super_admin";

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

const LegacyProjectMapRedirect: React.FC = () => {
  const { projectSlug = "" } = useParams<{
    projectSlug: string;
  }>();

  return (
    <Navigate
      to={`/projects/${encodeURIComponent(projectSlug)}/manage`}
      replace
    />
  );
};

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
        path="/projects/:projectSlug/manage"
        element={
          <WithSuspense>
            <MapManagementPage />
          </WithSuspense>
        }
      />

      <Route
        path="/projects/:projectSlug/view"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />

      <Route
        path="/projects/:projectSlug/edit"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />

      <Route
        path="/projects/:projectSlug/map"
        element={<LegacyProjectMapRedirect />}
      />

      <Route path="/auth" element={<AuthCallback />} />

      <Route
        path="/maps/new/edit"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />

      <Route path="/map" element={<Navigate to="/maps/new/edit" replace />} />

      <Route path="(:id)" element={<KeplerApp />} />
      <Route path="map/:provider" element={<KeplerApp />} />
      <Route path="demo/map" element={<KeplerApp />} />
      <Route path="demo/map/:provider" element={<KeplerApp />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default AppRoutes;
