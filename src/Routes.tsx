// AppRoutes.tsx
import React, { lazy, Suspense, useEffect } from "react";
import { Navigate, Routes, Route, useLocation, useParams } from "react-router";

import { normalizeRole } from "./access-control/roles";
import { useSession } from "./auth/session";
import { LoadingOverlay } from "./components/loading";
import LoginPage from "./pages/Login";
import { routeModules } from "./route-modules";
import {
  AdminPageSkeleton,
  ProjectsPageSkeleton,
} from "./components/loading/Skeleton";
import {
  getCloudProvider,
  DEFAULT_CLOUD_PROVIDER,
} from "./pages/Kepler/cloud-providers";
import "./pages/Projects/projects.css";
import "./pages/Admin/admin.css";

const KeplerApp = lazy(routeModules.kepler);
const ProjectsPage = lazy(routeModules.projects);
const AdminPage = lazy(routeModules.admin);
const MapManagementPage = lazy(routeModules.mapManagement);
const EditorRequestInboxPage = lazy(routeModules.editorRequestInbox);
const ChangeRequestReviewPage = lazy(routeModules.changeRequestReview);

const RouteSuspenseFallback: React.FC = () => (
  <LoadingOverlay
    active
    scope="viewport"
    loaderSize="page"
    accessibleLabel="Carregando página"
  />
);

const WithSuspense: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback = <RouteSuspenseFallback /> }) => (
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
    return <Navigate to={buildLoginRedirect(location)} replace />;
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
    <LoadingOverlay
      active
      scope="viewport"
      loaderSize="page"
      accessibleLabel="Autenticando"
    />
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

const DeprecatedProjectCreateRedirect: React.FC = () => {
  const { projectSlug = "" } = useParams<{
    projectSlug: string;
  }>();
  const location = useLocation();
  const destination = `/projects/${encodeURIComponent(projectSlug)}/manage${
    location.search || ""
  }`;

  return <Navigate to={destination} replace />;
};

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />

      <Route path="/login" element={<LoginPage />} />

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
        path="/projects/:projectSlug/requests"
        element={
          <WithSuspense>
            <EditorRequestInboxPage />
          </WithSuspense>
        }
      />

      <Route
        path="/projects/:projectSlug/review/:changeRequestId"
        element={
          <WithSuspense>
            <ChangeRequestReviewPage />
          </WithSuspense>
        }
      />

      <Route
        path="/projects/:projectSlug/create"
        element={<DeprecatedProjectCreateRedirect />}
      />

      <Route
        path="/projects/:projectSlug/map"
        element={<LegacyProjectMapRedirect />}
      />

      <Route path="/auth" element={<AuthCallback />} />

      <Route
        path="/maps/new/create"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />

      <Route
        path="/maps/new/edit"
        element={<Navigate to="/maps/new/create" replace />}
      />

      <Route path="/map" element={<Navigate to="/maps/new/create" replace />} />

      <Route
        path="(:id)"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />
      <Route
        path="map/:provider"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />
      <Route
        path="demo/map"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />
      <Route
        path="demo/map/:provider"
        element={
          <WithSuspense>
            <KeplerApp />
          </WithSuspense>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default AppRoutes;
