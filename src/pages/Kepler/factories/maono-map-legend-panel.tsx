// SPDX-License-Identifier: MIT
// @ts-nocheck

import React from "react";
import styled, { ThemeProvider } from "styled-components";

import { MapLegendPanelFactory } from "@kepler.gl/components";

import {
  calculateMaonoLegendInitialPosition,
  MAONO_LEGEND_DEFAULT_WIDTH,
} from "./maono-map-legend-position";

const MaonoLegendFrame = styled.div`
  width: min(${MAONO_LEGEND_DEFAULT_WIDTH}px, calc(100vw - 32px));
  max-width: min(${MAONO_LEGEND_DEFAULT_WIDTH}px, calc(100vw - 32px));
  overflow: hidden;
  border: 1px solid rgba(197, 160, 89, 0.48);
  border-radius: 14px;
  background: rgba(8, 12, 19, 0.96);
  box-shadow:
    inset 0 1px rgba(255, 255, 255, 0.03),
    0 22px 52px rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(16px);

  .map-control-panel {
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    border-radius: inherit;
  }

  .map-control__panel-header {
    border-bottom: 1px solid rgba(197, 160, 89, 0.18);
    background: linear-gradient(
      180deg,
      rgba(17, 25, 39, 0.98),
      rgba(10, 15, 24, 0.98)
    );
    color: #d9b96e;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .map-control__panel-content {
    width: 100%;
    min-width: 0;
    max-height: min(420px, calc(100vh - 160px));
    background: rgba(8, 12, 19, 0.96);
    scrollbar-color: rgba(197, 160, 89, 0.72) transparent;
    scrollbar-width: thin;
  }

  .map-control__panel-content::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }

  .map-control__panel-content::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(197, 160, 89, 0.72);
  }
`;

function maonoLegendTheme(outerTheme = {}) {
  return {
    ...outerTheme,
    activeColor: "#c5a059",
    floatingBtnActColor: "#f1d28a",
    labelColor: "#edf2f8",
    textColor: "#e6edf6",
    textColorHl: "#f8fafc",
    titleTextColor: "#d9b96e",
    mapPanelBackgroundColor: "rgba(8, 12, 19, 0.96)",
    mapPanelHeaderBackgroundColor: "rgba(15, 22, 34, 0.98)",
    mapControl: {
      ...(outerTheme.mapControl || {}),
      width: MAONO_LEGEND_DEFAULT_WIDTH,
    },
  };
}

function hasStoredLegendPosition(position) {
  return Boolean(
    position &&
      Number.isFinite(Number(position.x)) &&
      Number.isFinite(Number(position.y)) &&
      ["left", "right"].includes(position.anchorX) &&
      ["top", "bottom"].includes(position.anchorY),
  );
}

function mapControlsWithInitialLegendPosition(mapControls, position) {
  if (!mapControls?.mapLegend || !position) {
    return mapControls;
  }

  return {
    ...mapControls,
    mapLegend: {
      ...mapControls.mapLegend,
      settings: {
        ...(mapControls.mapLegend.settings || {}),
        position,
      },
    },
  };
}

MaonoMapLegendPanelFactory.deps = MapLegendPanelFactory.deps;

/**
 * Substitui somente a apresentação e a posição inicial da legenda.
 *
 * A lista de layers, a simbologia, os controles, o drag, o resize e a
 * persistência de settings continuam pertencendo ao MapLegendPanel/MapLegend
 * oficiais do Kepler. Não existe segunda legenda nem espelhamento de estado.
 *
 * Importante: este factory NÃO cria uma segunda conexão Redux. MapControl já
 * entrega mapControls e setMapControlSettings corretamente escopados para esta
 * instância do mapa. Reutilizar withState aqui sombreava esse callback nativo e
 * fazia o DraggableLegend executar uma action fora do fluxo esperado ao abrir.
 */
export function MaonoMapLegendPanelFactory(
  MapControlTooltip,
  MapControlPanel,
  MapLegend,
) {
  const MaonoLegendControlPanel = (props) => (
    <MaonoLegendFrame data-maono-kepler-factory="map-legend-panel">
      <MapControlPanel
        {...props}
        header="maono.legend.title"
        className="maono-map-legend-panel"
      />
    </MaonoLegendFrame>
  );

  const NativeMapLegendPanel = MapLegendPanelFactory(
    MapControlTooltip,
    MaonoLegendControlPanel,
    MapLegend,
  );

  const MaonoMapLegendPanel = (props) => {
    const mapLegend = props.mapControls?.mapLegend;
    const storedPosition = mapLegend?.settings?.position;
    const width = Number(props.mapState?.width) || 0;
    const height = Number(props.mapState?.height) || 0;

    // A posição Maõno é somente uma projeção de apresentação enquanto ainda
    // não existe posição persistida. Assim, abrir a legenda não dispara Redux.
    // No primeiro drag/resize o próprio Kepler persiste a posição por meio do
    // setMapControlSettings ORIGINAL recebido em props.
    const initialPosition =
      mapLegend?.active && !props.isExport && !hasStoredLegendPosition(storedPosition)
        ? calculateMaonoLegendInitialPosition({ width, height })
        : null;
    const mapControls = mapControlsWithInitialLegendPosition(
      props.mapControls,
      initialPosition,
    );

    return (
      <ThemeProvider theme={maonoLegendTheme}>
        <NativeMapLegendPanel {...props} mapControls={mapControls} />
      </ThemeProvider>
    );
  };

  MaonoMapLegendPanel.displayName = "MaonoMapLegendPanel";
  return MaonoMapLegendPanel;
}

export function replaceMapLegendPanel() {
  return [MapLegendPanelFactory, MaonoMapLegendPanelFactory];
}
