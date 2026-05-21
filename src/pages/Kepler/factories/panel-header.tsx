// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import { PanelHeaderFactory, Icons } from "@kepler.gl/components";
import {
  BUG_REPORT_LINK,
  USER_GUIDE_DOC,
} from "@kepler.gl/constants";
import Logo from "../../../assets/images/Logo_Maono.png";
import checkAdminUser from "../utils/is-admin-user";

export function CustomPanelHeaderFactory(...deps) {
  const PanelHeader = PanelHeaderFactory(...deps);
  const defaultActionItems = PanelHeader.defaultProps.actionItems;
  const isAdminUser = checkAdminUser();

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

  PanelHeader.defaultProps = {
    ...PanelHeader.defaultProps,
    logoComponent: CustomKeplerLogo,
    actionItems: isAdminUser
      ? [
          {
            id: "bug",
            iconComponent: Icons.Bug,
            href: BUG_REPORT_LINK,
            blank: true,
            tooltip: "Bug Report",
            onClick: () => {},
          },
          {
            id: "docs",
            iconComponent: Icons.Docs2,
            href: USER_GUIDE_DOC,
            blank: true,
            tooltip: "User Guide",
            onClick: () => {},
          },
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
      : [],
  };

  return PanelHeader;
}

CustomPanelHeaderFactory.deps = PanelHeaderFactory.deps;

export function replacePanelHeader() {
  return [PanelHeaderFactory, CustomPanelHeaderFactory];
}
