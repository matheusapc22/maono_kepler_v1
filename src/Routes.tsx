import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";

const KeplerAppRoutes = lazy(() => import("./pages/Kepler"));
const ProjectsPage = lazy(() => import("./pages/Projects"));

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />

      <Route
        path="projects"
        element={
          <Suspense>
            <ProjectsPage />
          </Suspense>
        }
      />

      <Route
        path="map"
        element={
          <Suspense>
            <KeplerAppRoutes />
          </Suspense>
        }
      />
      <Route
        path="(:id)"
        element={
          <Suspense>
            <KeplerAppRoutes />
          </Suspense>
        }
      />
      <Route
        path="map/:provider"
        element={
          <Suspense>
            <KeplerAppRoutes />
          </Suspense>
        }
      />
    </Routes>
  );
};

export default AppRoutes;
