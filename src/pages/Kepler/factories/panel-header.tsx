import type { ComponentProps } from "react";
// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import { PanelHeaderFactory } from "@kepler.gl/components";
import Logo from "../../../assets/images/Logo_Maono.png";
import { useMapPanel } from "../map-panel/MapPanelContext.ts";

export function CustomPanelHeaderFactory(...deps: Parameters<typeof PanelHeaderFactory>) {
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

  const WrappedPanelHeader = (props: ComponentProps<ReturnType<typeof PanelHeaderFactory>>) => {
    const { context } = useMapPanel();
    const saveAction = defaultActionItems.find((item) => item.id === "save");
    const actionItems = [
      ...(context?.capabilities?.saveMap
        ? [
          defaultActionItems.find((item) => item.id === "storage"),
          ...(saveAction ? [{
            ...saveAction,
            label: "",
            tooltip: "Share",
            id: "share-url-only",
            // dropdownComponent: (p: any) => <ShareButton {...p} />,
            // iconComponent: () => <></>,
          }] : []),
        ]
        : []),
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));

    return (
      <DefaultPanelHeader
        {...props}
        logoComponent={CustomKeplerLogo}
        actionItems={actionItems}
      />
    );
  };

  WrappedPanelHeader.deps = (DefaultPanelHeader as typeof DefaultPanelHeader & { deps?: unknown }).deps;
  return WrappedPanelHeader;
}

CustomPanelHeaderFactory.deps = PanelHeaderFactory.deps;
