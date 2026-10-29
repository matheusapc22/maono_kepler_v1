import { useEffect, type ReactNode } from "react";
import { attachPointClusterController, type PointClusteringController } from "./point-cluster-controller-store";

export function PointClusterControllerBridge({
  controller,
}: {
  controller: PointClusteringController;
}): ReactNode {
  useEffect(() => {
    return attachPointClusterController(controller);
  }, [controller]);

  return null;
}
