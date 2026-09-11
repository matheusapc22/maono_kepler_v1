import React from "react";
import { DatasetSectionFactory } from "@kepler.gl/components";
import { connect } from "react-redux";

// @ts-nocheck
// eslint-disable-next-line react-refresh/only-export-components
function CustomDatasetSectionFactory(...deps: any[]) {
  // 🔧 cast necessário por limitação das typings do Kepler
  const DefaultDatasetSection = (DatasetSectionFactory as any)(...deps);
  const WrappedDatasetSection = (props: any) => {
    return <DefaultDatasetSection {...props} />;
  };
  // preserva deps do Kepler
  (WrappedDatasetSection as any).deps = (DefaultDatasetSection as any).deps;
  const mapDispatchToProps = (dispatch: any) => ({ dispatch });
  return connect(null, mapDispatchToProps)(WrappedDatasetSection);
}

export function replaceDatasetSection() {
  const customFactory: any = CustomDatasetSectionFactory;
  (customFactory as any).deps = (DatasetSectionFactory as any).deps;
  return [DatasetSectionFactory, customFactory] as const;
}
