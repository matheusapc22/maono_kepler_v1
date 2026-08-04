// @ts-nocheck

import { PointClusterControllerBridge } from "../clustering/point-cluster-controller-bridge";

export default function PointClusterSettingsPanel({
  controller,
}) {
  return <PointClusterControllerBridge controller={controller} />;
}
