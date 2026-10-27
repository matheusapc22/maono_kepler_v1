import { useSyncExternalStore } from "react";
import type { usePointClustering } from "../hooks/use-point-clustering";

export type PointClusteringController = ReturnType<typeof usePointClustering>;

type Listener = () => void;

let currentController: PointClusteringController | null = null;
const listeners = new Set<Listener>();

function notifyControllerChanged() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentController;
}

export function attachPointClusterController(controller: PointClusteringController) {
    currentController = controller;
    notifyControllerChanged();

    return () => {
      if (currentController === controller) {
        currentController = null;
        notifyControllerChanged();
      }
    };
}

export function usePointClusterController() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
