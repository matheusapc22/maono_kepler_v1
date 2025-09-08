// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import { PanelHeaderFactory, Icons } from "@kepler.gl/components";
import { KEPLER_GL_VERSION } from "@kepler.gl/constants";
import Logo from "../../../assets/images/logo-2.png";
import { connect } from "react-redux";

export function CustomPanelHeaderFactory(...deps) {
  const PanelHeader = PanelHeaderFactory(...deps);
  const defaultActionItems = PanelHeader.defaultProps.actionItems;

  console.log(defaultActionItems);

  const CustomKeplerLogo = () => {
    /*
     * Replaces <KeplerGlLogo /> component
     */
    return (
      <div className="flex flex-col">
        <img className="w-40 -mt-2" src={Logo} />
        <span className="text-[10px] ml-20 -mt-3 text-white">
          {KEPLER_GL_VERSION}
        </span>
      </div>
    );
  };

  const ShareButton = connect((root: any, own: any) => ({
    rootState: root,
    keplerGlId: own.id,
  }))((props: any) => {
    return (
      <button
        className="px-2 py-1 border rounded border-white text-white"
        title="Share URL"
        onClick={props?.onShareMap}
      >
        Share
      </button>
    );
  });

  PanelHeader.defaultProps = {
    ...PanelHeader.defaultProps,
    logoComponent: CustomKeplerLogo,
    actionItems: [
      // {
      //   id: "bug",
      //   iconComponent: Icons.Bug,
      //   href: BUG_REPORT_LINK,
      //   blank: true,
      //   tooltip: "Bug Report",
      //   onClick: () => {},
      // },
      // {
      //   id: "docs",
      //   iconComponent: Icons.Docs2,
      //   href: USER_GUIDE_DOC,
      //   blank: true,
      //   tooltip: "User Guide",
      //   onClick: () => {},
      // },
      // defaultActionItems.find((item) => item.id === "storage"),
      {
        // ...defaultActionItems.find((item) => item.id === "save"),
        label: "",
        tooltip: "Share",
        id: "share-url-only",
        dropdownComponent: (p: any) => <ShareButton {...p} />,
        iconComponent: () => <></>,
      },
    ],
  };
  return PanelHeader;
}

CustomPanelHeaderFactory.deps = PanelHeaderFactory.deps;

export function replacePanelHeader() {
  return [PanelHeaderFactory, CustomPanelHeaderFactory];
}
