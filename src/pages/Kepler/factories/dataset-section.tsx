import type { ComponentProps } from "react";
import { DatasetSectionFactory } from "@kepler.gl/components";
import { connect } from "react-redux";

import { useMapPanelCapability } from "../map-panel/MapPanelContext";

// eslint-disable-next-line react-refresh/only-export-components
function CustomDatasetSectionFactory(...deps: Parameters<typeof DatasetSectionFactory>) {
  const DefaultDatasetSection = DatasetSectionFactory(...deps);

  const WrappedDatasetSection = (props: ComponentProps<ReturnType<typeof DatasetSectionFactory>>) => {
    const canCreateLayer = useMapPanelCapability("createLayer");

    return canCreateLayer ? <DefaultDatasetSection {...props} /> : null;
  };

  // keep dependency metadata intact
  (WrappedDatasetSection as any).deps = (DefaultDatasetSection as any).deps;

  const mapDispatchToProps = (dispatch: any) => ({ dispatch });
  return connect(null, mapDispatchToProps)(WrappedDatasetSection);
}

/** Injector hook: replace DatasetSection with our wrapper */
export function replaceDatasetSection() {
  const customFactory: any = CustomDatasetSectionFactory;
  (customFactory as any).deps = (DatasetSectionFactory as any).deps;

  return [DatasetSectionFactory, customFactory] as const;
}
