// // SPDX-License-Identifier: MIT
// // Copyright contributors to the kepler.gl project

// import { SidebarFactory, withState } from "@kepler.gl/components";
// import { visStateLens } from "@kepler.gl/reducers";

// function DatasetAreaBase(props: any) {
//   return <>d</>;
// }

// const DatasetManagement = withState(
//   [visStateLens],
//   (_root: any, ownProps: any) => ({ id: ownProps?.id }),
//   {}
// )(DatasetAreaBase);

// // Custom sidebar will render kepler.gl default side bar
// // adding a wrapper component to edit its style
// function CustomSidebarFactory() {
//   // Inline null close component; nothing to import or pass around
//   const SideBar = SidebarFactory(() => null);

//   const CustomSidebar = (props: any) => (
//     <>
//       <DatasetManagement {...props} />
//       <SideBar {...props} />
//     </>
//   );

//   // Preserve dependency metadata
//   (CustomSidebar as any).deps = (SideBar as any).deps;
//   return CustomSidebar;
// }

// // You can add custom dependencies to your custom factory
// // CustomSidebarFactory.deps = [DatasetAreaFactory];

// export function replaceSidebar() {
//   return [SidebarFactory, CustomSidebarFactory];
// }
