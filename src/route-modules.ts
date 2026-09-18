import { createCachedModuleLoader } from "./navigation/route-module-loader";

export const routeModules = {
  kepler: createCachedModuleLoader(() => import("./pages/Kepler")),
  login: createCachedModuleLoader(() => import("./pages/Login")),
  projects: createCachedModuleLoader(() => import("./pages/Projects")),
  admin: createCachedModuleLoader(() => import("./pages/Admin")),
  mapManagement: createCachedModuleLoader(
    () => import("./pages/Kepler/map-panel/MapManagementPage"),
  ),
  editorRequestInbox: createCachedModuleLoader(
    () => import("./pages/Kepler/change-requests/EditorRequestInboxPage"),
  ),
  changeRequestReview: createCachedModuleLoader(
    () => import("./pages/Kepler/change-requests/ChangeRequestReviewPage"),
  ),
} as const;

export type RouteModuleKey = keyof typeof routeModules;

export function preloadRouteModule(route: RouteModuleKey) {
  return routeModules[route]();
}
