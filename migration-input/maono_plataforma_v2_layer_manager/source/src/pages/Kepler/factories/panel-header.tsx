// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import React from "react";
import { PanelHeaderFactory } from "@kepler.gl/components";
import { KEPLER_GL_VERSION } from "@kepler.gl/constants";
import Logo from "../../../assets/images/logo-2.png";

export function CustomPanelHeaderFactory(...deps) {
  const PanelHeader = PanelHeaderFactory(...deps);
  const defaultActionItems = PanelHeader.defaultProps.actionItems;
  const actionItems = defaultActionItems.filter((item) => item.id !== "save");

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

  PanelHeader.defaultProps = {
    ...PanelHeader.defaultProps,
    logoComponent: CustomKeplerLogo,
    actionItems,
  };
  return PanelHeader;
}

CustomPanelHeaderFactory.deps = PanelHeaderFactory.deps;

export function replacePanelHeader() {
  return [PanelHeaderFactory, CustomPanelHeaderFactory];
}
