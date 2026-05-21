// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import { PanelHeaderFactory } from "@kepler.gl/components";
import Logo from "../../../assets/images/Logo_Maono.png";
import { connect } from "react-redux";

export function CustomPanelHeaderFactory(...deps) {
  const PanelHeader = PanelHeaderFactory(...deps);

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
      {
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
