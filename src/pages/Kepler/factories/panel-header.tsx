// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import { PanelHeaderFactory } from "@kepler.gl/components";
import Logo from "../../../assets/images/Logo_Maono.png";
import { useMapPanel } from "../map-panel/MapPanelContext";

export function CustomPanelHeaderFactory(...deps) {
  const DefaultPanelHeader = PanelHeaderFactory(...deps);
  const defaultActionItems =
    DefaultPanelHeader.defaultProps?.actionItems ?? [];

  const CustomKeplerLogo = () => {
    /*
     * Replaces <KeplerGlLogo /> component
     */
    return (
      <div className="flex flex-col">
        <img className="w-40 -mt-2" src={Logo} alt="Logo Maõno" />
      </div>
    );
  };

  const WrappedPanelHeader = (props) => {
    const { context } = useMapPanel();
    const actionItems = [
      ...(context?.capabilities?.saveMap
        ? [
          defaultActionItems.find((item) => item.id === "storage"),
          {
            ...defaultActionItems.find((item) => item.id === "save"),
            label: "",
            tooltip: "Share",
            id: "share-url-only",
            // dropdownComponent: (p: any) => <ShareButton {...p} />,
            // iconComponent: () => <></>,
          },
        ]
        : []),
    ].filter(Boolean);

    return (
      <DefaultPanelHeader
        {...props}
        logoComponent={CustomKeplerLogo}
        actionItems={actionItems}
      />
    );
  };

  WrappedPanelHeader.deps = DefaultPanelHeader.deps;
  return WrappedPanelHeader;
}

CustomPanelHeaderFactory.deps = PanelHeaderFactory.deps;

export function replacePanelHeader() {
  return [PanelHeaderFactory, CustomPanelHeaderFactory];
}
