import { DatasetSectionFactory } from "@kepler.gl/components";
import { connect } from "react-redux";
// @ts-nocheck

// eslint-disable-next-line react-refresh/only-export-components
function CustomDatasetSectionFactory(...deps: any[]) {
  // @ts-ignore
  const DefaultDatasetSection = DatasetSectionFactory(...deps);

  // const WrappedDatasetSection = (props: any) => (
  const WrappedDatasetSection = () => (
    <div className="flex flex-col">
      {/* <DefaultDatasetSection {...props} /> */}
    </div>
  );

  // keep dependency metadata intact
  (WrappedDatasetSection as any).deps = (DefaultDatasetSection as any).deps;

  // react-redux connect just to expose dispatch like your Geocoder pattern
  const mapDispatchToProps = (dispatch: any) => ({ dispatch });
  return connect(null, mapDispatchToProps)(WrappedDatasetSection);
}

/** Injector hook: replace DatasetSection with our wrapper */
export function replaceDatasetSection() {
  const customFactory: any = CustomDatasetSectionFactory;
  // mirror deps of the entry factory so DI stays intact
  (customFactory as any).deps = (DatasetSectionFactory as any).deps;

  return [DatasetSectionFactory, customFactory] as const;
}
