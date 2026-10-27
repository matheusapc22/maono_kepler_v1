
import { PointClusterControllerBridge } from "../clustering/point-cluster-controller-bridge";

export default function PointClusterSettingsPanel({
  controller,
}: { controller: import("../clustering/point-cluster-controller-store").PointClusteringController }) {
  return <PointClusterControllerBridge controller={controller} />;
}
