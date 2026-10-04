// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import React, { useContext, useRef } from "react";
import { LoadDataModalFactory, withState } from "@kepler.gl/components";
import { useIntl } from "react-intl";
import { ThemeProvider } from "styled-components";
import LoadRemoteMap from "../components/load-data-modal/load-remote-map";
import LocalizedLoadTilesetTab from "../components/load-data-modal/tilesets/load-tileset";
import { loadRemoteMap } from "../actions";
import { localizeImportProgress } from "../components/load-data-modal/data-import-messages";
import AddDataSidebar from "../components/maono-map-shell/AddDataSidebar";
import { AddDataDockContext } from "../components/maono-map-shell/AddDataDockContext";

// Only the imported sources use the dark variant. No global Kepler theme or
// ingestion contract changes, including other dialogs and map/layer tools.
const dataSourceTheme = (theme) => ({
  ...theme,
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  modalTitleColor: "var(--maono-map-text)",
  WHITE: "var(--maono-map-panel)",
  AZURE: "var(--maono-map-text)",
  AZURE200: "var(--maono-map-text-soft)",
  panelBackgroundLT: "var(--maono-map-panel)",
  titleColorLT: "var(--maono-map-text)",
  textColorLT: "var(--maono-map-text-soft)",
  labelColorLT: "var(--maono-map-text-soft)",
  subtextColorLT: "var(--maono-map-muted)",
  inputColorLT: "var(--maono-map-text)",
  inputBgdLT: "var(--maono-map-panel-raised)",
  inputBorderColorLT: "var(--maono-map-border)",
  selectBorderColorLT: "var(--maono-map-border)",
  borderColorLT: "var(--maono-map-border)",
});

function AccessibleFileSource({ FileUpload, ...props }) {
  const source = useRef(null);
  return React.createElement("div", { ref: source },
    React.createElement(FileUpload, { ...props, fileLoadingProgress: localizeImportProgress(props.fileLoadingProgress) }),
    React.createElement("button", {
      type: "button",
      className: "maono-map-data-sidebar__file-picker",
      onClick: () => {
        const input = source.current?.querySelector('input[type="file"]');
        if (input) { input.value = ""; input.click(); }
      },
    }, "Selecionar arquivo"),
  );
}

const CustomLoadDataModalFactory = (...deps) => {
  const LoadDataModal = LoadDataModalFactory(...deps);
  const FileUpload = LoadDataModal.defaultLoadingMethods.find((method) => method.id === "upload").elementType;
  const loadingMethods = [
    { id: "upload", label: "modal.loadData.upload", elementType: FileUpload },
    { id: "tileset", label: "modal.loadData.tileset", elementType: LocalizedLoadTilesetTab },
    { id: "remote", label: "modal.loadData.remote", elementType: LoadRemoteMap },
  ];

  const HydrationSafeLoadDataModal = (props) => {
    const dock = useContext(AddDataDockContext);
    const intl = useIntl();
    if (dock) {
      if (!dock.enabled) return null;
      return React.createElement(ThemeProvider, { theme: dataSourceTheme },
        React.createElement(AddDataSidebar, {
          onClose: dock.close,
          busy: Boolean(props.isMapLoading || props.fileLoading),
          renderSource: (source) => {
            const sourceProps = { ...props, intl };
            if (source === "files") return React.createElement(AccessibleFileSource, { ...sourceProps, FileUpload });
            if (source === "tileset") return React.createElement(LocalizedLoadTilesetTab, sourceProps);
            return React.createElement(LoadRemoteMap, sourceProps);
          },
        }),
      );
    }
    // Preserve the legacy shell's initial hydration safeguard.
    if (props.isMapLoading) {
      return null;
    }
    return React.createElement(LoadDataModal, props);
  };

  return withState(
    [],
    (state) => ({
      ...state.demo.app,
      ...state.demo.keplerGl.map.uiState,
      loadingMethods,
    }),
    { onLoadRemoteMap: loadRemoteMap },
  )(HydrationSafeLoadDataModal);
};

CustomLoadDataModalFactory.deps = LoadDataModalFactory.deps;

export function replaceLoadDataModal() {
  return [LoadDataModalFactory, CustomLoadDataModalFactory];
}
