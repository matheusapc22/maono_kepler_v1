import { DatasetSectionFactory } from "@kepler.gl/components";
import { connect } from "react-redux";
import checkAdminUser from "../utils/is-admin-user";
// @ts-nocheck

// eslint-disable-next-line react-refresh/only-export-components
function CustomDatasetSectionFactory(...deps: any[]) {
  // @ts-ignore
  const DefaultDatasetSection = DatasetSectionFactory(...deps);

  const WrappedDatasetSection = (props: any) => {
    const isAdminUser = checkAdminUser();
    return (
      <div className="">
        {isAdminUser && <DefaultDatasetSection {...props} />}
      </div>
    );
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
