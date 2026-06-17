// AppRoutes.tsx
import React, { lazy, Suspense, useEffect } from "react";
import { Navigate, Routes, Route, useLocation } from "react-router";
import {
  getCloudProvider,
  DEFAULT_CLOUD_PROVIDER,
} from "./pages/Kepler/cloud-providers";

const KeplerApp = lazy(() => import("./pages/Kepler"));
const LoginPage = lazy(() => import("./pages/Login"));
const ProjectsPage = lazy(() => import("./pages/Projects"));
const AdminPage = lazy(() => import("./pages/Admin"));

const WithSuspense: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
    {children}
  </Suspense>
);

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
          <WithSuspense>
            <ProjectsPage />
          </WithSuspense>
        }
      />
      <Route
        path="/admin"
        element={
          <WithSuspense>
            <AdminPage />
          </WithSuspense>
        }
      />
      <Route path="/admin/files" element={<Navigate to="/admin?section=organizations" replace />} />
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
