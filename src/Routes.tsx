import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

const KeplerAppRoutes = lazy(() => import("./pages/Kepler"));

const AppRoutes = () => {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Suspense>
            <KeplerAppRoutes />
          </Suspense>
        }
      />

      <Route path="map" element={<KeplerAppRoutes />} />
      <Route path="(:id)" element={<KeplerAppRoutes />} />
      <Route path="map/:provider" element={<KeplerAppRoutes />} />
    </Routes>
  );
};

export default AppRoutes;
