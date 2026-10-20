// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import AutoSizer from "react-virtualized/dist/commonjs/AutoSizer";
import styled, { ThemeProvider, StyleSheetManager } from "styled-components";
import Window from "global/window";
import { connect } from "react-redux";
import { useDispatch, useSelector } from "react-redux";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import isPropValid from "@emotion/is-prop-valid";
import { WebMercatorViewport } from "@deck.gl/core";

// 🚀 A MÁGICA ENTRA AQUI: Importamos a camada MVT do Deck.gl
import { MVTLayer } from "@deck.gl/geo-layers";

import { ScreenshotWrapper } from "@openassistant/ui";
import {
  setStartScreenCapture,
  setScreenCaptured,
  AiAssistantPanel,
  setMapBoundary,
} from "@kepler.gl/ai-assistant";

import { getApplicationConfig } from "@kepler.gl/utils";
import { SqlPanel } from "@kepler.gl/duckdb";
import "./kepler-overrides.css";
import Banner from "./components/banner";
import Announcement, { FormLink } from "./components/announcement";

import { panelBorderColor, theme as keplerDefaultTheme } from "@kepler.gl/styles";

// 🚀 A RAIZ DO PROBLEMA RESOLVIDA: O TEMA MAÕNO
// Sobrescrevemos todas as variáveis que o Kepler usa para pintar coisas de "Ativo/Azul"
const maonoTheme = {
  ...keplerDefaultTheme,
  activeColor: '#C5A059',           // O Dourado principal
  activeColorHover: '#E2C275',      // O Dourado claro no hover
  primaryBtnBgd: '#C5A059',
  primaryBtnBgdHover: '#E2C275',
  primaryBtnActBgd: '#8A6D3B',
  textColorHl: '#C5A059',           // Texto destacado
  panelToggleBgd: '#C5A059',        // Fundo da alça de arrastar!
};

// 🚀 IMPORTS DO NÚCLEO DO KEPLER
import {
  injectComponents
} from "@kepler.gl/components";

// 🚀 IMPORTS DAS SUAS FÁBRICAS LOCAIS
import { replaceLoadDataModal } from "./factories/load-data-modal";
import { replaceMapControl } from "./factories/map-control";
import { replacePanelHeader } from "./factories/panel-header";
import { replaceDatasetSection } from "./factories/dataset-section";

import {
  CLOUD_PROVIDERS_CONFIGURATION,
  DEFAULT_FEATURE_FLAGS,
} from "./constants/default-settings";

// 🚀 IMPORTAÇÃO DA NOSSA LOCALIZAÇÃO
import { messages } from "./constants/localization";

import {
  loadRemoteMap,
  loadSampleConfigurations,
  onExportFileSuccess,
  onLoadCloudMapSuccess,
} from "./actions";

import {
  loadCloudMap,
  addDataToMap,
  replaceDataInMap,
  toggleMapControl,
  toggleModal,
} from "@kepler.gl/actions";

import * as KeplerActions from "@kepler.gl/actions";

import { CLOUD_PROVIDERS } from "./cloud-providers";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import sampleTripData, {
  testCsvData,
  sampleTripDataConfig,
} from "./data/sample-trip-data";
import sampleGeojsonPoints from "./data/sample-geojson-points";
import sampleGeojsonConfig from "./data/sample-geojson-config";
import sampleH3Data, { config as h3MapConfig } from "./data/sample-hex-id-csv";
import sampleS2Data, {
  config as s2MapConfig,
  dataId as s2DataId,
} from "./data/sample-s2-data";
import sampleAnimateTrip, {
  pointData,
  pointDataId,
  animateTripDataId,
  replacePointData,
  config as syncedTripConfig,
} from "./data/sample-animate-trip-data";
import sampleIconCsv from "./data/sample-icon-csv";
import sampleGpsData from "./data/sample-gps-data";
import sampleRowData, { config as rowDataConfig } from "./data/sample-row-data";
import {
  processCsvData,
  processGeojson,
  processRowObject,
} from "@kepler.gl/processors";

import { useParams, useSearchParams } from "react-router";

const KEPLER_ID = "map";

// ✅ KeplerGl INJETADO (customizado apenas com suas fábricas locais)
const KeplerGl = injectComponents([
  replaceLoadDataModal(),
  replaceMapControl(),
  replacePanelHeader(),
  replaceDatasetSection(),
]);

function shouldForwardProp(propName, target) {
  if (typeof target === "string") {
    return isPropValid(propName);
  }
  return true;
}

const BannerHeight = 48;
const BannerKey = `banner-${FormLink}`;

const keplerGlGetState = (state) => {
  const keplerGlState = state?.demo?.keplerGl;
  if (keplerGlState && typeof keplerGlState === "object") return keplerGlState;
  return {
    [KEPLER_ID]: { visState: {}, mapState: {}, uiState: {} },
  };
};

const GlobalStyle = styled.div`
  font-family: ff-clan-web-pro, "Helvetica Neue", Helvetica, sans-serif;
  font-weight: 400;
  font-size: 0.875em;
  line-height: 1.71429;

  *,
  *:before,
  *:after {
    box-sizing: border-box;
  }

  ul {
    margin: 0;
    padding: 0;
  }

  li {
    margin: 0;
  }

  a {
    text-decoration: none;
    color: ${(props) => props.theme.labelColor};
  }
`;

const CONTAINER_STYLE = {
  transition: "margin 1s, height 1s",
  position: "absolute",
  width: "100%",
  height: "100%",
  left: 0,
  top: 0,
  display: "flex",
  flexDirection: "column",
  backgroundColor: "#333",
};

const StyledResizeHandle = styled(PanelResizeHandle)`
  background-color: ${panelBorderColor};
  &:hover {
    background-color: #555;
  }
  width: 100%;
  height: 5px;
  cursor: row-resize;
`;

const StyledVerticalResizeHandle = styled(PanelResizeHandle)`
  background-color: ${panelBorderColor};
  width: 4px;
  height: 100%;
  cursor: row-resize;

  &:hover {
    background-color: #555;
  }
`;

const App = (props) => {
  const [showBanner, toggleShowBanner] = useState(false);

  const { id, provider } = useParams();
  const [searchParams] = useSearchParams();
  const query = Object.fromEntries(searchParams.entries());
  const dispatch = useDispatch();

  const duckDbPluginEnabled = (getApplicationConfig().plugins || []).some(
    (p) => p.name === "duckdb"
  );

  const isSqlPanelOpen = useSelector(
    (state) =>
      duckDbPluginEnabled &&
      state?.demo?.keplerGl?.[KEPLER_ID]?.uiState?.mapControls?.sqlPanel?.active
  );

  const isAiAssistantPanelOpen = useSelector(
    (state) =>
      state?.demo?.keplerGl?.[KEPLER_ID]?.uiState?.mapControls?.aiAssistant?.active
  );

  const activeSidePanel = useSelector(
    (state) => state?.demo?.keplerGl?.[KEPLER_ID]?.uiState?.activeSidePanel
  );

  // 🚀 O NOSSO SENSOR (ESCUTA O DATASET FANTASMA)
  // Esse hook verifica se o botão do Catálogo foi clicado e o dataset foi injetado.
  const showMvtLayer = useSelector(
    (state: any) => !!state?.demo?.keplerGl?.[KEPLER_ID]?.visState?.datasets?.['empresas_mvt_data']
  );

  // 🚀 A CONSTRUÇÃO DA CAMADA DECK.GL
  const customDeckLayers = useMemo(() => {
    // Se o usuário não ativou a base MVT, não renderizamos a camada
    if (!showMvtLayer && !(window as any).__MAONO_SHOW_MVT__) return [];

    return [
      new MVTLayer({
        id: 'maono-r2-mvt-layer',
        // O link direto para as fatias pré-renderizadas do Cloudflare
        data: 'https://pub-1fec65e3cdea470b8229d27adfcca2d7.r2.dev/previa_corpal_empresas_otimizada_v4/{z}/{x}/{y}.pbf',
        getFillColor: [197, 160, 89, 140], // Dourado Maõno
        getLineColor: [197, 160, 89, 255], 
        lineWidthMinPixels: 1,
        pickable: true,
        autoHighlight: true,
        highlightColor: [226, 194, 117, 200]
      })
    ];
  }, [showMvtLayer]);

  useEffect(() => {
    if (!activeSidePanel) return;

    const ALLOWED = new Set([
      "layer",
      "layers",
      "filter",
      "filters",
      "dataset",
      "datasets",
      "interaction",
      "interactions",
    ]);

    if (ALLOWED.has(activeSidePanel)) return;

    const wrapToFn = KeplerActions.wrapTo;
    const setActive =
      KeplerActions.setActiveSidePanel ||
      KeplerActions.setSidePanel ||
      KeplerActions.toggleSidePanel;

    if (typeof wrapToFn === "function" && typeof setActive === "function") {
      try {
        dispatch(wrapToFn(KEPLER_ID, setActive("layer")));
      } catch {
        dispatch(wrapToFn(KEPLER_ID, setActive("layers")));
      }
    }
  }, [activeSidePanel, dispatch]);

  const prevQueryRef = useRef(null);

  useEffect(() => {
    const cloudProvider = CLOUD_PROVIDERS.find((c) => c.name === provider);
    if (cloudProvider) {
      if (isEqual(prevQueryRef.current, { provider, id, query })) return;

      dispatch(
        loadCloudMap({
          loadParams: query,
          provider: cloudProvider,
          onSuccess: onLoadCloudMapSuccess,
        })
      );
      prevQueryRef.current = { provider, id, query };
      return;
    }

    if (id) dispatch(loadSampleConfigurations(id));
    if (query.mapUrl) dispatch(loadRemoteMap({ dataUrl: query.mapUrl }));

    if (duckDbPluginEnabled && query.sql) {
      dispatch(toggleMapControl("sqlPanel", 0));
      dispatch(toggleModal(null));
    }

    _loadSampleData();
    dispatch(toggleModal(null));
  }, []);

  const onViewStateChange = useCallback(
    (viewState) => {
      if ((window as any).__maonoIsFlying) {
        console.log("🤫 [MUTE TACTIC] Redux ignorando ViewState para evitar o AutoSizer Crash.");
        return;
      }
      
      const viewport = new WebMercatorViewport(viewState);
      const nw = viewport.unproject([0, 0]);
      const se = viewport.unproject([viewport.width, viewport.height]);
      dispatch(setMapBoundary(nw, se));
    },
    [dispatch]
  );

  const _setStartScreenCapture = useCallback(
    (flag) => dispatch(setStartScreenCapture(flag)),
    [dispatch]
  );

  const _setScreenCaptured = useCallback(
    (screenshot) => dispatch(setScreenCaptured(screenshot)),
    [dispatch]
  );

  const hideBanner = useCallback(() => {
    toggleShowBanner(false);
  }, []);

  const _disableBanner = useCallback(() => {
    hideBanner();
    Window.localStorage.setItem(BannerKey, "true");
  }, [hideBanner]);

  const _loadRowData = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [
          {
            info: { label: "Sample Visit Data", id: "sample_visit_data" },
            data: processRowObject(sampleRowData),
          },
        ],
        config: rowDataConfig,
      })
    );
  }, [dispatch]);

  const _loadVectorTileData = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [
          {
            info: {
              label: "Railroads",
              id: "railroads.pmtiles",
              color: [255, 0, 0],
              type: "vector-tile",
            },
            data: {
              rows: [],
              fields: [
                {
                  name: "continent",
                  type: "string",
                  format: "",
                  analyzerType: "STRING",
                },
              ],
            },
            metadata: {
              name: "output.pmtiles",
              description: "output.pmtiles",
              type: "remote",
              remoteTileFormat: "pmtiles",
              tilesetDataUrl:
                "https://4sq-studio-public.s3.us-west-2.amazonaws.com/pmtiles-test/161727fe-7952-4e57-aa05-850b3086b0b2.pmtiles",
              tilesetMetadataUrl:
                "https://4sq-studio-public.s3.us-west-2.amazonaws.com/pmtiles-test/161727fe-7952-4e57-aa05-850b3086b0b2.pmtiles",
            },
          },
        ],
        options: { autoCreateLayers: true },
      })
    );
  }, [dispatch]);

  const _loadPointData = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [
          {
            info: { label: "Sample Taxi Trips 1", id: "test_trip_data", color: [255, 0, 0] },
            data: { rows: sampleTripData.rows.slice(0, 20), fields: cloneDeep(sampleTripData.fields) },
          },
          {
            info: { label: "Sample Taxi Trips 2", id: "test_trip_data_2", color: [0, 255, 0] },
            data: { rows: sampleTripData.rows.slice(5), fields: cloneDeep(sampleTripData.fields) },
          },
        ],
        options: { keepExistingConfig: true },
        config: sampleTripDataConfig,
      })
    );
  }, [dispatch]);

  const _loadScenegraphLayer = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: {
          info: { label: "Sample Scenegraph Ducks", id: "test_trip_data" },
          data: processCsvData(testCsvData),
        },
        config: {
          version: "v1",
          config: {
            visState: {
              layers: [
                {
                  type: "3D",
                  config: {
                    dataId: "test_trip_data",
                    columns: { lat: "gps_data.lat", lng: "gps_data.lng" },
                    isVisible: true,
                  },
                },
              ],
            },
          },
        },
      })
    );
  }, [dispatch]);

  const _loadIconData = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [
          { info: { label: "Icon Data", id: "test_icon_data" }, data: processCsvData(sampleIconCsv) },
        ],
      })
    );
  }, [dispatch]);

  const _loadTripGeoJson = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [
          { info: { label: "Trip animation", id: animateTripDataId }, data: processGeojson(sampleAnimateTrip) },
        ],
      })
    );
  }, [dispatch]);

  const _loadGeojsonData = useCallback(() => {
    const geojsonPoints = processGeojson(sampleGeojsonPoints);
    dispatch(
      addDataToMap({
        datasets: [
          geojsonPoints
            ? { info: { label: "Bart Stops Geo", id: "bart-stops-geo" }, data: geojsonPoints }
            : null,
        ].filter(Boolean),
        options: { keepExistingConfig: true },
        config: sampleGeojsonConfig,
      })
    );
  }, [dispatch]);

  const _loadSyncedFilterWTripLayer = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [
          { info: { label: "Trip animation", id: animateTripDataId }, data: processGeojson(sampleAnimateTrip) },
          { info: { label: "Sample Taxi Trips", id: pointDataId, color: [255, 0, 0] }, data: pointData },
        ],
        config: syncedTripConfig,
        options: { centerMap: true },
      })
    );
  }, [dispatch]);

  const _replaceSyncedFilterWTripLayer = useCallback(() => {
    window.setTimeout(() => {
      dispatch(
        replaceDataInMap({
          datasetToReplaceId: pointDataId,
          datasetToUse: { info: { label: "Sample Taxi Trips Replaced", id: `${pointDataId}-2` }, data: replacePointData },
        })
      );
    }, 1000);
  }, [dispatch]);

  const _loadH3HexagonData = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [{ info: { label: "H3 Hexagons V2", id: "h3-hex-id" }, data: processCsvData(sampleH3Data) }],
        config: h3MapConfig,
        options: { keepExistingConfig: true },
      })
    );
  }, [dispatch]);

  const _loadS2Data = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [{ info: { label: "S2 Data", id: s2DataId }, data: processCsvData(sampleS2Data) }],
        config: s2MapConfig,
        options: { keepExistingConfig: true },
      })
    );
  }, [dispatch]);

  const _loadGpsData = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [{ info: { label: "Gps Data", id: "gps-data" }, data: processCsvData(sampleGpsData) }],
        options: { keepExistingConfig: true },
      })
    );
  }, [dispatch]);

  const _loadSampleData = useCallback(() => {
  }, [
    _loadPointData,
    _loadGeojsonData,
    _loadTripGeoJson,
    _loadIconData,
    _loadH3HexagonData,
    _loadS2Data,
    _loadScenegraphLayer,
    _loadGpsData,
    _loadRowData,
    _loadVectorTileData,
    _loadSyncedFilterWTripLayer,
    _replaceSyncedFilterWTripLayer,
  ]);

  return (
    <StyleSheetManager shouldForwardProp={shouldForwardProp}>
      {/* Injetamos o nosso Tema Dourado na raiz da árvore */}
      <ThemeProvider theme={maonoTheme}>
        <GlobalStyle>
          <ScreenshotWrapper
            startScreenCapture={props.demo.aiAssistant.screenshotToAsk.startScreenCapture}
            setScreenCaptured={_setScreenCaptured}
            setStartScreenCapture={_setStartScreenCapture}
            className="h-screen"
          >
            <Banner show={showBanner} height={BannerHeight} bgColor="#2E7CF6" onClose={hideBanner}>
              <Announcement onDisable={_disableBanner} />
            </Banner>

            <div style={CONTAINER_STYLE}>
              <PanelGroup direction="horizontal">
                <Panel defaultSize={isAiAssistantPanelOpen ? 70 : 100}>
                  <PanelGroup direction="vertical">
                    <Panel defaultSize={isSqlPanelOpen ? 60 : 100}>
                      <AutoSizer>
                        {({ height, width }) => (
                          <KeplerGl
                            mapboxApiAccessToken={CLOUD_PROVIDERS_CONFIGURATION.MAPBOX_TOKEN}
                            id={KEPLER_ID}
                            getState={keplerGlGetState}
                            width={width}
                            height={height}
                            cloudProviders={CLOUD_PROVIDERS}
                            localeMessages={messages}
                            onExportToCloudSuccess={onExportFileSuccess}
                            onLoadCloudMapSuccess={onLoadCloudMapSuccess}
                            featureFlags={DEFAULT_FEATURE_FLAGS}
                            onViewStateChange={onViewStateChange}
                            
                            
                            deckGlProps={{ layers: customDeckLayers }}

                            getMapboxRef={(mapbox: any, index: number) => {
                              if (index === 0 && mapbox) {
                                (window as any).__maonoMapRef = mapbox.getMap();
                              }
                            }}
                          />
                        )}
                      </AutoSizer>
                    </Panel>

                    {isSqlPanelOpen && (
                      <>
                        <StyledResizeHandle />
                        <Panel defaultSize={40} minSize={20}>
                          <SqlPanel initialSql={query.sql || ""} />
                        </Panel>
                      </>
                    )}
                  </PanelGroup>
                </Panel>

                {isAiAssistantPanelOpen && (
                  <>
                    <StyledVerticalResizeHandle />
                    <Panel defaultSize={30} minSize={20}>
                      <AiAssistantPanel />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            </div>
          </ScreenshotWrapper>
        </GlobalStyle>
      </ThemeProvider>
    </StyleSheetManager>
  );
};

const mapStateToProps = (state) => state;
const dispatchToProps = (dispatch) => ({ dispatch });

export default connect(mapStateToProps, dispatchToProps)(App);