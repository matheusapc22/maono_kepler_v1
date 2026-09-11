import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSelector, useDispatch } from 'react-redux';
import {
  selectDatasets,
  selectLayers,
  selectFilters,
  selectVisState,
  selectUiState,
  selectMapState,
  KEPLER_ID
} from '../pages/Kepler/keplerBridge';

import {
  toggleMapControl,
  interactionConfigChange,
  addDataToMap,
  removeDataset,
  updateMap,
  wrapTo
} from '@kepler.gl/actions';

import { processGeojson } from '@kepler.gl/processors';
import { WebMercatorViewport } from '@deck.gl/core';

// --- SVGs Flutuantes e de Interface ---
const LegendMapIcon = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>);
const PinMarkerIcon = () => (<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" stroke="#0a0f18" strokeWidth="1"><path d="M12 24c0 0 9-7.4 9-14.5C21 4.25 16.97 0 12 0 7.03 0 3 4.25 3 9.5 3 16.6 12 24 12 24z"/><circle cx="12" cy="9" r="3" fill="#0a0f18" stroke="none"/></svg>);
const TrashIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>);
const IsochroneWavesIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>);
const CloseIcon = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" height="1.5em" width="1.5em"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>);
const TooltipsTabIcon = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>);
const ChevronRightIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>);
const ChevronLeftIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>);
const CenterMapIcon = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v4M12 18v4M4 12H2M22 12h-4"></path></svg>);

const getPlainFields = (rawFields: any) => {
  if (!rawFields) return [];
  const arr = typeof rawFields.toArray === 'function' ? rawFields.toArray() : Array.isArray(rawFields) ? rawFields : [];
  return arr.map((f: any) => {
    if (typeof f.toJS === 'function') return f.toJS();
    if (f.get) return { name: f.get('name'), format: f.get('format') };
    return { name: f.name, format: f.format };
  }).filter((f: any) => f && f.name);
};

const DATASET_ACCENT_COLORS = ['#C5A059', '#E2D7C1', '#9CA3AF', '#CD9575', '#64748B'];

// 🚀 MÁGICA 1: Adicionado o prop isHidden
export function MapOverlayControls({ isHidden = false }: { isHidden?: boolean }) {
  const dispatch = useDispatch();

  const datasetsRaw = useSelector((state: any) => selectDatasets(state, KEPLER_ID));
  const visState = useSelector((state: any) => selectVisState(state, KEPLER_ID) || {});
  const uiState = useSelector((state: any) => selectUiState(state, KEPLER_ID) || {});
  const mapState = useSelector((state: any) => selectMapState(state, KEPLER_ID)); 
  const layersRaw = useSelector((state: any) => selectLayers(state, KEPLER_ID));
  const filtersRaw = useSelector((state: any) => selectFilters(state, KEPLER_ID));
  
  const interactionConfig = visState.interactionConfig || {};
  const isMapLegendActive = uiState.mapControls?.mapLegend?.active || false;

  const [showTooltipsPanel, setShowTooltipsPanel] = useState(false);
  const [activeTooltipDatasetId, setActiveTooltipDatasetId] = useState<string | null>(null);
  const [tooltipDraftFields, setTooltipDraftFields] = useState<any[]>([]);
  const originalFieldsBackup = useRef<any[]>([]);

  const [markerState, setMarkerState] = useState<'idle' | 'placing' | 'placed'>('idle');
  const [markerOrigin, setMarkerOrigin] = useState<{lat: number, lng: number} | null>(null);
  const [showMarkerMenu, setShowMarkerMenu] = useState(false);
  const [isDraggingPin, setIsDraggingPin] = useState(false);
  const pinDragInfo = useRef({ startX: 0, startY: 0 });
  const clickStart = useRef({x: 0, y: 0});
  
  const [showIsoModal, setShowIsoModal] = useState(false);
  const [isoType, setIsoType] = useState<'time' | 'distance'>('time');
  const [isoMode, setIsoMode] = useState<string>('drive_traffic');
  const [isoRanges, setIsoRanges] = useState<string[]>(['10', '20', '30']);
  const [isLoadingIsochrone, setIsLoadingIsochrone] = useState(false);
  const [previewDataId, setPreviewDataId] = useState<string | null>(null);

  const getMapRect = useCallback(() => {
    const mapEl = document.querySelector('.mapboxgl-canvas');
    if (mapEl) return mapEl.getBoundingClientRect();
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }, []);

  const unprojectFromScreen = useCallback((clientX: number, clientY: number) => {
    if (!mapState?.width || !mapState?.height) return null;
    const rect = getMapRect();
    
    const scaleX = mapState.width / (rect.width || mapState.width);
    const scaleY = mapState.height / (rect.height || mapState.height);
    const mapX = (clientX - rect.left) * scaleX;
    const mapY = (clientY - rect.top) * scaleY;

    const viewport = new WebMercatorViewport(mapState);
    const unprojected = viewport.unproject([mapX, mapY]);
    if (!unprojected) return null;

    let [lng, lat] = unprojected;
    while (lng > 180) lng -= 360;
    while (lng < -180) lng += 360;

    return { lng, lat };
  }, [mapState, getMapRect]);

  const projectToScreen = useCallback((lng: number, lat: number) => {
    if (!mapState?.width || !mapState?.height) return null;
    const rect = getMapRect();
    const viewport = new WebMercatorViewport(mapState);
    const projected = viewport.project([lng, lat]);
    if (!projected) return null;

    const scaleX = mapState.width / (rect.width || mapState.width);
    const scaleY = mapState.height / (rect.height || mapState.height);

    return {
        x: (projected[0] / scaleX) + rect.left,
        y: (projected[1] / scaleY) + rect.top
    };
  }, [mapState, getMapRect]);


  const resetMarkerAndFlow = () => {
    setMarkerState('idle');
    setMarkerOrigin(null);
    setShowMarkerMenu(false);
    setShowIsoModal(false);
  };

  const availableDatasets = useMemo(() => {
    const list: any[] = [];
    if (!datasetsRaw) return list;
    const entries = typeof datasetsRaw.entrySeq === 'function' ? datasetsRaw.entrySeq().toArray() : Object.entries(datasetsRaw);
    for (const [dataId, ds] of entries as any) {
      const fields = ds?.fields || ds?.get?.('fields') || [];
      const fieldsArray = Array.isArray(fields) ? fields : fields.toArray ? fields.toArray() : [];
      let datasetLabel = dataId; 
      if (ds) datasetLabel = ds.label || (ds.get && ds.get('label')) || (ds.info && ds.info.label) || (ds.getIn && ds.getIn(['info', 'label'])) || dataId;
      list.push({ id: dataId, label: datasetLabel, fields: fieldsArray, rawDataset: ds });
    }
    return list;
  }, [datasetsRaw]);

  const getDatasetAccentColor = (dataId: string) => {
    const index = availableDatasets.findIndex(d => d.id === dataId);
    const safeIndex = Math.max(0, index); 
    return DATASET_ACCENT_COLORS[safeIndex % DATASET_ACCENT_COLORS.length];
  };

  const [globalTargetBounds, setGlobalTargetBounds] = useState<number[] | null>(null);
  const [globalCentroid, setGlobalCentroid] = useState<{lat: number, lng: number} | null>(null);
  const [isGlowActive, setIsGlowActive] = useState(false);
  const [isFlying, setIsFlying] = useState(false);

  let layers: any[] = [];
  try { if (Array.isArray(layersRaw)) layers = layersRaw; else if (layersRaw?.toArray) layers = layersRaw.toArray(); } catch (e) {}
  let filters: any[] = [];
  try { if (Array.isArray(filtersRaw)) filters = filtersRaw; else if (filtersRaw?.toArray) filters = filtersRaw.toArray(); } catch (e) {}

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      const hasActiveFilter = filters?.some((f: any) => {
        const val = f.value || (f.get && f.get('value'));
        return Array.isArray(val) ? val.length > 0 : val !== null && val !== undefined && val !== '';
      });

      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      let hasValidCoords = false;

      const extractGeoJsonCoords = (coords: any) => {
        if (!coords) return;
        if (Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
          if (coords[1] < minLat) minLat = coords[1];
          if (coords[1] > maxLat) maxLat = coords[1];
          if (coords[0] < minLng) minLng = coords[0];
          if (coords[0] > maxLng) maxLng = coords[0];
          hasValidCoords = true;
        } else if (Array.isArray(coords)) {
          for (let j = 0; j < coords.length; j++) extractGeoJsonCoords(coords[j]);
        }
      };

      layers.forEach((layer: any) => {
        const config = layer.config || (layer.get && layer.get('config'));
        const layerType = layer.type || (layer.get && layer.get('type'));
        if (!config?.isVisible) return;
        const isPoint = layerType === 'point' || layerType === 'cluster' || layerType === 'heatmap';
        const isGeojson = layerType === 'geojson';
        if (!isPoint && !isGeojson) return;
        const dataId = config.dataId;
        const ds = availableDatasets.find(d => d.id === dataId);
        if (!ds) return;

        let latIdx = -1, lngIdx = -1, geoIdx = -1;
        if (isPoint) {
          const columns = config.columns || {};
          const latField = columns.lat?.value || columns.lat;
          const lngField = columns.lng?.value || columns.lng;
          if (latField && lngField) {
            latIdx = ds.fields.findIndex((f: any) => (f.name || f.get?.('name')) === latField);
            lngIdx = ds.fields.findIndex((f: any) => (f.name || f.get?.('name')) === lngField);
          }
        } else if (isGeojson) {
          const columns = config.columns || {};
          const geoField = columns.geojson?.value || columns.geojson;
          if (geoField) geoIdx = ds.fields.findIndex((f: any) => (f.name || f.get?.('name')) === geoField);
        }

        if (latIdx < 0 && lngIdx < 0 && geoIdx < 0) return;

        const filteredIdx = hasActiveFilter ? (ds.rawDataset?.filteredIndex || []) : (ds.rawDataset?.allIndexes || []);
        const dataContainer = ds.rawDataset?.dataContainer;
        const allData = ds.rawDataset?.allData;

        for (let i = 0; i < filteredIdx.length; i++) {
          const rowIndex = filteredIdx[i];
          if (isPoint && latIdx >= 0 && lngIdx >= 0) {
            const lat = dataContainer ? dataContainer.valueAt(rowIndex, latIdx) : allData[rowIndex][latIdx];
            const lng = dataContainer ? dataContainer.valueAt(rowIndex, lngIdx) : allData[rowIndex][lngIdx];
            if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
              if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
              if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
              hasValidCoords = true;
            }
          } else if (isGeojson && geoIdx >= 0) {
            const geoData = dataContainer ? dataContainer.valueAt(rowIndex, geoIdx) : allData[rowIndex][geoIdx];
            if (geoData) {
              let geomObj = geoData;
              if (typeof geoData === 'string') try { geomObj = JSON.parse(geoData); } catch (e) { continue; }
              if (geomObj?.geometry?.coordinates) extractGeoJsonCoords(geomObj.geometry.coordinates);
              else if (geomObj?.coordinates) extractGeoJsonCoords(geomObj.coordinates);
              else if (Array.isArray(geomObj)) extractGeoJsonCoords(geomObj);
            }
          }
        }
      });

      if (hasValidCoords) {
        if (minLat === maxLat) { minLat -= 0.02; maxLat += 0.02; }
        if (minLng === maxLng) { minLng -= 0.02; maxLng += 0.02; }
        setGlobalTargetBounds([minLng, minLat, maxLng, maxLat]);
        setGlobalCentroid({ lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 });
      } else {
        setGlobalTargetBounds(null);
        setGlobalCentroid(null);
        setIsGlowActive(false);
      }
    }, 600);
    return () => clearTimeout(debounceTimer);
  }, [filters, layers, availableDatasets]);

  useEffect(() => {
    if (!globalCentroid || !globalTargetBounds || !mapState || !mapState.width || !mapState.height || isFlying) return;
    try {
      const viewport = new WebMercatorViewport({ width: mapState.width, height: mapState.height, longitude: mapState.longitude, latitude: mapState.latitude, zoom: mapState.zoom, pitch: mapState.pitch, bearing: mapState.bearing });
      const [x, y] = viewport.project([globalCentroid.lng, globalCentroid.lat]);
      const marginX = mapState.width * 0.15; const marginY = mapState.height * 0.15;
      const isOutside = x < marginX || x > (mapState.width - marginX) || y < marginY || y > (mapState.height - marginY);

      const [minLng, minLat, maxLng, maxLat] = globalTargetBounds;
      const idealViewport = viewport.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 100 });
      const zoomDiff = Math.abs(mapState.zoom - idealViewport.zoom);
      setIsGlowActive(isOutside || zoomDiff > 0.8);
    } catch (error) {}
  }, [mapState?.latitude, mapState?.longitude, mapState?.zoom, globalCentroid, globalTargetBounds, isFlying]);

  const handleGlobalCenterMap = () => {
    if (isFlying || !mapState?.width || !mapState?.height || !globalTargetBounds) return;
    setIsFlying(true); 
    const viewport = new WebMercatorViewport({ width: mapState.width, height: mapState.height });
    const [minLng, minLat, maxLng, maxLat] = globalTargetBounds;
    const fitted = viewport.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 120 });
    
    const startLng = mapState.longitude, startLat = mapState.latitude, startZoom = mapState.zoom;
    const endLng = fitted.longitude, endLat = fitted.latitude, endZoom = Math.max(0, fitted.zoom - 0.5);
    const duration = 2000, startTime = performance.now();

    const animateCamera = (currentTime: number) => {
      let progress = (currentTime - startTime) / duration;
      if (progress > 1) progress = 1;
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      dispatch(wrapTo(KEPLER_ID, updateMap({
        longitude: startLng + (endLng - startLng) * ease,
        latitude: startLat + (endLat - startLat) * ease,
        zoom: startZoom + (endZoom - startZoom) * ease
      })));
      if (progress < 1) requestAnimationFrame(animateCamera);
      else { setIsGlowActive(false); setIsFlying(false); }
    };
    requestAnimationFrame(animateCamera);
  };

  const tooltipConf = interactionConfig?.tooltip?.config || (interactionConfig?.tooltip?.get && interactionConfig.tooltip.get('config'));
  const fieldsToShow = tooltipConf?.fieldsToShow || (tooltipConf?.get && tooltipConf.get('fieldsToShow')) || {};

  const handleOpenDatasetTooltips = (datasetId: string) => {
    const datasetFields = fieldsToShow[datasetId] || (fieldsToShow.get && fieldsToShow.get(datasetId));
    const activeFields = getPlainFields(datasetFields);
    
    originalFieldsBackup.current = [...activeFields]; 
    
    setTooltipDraftFields(activeFields);
    setActiveTooltipDatasetId(datasetId);
  };

  const handleToggleDraftField = (fieldName: string) => {
    if (!activeTooltipDatasetId) return;
    
    const isShown = tooltipDraftFields.some((f) => f.name === fieldName);
    let newFields;
    
    if (isShown) {
      newFields = tooltipDraftFields.filter((f) => f.name !== fieldName);
    } else {
      newFields = [...tooltipDraftFields, { name: fieldName, format: null }];
    }
    
    setTooltipDraftFields(newFields); 

    dispatch(wrapTo(KEPLER_ID, interactionConfigChange({ 
      id: 'tooltip', 
      enabled: true, 
      config: { 
        ...tooltipConf, 
        fieldsToShow: { 
          ...fieldsToShow, 
          [activeTooltipDatasetId]: newFields 
        } 
      } 
    } as any)));
  };

  const handleSaveTooltips = () => {
    setActiveTooltipDatasetId(null);
    setTooltipDraftFields([]);
  };

  const handleDiscardTooltips = () => {
    if (activeTooltipDatasetId) {
      dispatch(wrapTo(KEPLER_ID, interactionConfigChange({ 
        id: 'tooltip', 
        enabled: true, 
        config: { 
          ...tooltipConf, 
          fieldsToShow: { 
            ...fieldsToShow, 
            [activeTooltipDatasetId]: originalFieldsBackup.current 
          } 
        } 
      } as any)));
    }
    setActiveTooltipDatasetId(null);
    setTooltipDraftFields([]);
  };

  useEffect(() => {
    if (isoType === 'time') setIsoRanges(['10', '20', '30']);
    else setIsoRanges(['1', '2', '3']);
  }, [isoType]);

  const handleCalculateIsochrone = async () => {
    if (!markerOrigin) return;
    setIsLoadingIsochrone(true);
    
    if (previewDataId) { 
      dispatch(wrapTo(KEPLER_ID, removeDataset(previewDataId))); 
      setPreviewDataId(null); 
    }
    
    const { lat, lng } = markerOrigin;
    const validRanges = isoRanges.filter(v => v.trim() !== '').map(Number).filter(n => !isNaN(n) && n > 0);
    
    if (validRanges.length === 0) {
        alert("Insira pelo menos um intervalo válido.");
        setIsLoadingIsochrone(false);
        return;
    }

    try {
      const promises = validRanges.map(val => {
        let rangeVal = isoType === 'time' ? val * 60 : val * 1000;
        if (isoMode === 'drive_traffic') rangeVal = rangeVal * 0.75;
        const apiMode = isoMode === 'drive_traffic' ? 'drive' : isoMode;
        return fetch(`https://api.geoapify.com/v1/isoline?lat=${lat}&lon=${lng}&type=${isoType}&mode=${apiMode}&range=${rangeVal}&apiKey=88ca5fc7edfa494fbdce9875931e26f5`).then(res => res.json()).then(data => ({ data, originalVal: val }));
      });

      const results = await Promise.all(promises);
      const polygons = results.flatMap((res) => {
         if (!res.data.features) return [];
         return res.data.features.filter((f: any) => f.geometry.type.includes('Polygon')).map((f: any) => ({ ...f, properties: { ...f.properties, range_time: `${res.originalVal} ${isoType === 'time' ? 'Min' : 'Km'}` } }));
      });

      if (polygons.length === 0) { setIsLoadingIsochrone(false); return; }

      const originPoint = { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { range_time: "Origem" } };
      const geoJsonData = { type: "FeatureCollection", features: [...polygons, originPoint] };
      const dataId = `isochrone_${Date.now()}`;
      const modoTextLabel = isoMode === 'drive_traffic' ? 'Com Trânsito' : isoMode === 'walk' ? 'A pé' : isoMode === 'bicycle' ? 'Bike' : 'Carro';

      const isochroneConfig = { version: 'v1', config: { visState: { layers: [ { id: `layer_${dataId}`, type: 'geojson', config: { dataId: dataId, label: `Análise: ${modoTextLabel}`, color: [221, 178, 124], columns: { geojson: '_geojson' }, isVisible: true, visConfig: { opacity: 0.25, filled: true, stroked: true, strokeColor: [193, 123, 62], strokeOpacity: 1, thickness: 1, radius: 20 } } } ] } } };

      dispatch(wrapTo(KEPLER_ID, addDataToMap({ datasets: { info: { label: `Análise: ${modoTextLabel}`, id: dataId }, data: processGeojson(geoJsonData) }, options: { centerMap: true, keepExistingConfig: true }, config: isochroneConfig })));
      
      setPreviewDataId(dataId);
      setShowIsoModal(false);
      setShowMarkerMenu(false);
    } catch (error) {} finally { setIsLoadingIsochrone(false); }
  };

  // 🚀 MÁGICA 2: Se isHidden for true (Painel CEO aberto), interrompemos o render do Portal!
  if (isHidden) return null;

  return createPortal(
    <>
      <div 
        className="fixed bottom-3 right-6 z-[999999] pointer-events-none flex items-center gap-1.5 opacity-80"
        style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#A0A7B4', fontSize: '11px', fontWeight: 400, letterSpacing: '0.3px', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
      >
        <span>© maõno</span>
        <span style={{ opacity: 0.5, fontSize: '10px', paddingBottom: '1px' }}>|</span>
        <span>Basemap by: XXX</span>
      </div>

      {markerState === 'placing' && (
        <div 
          className="fixed inset-0 z-[999997]"
          style={{
             cursor: `url('data:image/svg+xml;utf8,<svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 24c0 0 9-7.4 9-14.5C21 4.25 16.97 0 12 0 7.03 0 3 4.25 3 9.5 3 16.6 12 24 12 24z" fill="%23C5A059" stroke="%230a0f18" stroke-width="1.5"/><circle cx="12" cy="9" r="3" fill="%230a0f18" stroke="none"/></svg>') 16 32, crosshair`
          }}
          onMouseDown={(e) => { clickStart.current = { x: e.clientX, y: e.clientY }; }}
          onMouseUp={(e) => {
             if (Math.abs(e.clientX - clickStart.current.x) > 4 || Math.abs(e.clientY - clickStart.current.y) > 4) return;
             
             const unprojected = unprojectFromScreen(e.clientX, e.clientY);
             if (unprojected) {
                 setMarkerOrigin({ lat: unprojected.lat, lng: unprojected.lng });
                 setMarkerState('placed');
                 setShowMarkerMenu(true);
             }
          }}
        />
      )}

      <div className="fixed bottom-16 right-6 z-[999999] flex flex-col items-end gap-4 pointer-events-none maono-controls">
        
        {/* Painel de Tooltips */}
        {showTooltipsPanel && (
          <div className="absolute bottom-full mb-4 right-0 w-[300px] h-[450px] bg-[#161f30] border border-[#2a3a54] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.9)] flex flex-col pointer-events-auto overflow-hidden">
             <div className="p-4 border-b border-[#2a3a54] bg-[#0f1522] flex justify-between items-center shrink-0">
                {activeTooltipDatasetId ? (
                   <div className="flex items-center gap-2 text-white cursor-pointer hover:text-[#C5A059] transition-colors group" onClick={handleDiscardTooltips}>
                     <div className="group-hover:-translate-x-1 transition-transform"><ChevronLeftIcon /></div>
                     <span className="text-[11px] font-bold tracking-widest uppercase truncate max-w-[180px]">{availableDatasets.find(d => d.id === activeTooltipDatasetId)?.label || 'Voltar'}</span>
                   </div>
                ) : (
                   <div className="flex items-center gap-2 text-white"><TooltipsTabIcon /><span className="text-[11px] font-bold tracking-widest uppercase">Tooltips</span></div>
                )}
                <button onClick={() => { setShowTooltipsPanel(false); handleDiscardTooltips(); }} className="text-gray-500 hover:text-[#C5A059] transition-colors"><CloseIcon /></button>
             </div>

             <div className="flex-1 overflow-y-auto maono-scroll p-3 flex flex-col gap-2 relative">
                {!activeTooltipDatasetId && availableDatasets.map((dataset) => {
                  const accentColor = getDatasetAccentColor(dataset.id);
                  return (
                    <div key={dataset.id} onClick={() => handleOpenDatasetTooltips(dataset.id)} className="flex items-center justify-between p-4 bg-[#1a2435] rounded-xl border border-[#2a3a54] hover:border-[#C5A059]/50 cursor-pointer transition-all group">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px_rgba(0,0,0,0.5)]" style={{ backgroundColor: accentColor }} />
                        <span className="text-xs font-bold tracking-widest truncate group-hover:text-white transition-colors" style={{ color: accentColor }}>{dataset.label}</span>
                      </div>
                      <div className="text-[#64748b] group-hover:text-[#C5A059] transition-colors shrink-0 group-hover:translate-x-1"><ChevronRightIcon /></div>
                    </div>
                  );
                })}
                {activeTooltipDatasetId && (() => {
                  const dataset = availableDatasets.find(d => d.id === activeTooltipDatasetId);
                  if (!dataset) return null;
                  return dataset.fields.map((f: any) => {
                    const fieldName = f.name || (f.get && f.get('name'));
                    const isShown = tooltipDraftFields.some((af: any) => af.name === fieldName);
                    return (
                      <div key={fieldName} className="flex items-center justify-between py-3 px-3 border-b border-[#2a3a54]/50 last:border-0 group hover:bg-[#1a2435] rounded-lg transition-colors cursor-pointer" onClick={() => handleToggleDraftField(fieldName)}>
                        <span className="text-xs text-[#8c9fba] truncate pr-2 group-hover:text-white transition-colors">{fieldName}</span>
                        <button 
                          className="relative inline-flex h-5 w-10 items-center rounded-full transition-all duration-300 shrink-0 outline-none"
                          style={{
                            backgroundColor: isShown ? '#11A872' : 'transparent',
                            border: isShown ? '2px solid #11A872' : '2px solid #64748b',
                            boxShadow: isShown ? '0 0 10px rgba(17,168,114,0.4)' : 'none'
                          }}
                        >
                          <span 
                            className="inline-block h-3.5 w-3.5 rounded-full transition-transform duration-300 ease-in-out" 
                            style={{ backgroundColor: isShown ? '#ffffff' : 'transparent', border: isShown ? 'none' : '2px solid #64748b', transform: isShown ? 'translateX(20px)' : 'translateX(2px)' }} 
                          />
                        </button>
                      </div>
                    );
                  });
                })()}
             </div>

             {activeTooltipDatasetId && (
               <div className="p-4 border-t border-[#2a3a54] bg-[#0f1522] flex gap-3 shrink-0">
                  <button onClick={handleSaveTooltips} className="flex-1 py-2.5 bg-[#0E8A5E] hover:bg-[#11A872] text-white text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-lg transition-all flex justify-center items-center">Salvar</button>
                  <button onClick={handleDiscardTooltips} className="flex-1 py-2.5 bg-[#1a2435] border border-[#ef4444]/40 hover:border-[#ef4444] text-[#ef4444] hover:bg-[#ef4444]/10 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all flex justify-center items-center">Descartar</button>
               </div>
             )}
          </div>
        )}

        <div className="flex flex-col items-end gap-3 pointer-events-auto relative">
          
          <button 
            onClick={handleGlobalCenterMap} 
            disabled={!globalTargetBounds || isFlying} 
            className="w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-300 outline-none"
            style={{ backgroundColor: '#0a0f18', color: '#C5A059', border: isGlowActive ? '2px solid #C5A059' : '1px solid #1f2b3e', boxShadow: isGlowActive ? '0 0 20px rgba(197,160,89,0.8)' : '0 10px 25px rgba(0,0,0,0.5)', opacity: (!globalTargetBounds || isFlying) ? 0.4 : 1, cursor: (!globalTargetBounds || isFlying) ? 'not-allowed' : 'pointer', transform: isGlowActive ? 'scale(1.05)' : 'scale(1)' }}
            title="Centralizar Câmera nos Dados"
          >
             <CenterMapIcon />
          </button>
          
          <button 
            onClick={() => { setShowTooltipsPanel(!showTooltipsPanel); handleDiscardTooltips(); }} 
            className="w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-300 outline-none"
            style={{ backgroundColor: '#0a0f18', color: '#C5A059', border: showTooltipsPanel ? '2px solid #C5A059' : '1px solid #1f2b3e', boxShadow: showTooltipsPanel ? '0 0 20px rgba(197,160,89,0.8)' : '0 10px 25px rgba(0,0,0,0.5)', transform: showTooltipsPanel ? 'scale(1.05)' : 'scale(1)', cursor: 'pointer' }}
            title="Configurar Tooltips"
          >
             <TooltipsTabIcon />
          </button>
          
          <button 
            onClick={() => dispatch(wrapTo(KEPLER_ID, toggleMapControl('mapLegend')))} 
            className="w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-300 outline-none"
            style={{ backgroundColor: '#0a0f18', color: '#C5A059', border: isMapLegendActive ? '2px solid #C5A059' : '1px solid #1f2b3e', boxShadow: isMapLegendActive ? '0 0 20px rgba(197,160,89,0.8)' : '0 10px 25px rgba(0,0,0,0.5)', transform: isMapLegendActive ? 'scale(1.05)' : 'scale(1)', cursor: 'pointer' }}
            title="Mostrar Legenda"
          >
             <LegendMapIcon />
          </button>
          
          {!previewDataId && (
            <button 
              onClick={() => { if (markerState === 'placing') resetMarkerAndFlow(); else { setMarkerState('placing'); setShowMarkerMenu(false); } }} 
              className="w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-300 outline-none"
              style={{ backgroundColor: '#0a0f18', color: '#C5A059', border: markerState === 'placing' ? '2px solid #C5A059' : '1px solid #1f2b3e', boxShadow: markerState === 'placing' ? '0 0 20px rgba(197,160,89,0.8)' : '0 10px 25px rgba(0,0,0,0.5)', transform: markerState === 'placing' ? 'scale(1.05)' : 'scale(1)', cursor: 'pointer' }}
              title={markerState === 'placing' ? 'Cancelar inserção' : 'Inserir Marcador no Mapa'}
            >
               <PinMarkerIcon />
            </button>
          )}

          {previewDataId && (
            <div className="w-[280px] bg-[#0a0f18] border border-[#1f2b3e] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.8)] p-4 flex flex-col gap-4 animate-fade-in mt-1">
                <h3 className="text-xs font-bold text-gray-100 tracking-wide flex items-center gap-2">
                  <IsochroneWavesIcon /> Isócrona Gerada
                </h3>
                <div className="flex gap-2 w-full">
                    <button onClick={() => { setPreviewDataId(null); resetMarkerAndFlow(); }} className="flex-1 py-2.5 bg-[#0E8A5E] hover:bg-[#11A872] text-white text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-lg transition-all flex justify-center items-center gap-1">Salvar</button>
                    <button onClick={() => { dispatch(wrapTo(KEPLER_ID, removeDataset(previewDataId))); setPreviewDataId(null); resetMarkerAndFlow(); }} className="flex-1 py-2.5 bg-[#131c2a] border border-[#ef4444]/40 hover:border-[#ef4444] text-[#ef4444] hover:bg-[#ef4444]/10 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all flex justify-center items-center gap-1">Descartar</button>
                </div>
            </div>
          )}
        </div>
      </div>

      {(() => {
        let pinX = -9999, pinY = -9999, shouldShowPin = false;
        if (markerState === 'placed' && markerOrigin && !previewDataId && mapState?.width > 0 && mapState?.height > 0) {
          try {
            const pos = projectToScreen(markerOrigin.lng, markerOrigin.lat);
            if (pos) { 
               pinX = pos.x; 
               pinY = pos.y; 
               shouldShowPin = true; 
            }
          } catch(e) {}
        }

        const handlePinPointerDown = (e: React.PointerEvent) => { e.stopPropagation(); setIsDraggingPin(true); pinDragInfo.current = { startX: e.clientX, startY: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); };
        const handlePinPointerMove = (e: React.PointerEvent) => {
          if (!isDraggingPin || !mapState?.width) return;
          e.stopPropagation();
          const unprojected = unprojectFromScreen(e.clientX, e.clientY);
          if (unprojected) setMarkerOrigin({ lat: unprojected.lat, lng: unprojected.lng });
        };
        const handlePinPointerUp = (e: React.PointerEvent) => {
          e.stopPropagation();
          if (isDraggingPin) {
            setIsDraggingPin(false); (e.target as HTMLElement).releasePointerCapture(e.pointerId);
            const dx = Math.abs(e.clientX - pinDragInfo.current.startX);
            const dy = Math.abs(e.clientY - pinDragInfo.current.startY);
            if (dx < 3 && dy < 3) setShowMarkerMenu(prev => !prev);
            else setShowMarkerMenu(false);
          }
        };

        return shouldShowPin ? (
          <div className="fixed z-[99998] flex flex-col items-center pointer-events-none" style={{ left: pinX, top: pinY, transform: 'translate(-50%, -100%)', touchAction: 'none' }}>
            <div className={`pointer-events-auto transition-transform ${isDraggingPin ? 'scale-125 cursor-grabbing drop-shadow-[0_20px_20px_rgba(0,0,0,0.8)]' : 'hover:scale-110 cursor-pointer drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)]'}`} onPointerDown={handlePinPointerDown} onPointerMove={handlePinPointerMove} onPointerUp={handlePinPointerUp} title="Clique para opções. Arraste para mover.">
              <div className="text-[#C5A059]"><PinMarkerIcon /></div>
            </div>
            <span className="mt-1 px-2 py-0.5 bg-[#0a0f18]/80 text-[#C5A059] text-[9px] font-bold uppercase tracking-widest rounded-md border border-[#C5A059]/30 shadow-lg pointer-events-none select-none">{isDraggingPin ? 'Movendo...' : 'Origem'}</span>
            
            {showMarkerMenu && !isDraggingPin && (
               <div className="absolute left-full top-0 ml-4 w-48 bg-[#0a0f18] border border-[#1f2b3e] rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.8)] flex flex-col p-1.5 pointer-events-auto">
                  <button onClick={(e) => { e.stopPropagation(); setShowIsoModal(true); setShowMarkerMenu(false); }} className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs text-white hover:bg-[#1a2435] hover:text-[#C5A059] rounded-lg transition-colors"><IsochroneWavesIcon /> Criar Isócronas</button>
                  <div className="h-[1px] bg-[#1f2b3e] my-1 mx-2" />
                  <button onClick={(e) => { e.stopPropagation(); resetMarkerAndFlow(); }} className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-[#ef4444]/10 hover:text-[#ef4444] rounded-lg transition-colors"><TrashIcon /> Remover Marcador</button>
               </div>
            )}
          </div>
        ) : null;
      })()}

      {showIsoModal && (
         <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-[#030508]/80 backdrop-blur-sm p-4">
            <div className="bg-[#0a0f18] border border-[#1f2b3e] rounded-2xl w-[400px] shadow-[0_30px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">
               <div className="flex items-center justify-between px-6 py-5 border-b border-[#1f2b3e]/80 bg-[#131c2a]">
                 <h3 className="text-sm font-bold text-white tracking-wide flex items-center gap-2"><IsochroneWavesIcon /> Configurar Isócronas</h3>
                 <button onClick={() => resetMarkerAndFlow()} className="text-gray-500 hover:text-white transition-colors"><CloseIcon /></button>
               </div>
               <div className="p-6 flex flex-col gap-6">
                  <div className="flex flex-col gap-3">
                     <label className="text-[10px] text-[#8c9fba] uppercase tracking-widest font-bold">Método de Geração</label>
                     <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
                           <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${isoType === 'time' ? 'border-[#C5A059] bg-[#C5A059]/20' : 'border-[#2a3a54]'}`}>{isoType === 'time' && <div className="w-2 h-2 bg-[#C5A059] rounded-full" />}</div>
                           <input type="radio" value="time" checked={isoType === 'time'} onChange={() => setIsoType('time')} className="hidden" />Tempo
                        </label>
                        <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
                           <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${isoType === 'distance' ? 'border-[#C5A059] bg-[#C5A059]/20' : 'border-[#2a3a54]'}`}>{isoType === 'distance' && <div className="w-2 h-2 bg-[#C5A059] rounded-full" />}</div>
                           <input type="radio" value="distance" checked={isoType === 'distance'} onChange={() => setIsoType('distance')} className="hidden" />Distância
                        </label>
                     </div>
                  </div>
                  {isoType === 'time' && (
                     <div className="flex flex-col gap-2">
                        <label className="text-[10px] text-[#8c9fba] uppercase tracking-widest font-bold">Modalidade do Movimento</label>
                        <select value={isoMode} onChange={(e) => setIsoMode(e.target.value)} className="w-full bg-[#131c2a] border border-[#2a3a54] text-white text-xs rounded-lg p-3 outline-none focus:border-[#C5A059]">
                           <option value="drive_traffic">Dirigindo com Trânsito </option>
                           <option value="drive">Dirigindo (Normal)</option>
                           <option value="bicycle">Bicicleta</option>
                           <option value="walk">Caminhando</option>
                        </select>
                     </div>
                  )}
                  <div className="flex flex-col gap-3">
                     <label className="text-[10px] text-[#8c9fba] uppercase tracking-widest font-bold">Intervalos de {isoType === 'time' ? 'Tempo (Minutos)' : 'Distância (Quilômetros)'}</label>
                     <div className="flex flex-col gap-2">
                        {isoRanges.map((val, idx) => (
                           <div key={idx} className="flex gap-2 items-center">
                              <input type="number" value={val} onChange={(e) => { const newRanges = [...isoRanges]; newRanges[idx] = e.target.value; setIsoRanges(newRanges); }} className="flex-1 bg-[#131c2a] border border-[#2a3a54] text-white text-xs rounded-lg p-2.5 outline-none focus:border-[#C5A059]" placeholder={`Isócrona 0${idx + 1}`} />
                              {isoRanges.length > 1 && (<button onClick={() => setIsoRanges(isoRanges.filter((_, i) => i !== idx))} className="p-2 text-gray-500 hover:text-red-400"><TrashIcon /></button>)}
                           </div>
                        ))}
                     </div>
                     {isoRanges.length < 4 && (<button onClick={() => setIsoRanges([...isoRanges, ''])} className="text-left text-[10px] text-[#C5A059] font-bold uppercase tracking-widest hover:brightness-125 transition-all mt-1">+ Adicionar</button>)}
                  </div>
                  <button onClick={handleCalculateIsochrone} disabled={isLoadingIsochrone} className="w-full mt-2 py-3.5 bg-gradient-to-r from-[#172233] to-[#0d141f] border border-[#C5A059]/30 hover:border-[#C5A059] text-[#C5A059] text-[10px] font-bold uppercase tracking-widest rounded-xl shadow-lg transition-all disabled:opacity-50 flex justify-center items-center gap-2">
                     {isLoadingIsochrone ? (<svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>) : ('Concluir')}
                  </button>
               </div>
            </div>
         </div>
      )}
    </>,
    document.body
  );
}