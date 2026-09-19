import React, { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSelector, useDispatch } from 'react-redux';
import { selectLayers, selectDatasets, selectFilters, selectVisState, selectMapState, KEPLER_ID } from '../pages/Kepler/keplerBridge';
import { layerConfigChange, layerVisConfigChange, removeLayer, addFilter, setFilter, removeFilter, wrapTo, layerVisualChannelConfigChange, addLayer, duplicateLayer, reorderLayer, updateMap, layerTypeChange } from '@kepler.gl/actions';
import * as XLSX from 'xlsx';
import { WebMercatorViewport } from '@deck.gl/core';

// --- SVGs ---
const TableIcon = () => (<svg viewBox="0 0 512 512" fill="currentColor" height="1em" width="1em"><path d="M48 64C21.5 64 0 85.5 0 112v288c0 26.5 21.5 48 48 48h416c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm48 80h112v80H96v-80zm160 0h160v80H256v-80zm-160 128h112v80H96v-80zm160 0h160v80H256v-80zM48 144h416v-32H48v32zm0 160v-64h416v64H48z" /></svg>);
const CloseIcon = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" height="1.5em" width="1.5em"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>);
const DownloadIcon = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" height="1.2em" width="1.2em"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>);
const ExcelIcon = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" height="1.2em" width="1.2em"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M8 13h2.5"></path><path d="M10.5 13v5"></path><path d="M8 18h2.5"></path></svg>);
const LayersTabIcon = () => (<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>);
const FiltersTabIcon = () => (<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>);
const IconPointType = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="2.5" /><circle cx="14" cy="9" r="4" /><circle cx="8" cy="16" r="3" /><circle cx="18" cy="18" r="2" /></svg>);
const IconClusterType = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 3C5.79 3 4 4.79 4 7c0 2.86 4 7 4 7s4-4.14 4-7c0-2.21-1.79-4-4-4zm0 5.5A1.5 1.5 0 118 5.5a1.5 1.5 0 010 3z" /><path d="M16 10c-2.21 0-4 1.79-4 4 0 2.86 4 7 4 7s4-4.14 4-7c0-2.21-1.79-4-4-4zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" /></svg>);
const IconHeatmapType = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 12C5 8 8 5 12 5C16 5 19 8 19 12C19 16 16 19 12 19C8 19 5 16 5 12Z" fill="currentColor" fillOpacity="0.2"/><path d="M8 12C8 9.5 9.5 8 12 8C14.5 8 16 9.5 16 12C16 14.5 14.5 16 12 16C9.5 16 8 14.5 8 12Z" fill="currentColor" fillOpacity="0.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>);

// --- Utils ---
const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((x) => { const hex = Math.round(x).toString(16); return hex.length === 1 ? '0' + hex : hex; }).join('');
const hexToRgb = (hex: string) => { const match = hex.replace('#', '').match(/.{1,2}/g); return match ? [parseInt(match[0], 16), parseInt(match[1], 16), parseInt(match[2], 16)] : [255, 0, 0]; };

const MAONO_PALETTES = [
  { id: 'fogo', name: 'Maõno Fogo', type: 'sequential', category: 'Maono', colors: ['#FFFFCC', '#FFF2B6', '#FFE4A1', '#FFD68C', '#FFC876', '#FFBA61', '#FFAC4C', '#FF9D36', '#FF8F21', '#FF810C', '#F87100', '#E96400', '#DA5700', '#CB4A00', '#BC3D00', '#AD3000', '#9E2300', '#8F1600', '#800900', '#710000'] },
  { id: 'blues', name: 'Maõno Ocean', type: 'sequential', category: 'Maono', colors: ['#f7fbff', '#f2f8fc', '#edf4f9', '#e7f0f6', '#e1ebf3', '#dbe6f0', '#d4e1ed', '#cddbea', '#c6d6e7', '#bfd0e3', '#b7cbe0', '#afc5dc', '#a7bfd9', '#9ebad5', '#95b4d1', '#8caecd', '#81a8c9', '#75a1c4', '#6698be', '#4a87b4'] },
  { id: 'purples', name: 'Maõno Royal', type: 'sequential', category: 'Maono', colors: ['#fcfbfd', '#f7f6fb', '#f2f1f8', '#edeaf5', '#e7e4f1', '#e0deed', '#dad7e8', '#d3d0e4', '#ccc9df', '#c5c1db', '#bebad6', '#b7b1d1', '#b0a8cc', '#a89fc7', '#a096c1', '#988cbb', '#8f82b5', '#8376ad', '#7465a3', '#5c4795'] }
];

const getSafeColors = (colorRange: any) => {
  if (!colorRange || !colorRange.colors) return MAONO_PALETTES[0].colors;
  if (Array.isArray(colorRange.colors)) return colorRange.colors;
  if (typeof colorRange.colors.toArray === 'function') return colorRange.colors.toArray();
  return MAONO_PALETTES[0].colors;
};

// --- Components ---
function MaonoDropdown({ value, options, onChange, placeholder = 'Selecione...' }: any) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(() => options?.find((o: any) => o.value === value)?.label || placeholder, [options, value, placeholder]);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, direction: 'down', maxHeight: 256 });
  const close = () => setOpen(false);

  const computePosition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const margin = 12, gap = 6;
    const availableBelow = Math.max(0, vh - r.bottom - margin);
    const availableAbove = Math.max(0, r.top - margin);
    const preferUp = availableBelow < 220 && availableAbove > availableBelow;
    const direction = preferUp ? 'up' : 'down';
    const maxHeight = Math.min(256, Math.max(140, direction === 'down' ? availableBelow : availableAbove));
    let left = r.left;
    if (left + r.width > vw - margin) left = Math.max(margin, vw - margin - r.width);
    if (left < margin) left = margin;
    const top = direction === 'down' ? r.bottom + gap : Math.max(margin, r.top - gap - maxHeight);
    setPos({ left, top, width: r.width, direction: direction as 'up' | 'down', maxHeight });
  };

  useLayoutEffect(() => { if (open) computePosition(); }, [open, options?.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (btnRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('scroll', computePosition, true);
    window.addEventListener('resize', computePosition);
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', computePosition, true);
      window.removeEventListener('resize', computePosition);
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
    };
  }, [open]);

  return (
    <>
      <div className="relative">
        <button ref={btnRef} type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="w-full !bg-[#131c2a] !border-[#2a3a54] hover:!border-[#C5A059] !text-white font-medium text-xs rounded-lg p-3 flex items-center justify-between outline-none shadow-sm transition-all border">
          <span className={`truncate ${!value ? '!text-gray-400' : '!text-white'}`}>{selected}</span>
          <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''} !text-white`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
        </button>
      </div>
      {open && createPortal(
        <div className="fixed inset-0 z-[9998] pointer-events-none">
          <div ref={menuRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width }} className="z-[9999] pointer-events-auto">
            <div className="!bg-[#131c2a] border border-[#2a3a54] rounded-xl shadow-2xl overflow-hidden">
              <div className="overflow-y-auto maono-scroll py-1" style={{ maxHeight: pos.maxHeight }}>
                {options?.map((opt: any) => (
                  <button key={opt.value} type="button" onClick={(e) => { e.stopPropagation(); onChange(opt.value); close(); }} className={`w-full text-left px-4 py-3 text-xs hover:!bg-[#1a2435] transition-colors ${opt.value === value ? 'font-bold !border-l-2 !border-[#C5A059] !text-[#C5A059] !bg-[#0a0f18]' : '!text-white'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>, document.body
      )}
    </>
  );
}

function RangeFilterBlock({ filterIndex, domain, value, dataset, currentField, onChange, allFilters }: any) {
  const safeDomain = Array.isArray(domain) && domain.length >= 2 ? domain : [0, 100];
  const safeValue = Array.isArray(value) && value.length >= 2 ? value : safeDomain;
  const range = safeDomain[1] - safeDomain[0] || 1;
  const rawMin = safeValue[0] !== undefined ? safeValue[0] : safeDomain[0];
  const rawMax = safeValue[1] !== undefined ? safeValue[1] : safeDomain[1];
  const valMin = isNaN(rawMin) ? safeDomain[0] : rawMin;
  const valMax = isNaN(rawMax) ? safeDomain[1] : rawMax;
  const leftPercent = ((valMin - safeDomain[0]) / range) * 100;
  const widthPercent = ((valMax - valMin) / range) * 100;

  const bins = useMemo(() => {
    if (!dataset || !dataset.rawDataset || !currentField) return [];
    const colIdx = dataset.fields?.findIndex((f: any) => f.name === currentField);
    if (colIdx === undefined || colIdx < 0) return [];

    const numBins = 24;
    const binSize = range / numBins;
    const rawBins = new Array(numBins).fill(0);
    const dataContainer = dataset.rawDataset.dataContainer;
    const allData = dataset.rawDataset.allData;
    const numRows = dataContainer ? dataContainer.numRows() : (allData ? allData.length : 0);

    const otherFilters = (allFilters || []).filter((f: any, idx: number) => {
      const fDataId = f.dataId?.[0] || f.dataId || (f.get && (f.getIn(['dataId', 0]) || f.get('dataId')));
      return idx !== filterIndex && fDataId === dataset.id;
    });

    const filterRules = otherFilters.map((f: any) => {
      const fNameArr = f.name || (f.get && f.get('name'));
      const fName = Array.isArray(fNameArr) ? fNameArr[0] : fNameArr?.toArray ? fNameArr.toArray()[0] : fNameArr || '';
      const cIdx = dataset.fields?.findIndex((col: any) => col.name === fName);
      const fType = f.type || (f.get && f.get('type'));
      const fValue = Array.isArray(f.value) ? f.value : f.value?.toArray ? f.value.toArray() : [];
      return { colIdx: cIdx, type: fType, value: fValue };
    }).filter((r: any) => r.colIdx >= 0);

    for (let i = 0; i < numRows; i++) {
      let passesCascade = true;
      for (const rule of filterRules) {
        const cellVal = dataContainer ? dataContainer.valueAt(i, rule.colIdx) : allData[i][rule.colIdx];
        if (rule.type === 'multiSelect' || rule.type === 'select') {
          if (rule.value && rule.value.length > 0 && !rule.value.includes(cellVal)) { passesCascade = false; break; }
        } else if (rule.type === 'range') {
          if (rule.value && rule.value.length === 2) {
            if (cellVal < rule.value[0] || cellVal > rule.value[1]) { passesCascade = false; break; }
          }
        }
      }
      if (!passesCascade) continue;
      const val = dataContainer ? dataContainer.valueAt(i, colIdx) : allData[i][colIdx];
      if (typeof val === 'number' && !isNaN(val)) {
        let bIdx = Math.floor((val - safeDomain[0]) / binSize);
        if (bIdx >= numBins) bIdx = numBins - 1;
        if (bIdx >= 0) rawBins[bIdx]++;
      }
    }
    const maxCount = Math.max(...rawBins, 1);
    return rawBins.map((count, i) => {
      const barCenter = safeDomain[0] + (i + 0.5) * binSize;
      return { height: (count / maxCount) * 100, center: barCenter, count };
    });
  }, [dataset, currentField, safeDomain, range, allFilters, filterIndex]);

  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDraggingTrack, setIsDraggingTrack] = useState(false);
  const dragInfo = useRef({ startX: 0, minAtStart: 0, maxAtStart: 0, width: 0 });

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sliderRef.current) return;
    dragInfo.current = { startX: e.clientX, minAtStart: valMin, maxAtStart: valMax, width: sliderRef.current.getBoundingClientRect().width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDraggingTrack(true);
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingTrack) return;
    const { startX, minAtStart, maxAtStart, width } = dragInfo.current;
    if (width === 0) return;
    const deltaX = e.clientX - startX;
    const deltaVal = (deltaX / width) * range;
    let newMin = minAtStart + deltaVal;
    let newMax = maxAtStart + deltaVal;
    const windowSize = maxAtStart - minAtStart;
    if (newMin < safeDomain[0]) { newMin = safeDomain[0]; newMax = newMin + windowSize; }
    if (newMax > safeDomain[1]) { newMax = safeDomain[1]; newMin = newMax - windowSize; }
    onChange([newMin, newMax]);
  };

  const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingTrack) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      setIsDraggingTrack(false);
    }
  };

  return (
    <div className="relative flex flex-col gap-4 z-10 mt-1">
      <div className="flex items-center gap-3">
        <input type="number" value={Math.round(valMin) || 0} onChange={(e) => onChange([Math.min(Number(e.target.value), valMax), valMax])} className="w-full !bg-[#131c2a] !border-[#2a3a54] !text-white font-medium text-xs rounded-lg p-2.5 text-center focus:!border-[#C5A059] outline-none transition-all border" />
        <span className="text-[9px] text-[#64748b] font-bold uppercase">A</span>
        <input type="number" value={Math.round(valMax) || 0} onChange={(e) => onChange([valMin, Math.max(Number(e.target.value), valMin)])} className="w-full !bg-[#131c2a] !border-[#2a3a54] !text-white font-medium text-xs rounded-lg p-2.5 text-center focus:!border-[#C5A059] outline-none transition-all border" />
      </div>
      <div className="flex flex-col w-full relative pt-2">
        {bins.length > 0 && (
          <div className="flex items-end w-full h-12 gap-[2px] px-[8px] mb-1">
            {bins.map((bin: any, i: number) => {
              const isSelected = bin.center >= valMin && bin.center <= valMax;
              const isEmpty = bin.count === 0;
              return <div key={i} className={`flex-1 rounded-t-[2px] transition-all duration-300 ${isEmpty ? 'opacity-0' : isSelected ? 'bg-gradient-to-t from-[#C5A059] to-[#dfb96f] shadow-[0_0_8px_rgba(197,160,89,0.3)]' : 'bg-[#1a2435] opacity-60'}`} style={{ height: isEmpty ? '0%' : `${Math.max(bin.height, 4)}%` }} />;
            })}
          </div>
        )}
        <div className="relative h-6 w-full flex items-center group" ref={sliderRef}>
          <div className="absolute w-full h-1 bg-[#0a0f18] border border-[#1a2435] rounded-full shadow-inner" />
          <div onPointerDown={handleTrackPointerDown} onPointerMove={handleTrackPointerMove} onPointerUp={handleTrackPointerUp} onPointerCancel={handleTrackPointerUp} className={`absolute h-1.5 bg-gradient-to-r from-[#8a6d3b] to-[#C5A059] rounded-full pointer-events-auto touch-none ${isDraggingTrack ? 'cursor-grabbing scale-y-150 brightness-125 shadow-[0_0_12px_rgba(197,160,89,0.5)] z-30' : 'cursor-grab hover:brightness-110 shadow-[0_0_8px_rgba(197,160,89,0.3)] z-10'} transition-[filter,transform,box-shadow]`} style={{ left: `${leftPercent || 0}%`, width: `${widthPercent || 0}%` }} />
          <input type="range" min={safeDomain[0]} max={safeDomain[1]} step={range / 100} value={valMin} onChange={(e) => onChange([Math.min(Number(e.target.value), valMax - range * 0.01), valMax])} className="absolute w-full h-full appearance-none bg-transparent outline-none z-20 pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#0b1019] [&::-webkit-slider-thumb]:border-[2.5px] [&::-webkit-slider-thumb]:border-[#C5A059] [&::-webkit-slider-thumb]:rounded-full cursor-ew-resize" />
          <input type="range" min={safeDomain[0]} max={safeDomain[1]} step={range / 100} value={valMax} onChange={(e) => onChange([valMin, Math.max(Number(e.target.value), valMin + range * 0.01)])} className="absolute w-full h-full appearance-none bg-transparent outline-none z-20 pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#0b1019] [&::-webkit-slider-thumb]:border-[2.5px] [&::-webkit-slider-thumb]:border-[#C5A059] [&::-webkit-slider-thumb]:rounded-full cursor-ew-resize" />
        </div>
      </div>
    </div>
  );
}

// --- Data Export Modal ---
function DataExportModal({ dataset, filters, onClose }: { dataset: any, filters: any[], onClose: () => void }) {
  const [data, setData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [appliedFiltersString, setAppliedFiltersString] = useState<string>('');

  useEffect(() => {
    if (!dataset) return;
    setLoading(true);

    const fields = dataset.fields || [];
    setHeaders(fields.map((f: any) => f.name));

    const dataContainer = dataset.rawDataset?.dataContainer;
    const allData = dataset.rawDataset?.allData;
    const numRows = dataContainer ? dataContainer.numRows() : (allData ? allData.length : 0);

    const datasetFilters = filters.filter(f => {
      const fDataId = f.dataId?.[0] || f.dataId || (f.get && (f.getIn(['dataId', 0]) || f.get('dataId')));
      return fDataId === dataset.id;
    });

    const filterTexts = datasetFilters.map((f: any) => {
      const fNameArr = f.name || (f.get && f.get('name'));
      const fName = Array.isArray(fNameArr) ? fNameArr[0] : fNameArr?.toArray ? fNameArr.toArray()[0] : fNameArr || '';
      const fType = f.type || (f.get && f.get('type'));
      const fValue = Array.isArray(f.value) ? f.value : f.value?.toArray ? f.value.toArray() : [];
      
      let valStr = '';
      if (fType === 'range') {
        valStr = `${fValue[0]} a ${fValue[1]}`;
      } else {
        valStr = fValue.join(', ');
      }
      return `${fName}: ${valStr}`;
    });
    setAppliedFiltersString(filterTexts.join(' | '));

    const filterRules = datasetFilters.map((f: any) => {
      const fNameArr = f.name || (f.get && f.get('name'));
      const fName = Array.isArray(fNameArr) ? fNameArr[0] : fNameArr?.toArray ? fNameArr.toArray()[0] : fNameArr || '';
      const cIdx = fields.findIndex((col: any) => col.name === fName);
      const fType = f.type || (f.get && f.get('type'));
      const fValue = Array.isArray(f.value) ? f.value : f.value?.toArray ? f.value.toArray() : [];
      return { colIdx: cIdx, type: fType, value: fValue };
    }).filter((r: any) => r.colIdx >= 0);

    const filteredData = [];

    for (let i = 0; i < numRows; i++) {
      let passesFilters = true;

      for (const rule of filterRules) {
        const cellVal = dataContainer ? dataContainer.valueAt(i, rule.colIdx) : allData[i][rule.colIdx];

        if (rule.type === 'multiSelect' || rule.type === 'select') {
          if (rule.value && rule.value.length > 0 && !rule.value.includes(cellVal)) {
            passesFilters = false;
            break;
          }
        } else if (rule.type === 'range') {
          if (rule.value && rule.value.length === 2) {
             if (cellVal < rule.value[0] || cellVal > rule.value[1]) {
               passesFilters = false;
               break;
             }
          }
        }
      }

      if (passesFilters) {
        const rowData = fields.map((_: any, j: number) => dataContainer ? dataContainer.valueAt(i, j) : allData[i][j]);
        filteredData.push(rowData);
      }
    }

    setData(filteredData);
    setLoading(false);

  }, [dataset, filters]);

  const exportCsv = () => {
    if (!data.length) return;
    const csvContent = [
      headers.join(','),
      ...data.map(row => row.map((cell: any) => {
          let cellStr = cell !== null && cell !== undefined ? String(cell) : '';
          if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
              cellStr = `"${cellStr.replace(/"/g, '""')}"`;
          }
          return cellStr;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${dataset.label || 'export'}_filtrado.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const exportExcel = () => {
    if (!data.length) return;
    try {
      const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Dados Filtrados");
      XLSX.writeFile(workbook, `${dataset.label || 'export'}_filtrado.xlsx`);
    } catch (error) {
      alert("Ocorreu um erro interno ao gerar o arquivo Excel.");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-[#030508]/90 backdrop-blur-md transition-all p-4">
      <div className="flex flex-col w-full max-w-6xl h-[85vh] bg-[#0a0f18] border border-[#1f2b3e] rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.9),0_0_40px_rgba(197,160,89,0.15)] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#1f2b3e]/80 bg-gradient-to-r from-[#131c2a] to-[#0a0f18] shrink-0">
          <div className="flex items-center gap-4">
             <div className="w-10 h-10 rounded-lg bg-[#C5A059]/10 border border-[#C5A059]/30 flex items-center justify-center text-[#C5A059]">
              <TableIcon />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-medium text-gray-100 tracking-wide">Dados Filtrados: {dataset.label}</h2>
                {!loading && (
                   <span className="px-2.5 py-1 bg-[#1a2435] text-[#8c9fba] text-[10px] rounded-full border border-[#1f2b3e]">
                     {data.length} Linhas
                   </span>
                )}
              </div>
              {appliedFiltersString && (
                <span className="text-[11px] text-[#8c9fba] mt-0.5">
                  Filtros ativos: <span style={{ color: '#FFFFFF', fontWeight: 'bold' }}>{appliedFiltersString}</span>
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="!text-white hover:!text-[#C5A059] transition-colors p-2 rounded-full hover:!bg-[#1f2b3e]/50 cursor-pointer">
             <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-auto maono-scroll bg-[#0a0f18] relative">
          {loading ? (
             <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 z-50">
               <div className="w-12 h-12 border-4 border-[#1f2b3e] border-t-[#C5A059] rounded-full animate-spin shadow-[0_0_15px_rgba(197,160,89,0.3)]"></div>
               <span className="text-[#8c9fba] text-xs font-bold tracking-widest uppercase">Aplicando Filtros...</span>
             </div>
          ) : (
            data.length > 0 ? (
              <table className="min-w-full text-left border-collapse whitespace-nowrap">
                <thead className="sticky top-0 z-20 shadow-md">
                  <tr>
                    <th className="w-14 bg-[#161f30] text-[#64748b] text-[10px] font-bold text-center py-3.5 border-b border-r border-[#1f2b3e] sticky left-0 z-30">#</th>
                    {headers.map((header, idx) => (
                      <th key={idx} className="bg-[#131c2a] text-[#8c9fba] text-[10px] font-bold tracking-widest uppercase px-5 py-3.5 border-b border-r border-[#1f2b3e] hover:!bg-[#1a2435] transition-colors max-w-[300px] truncate" title={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-xs text-gray-300 font-mono">
                  {data.slice(0, 100).map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:!bg-[#131c2a]/60 transition-colors group">
                      <td className="w-14 bg-[#0d141f] text-[#64748b] text-center py-3 border-b border-r border-[#1f2b3e] sticky left-0 z-10 group-hover:!bg-[#161f30] transition-colors">
                        {rowIndex + 1}
                      </td>
                      {row.map((cell: any, cellIndex: number) => {
                        const cellContent = cell !== null && cell !== undefined ? String(cell) : '';
                        const isNull = !cellContent;
                        return (
                          <td key={cellIndex} className={`px-5 py-3 border-b border-r border-[#1f2b3e] max-w-[300px] truncate ${isNull ? '!bg-[#1a2435]/30' : ''}`} title={cellContent}>
                            {isNull ? <span className="text-[#64748b]/40 italic text-[11px]">NULL</span> : cellContent}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
               <div className="flex h-full items-center justify-center text-[#64748b] text-sm">
                 Nenhum dado corresponde aos filtros atuais.
               </div>
            )
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-[#1f2b3e]/80 bg-[#0a111f] shrink-0">
           <span className="text-xs text-[#64748b] italic">
             {data.length > 100 ? `Exibindo amostra de 100 de ${data.length} linhas` : ''}
           </span>
           <div className="flex items-center gap-4">
             <button onClick={exportCsv} disabled={loading || data.length === 0} className="flex items-center gap-2 px-6 py-2.5 bg-[#1f2b3e] hover:!bg-[#2a3a54] !text-white text-xs font-bold rounded-lg uppercase tracking-widest transition-all border border-[#3a4a64] disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
               <DownloadIcon /> CSV
             </button>
             <button onClick={exportExcel} disabled={loading || data.length === 0} className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#1D6F42] to-[#124828] hover:brightness-110 !text-white text-xs font-bold rounded-lg uppercase tracking-widest shadow-[0_0_15px_rgba(29,111,66,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
               <ExcelIcon /> Excel (.xlsx)
             </button>
           </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// --- MAIN FILTER PANEL COMPONENT ---
export function FilterPanel({ activeTab = 'layers' }: { activeTab?: 'layers' | 'filters' }) {
  const dispatch = useDispatch();
  const [currentTab, setCurrentTab] = useState<'layers' | 'filters'>(activeTab);
  const [searchQueries, setSearchQueries] = useState<Record<number, string>>({});
  const [openFillPaletteId, setOpenFillPaletteId] = useState<string | null>(null);
  const [openStrokePaletteId, setOpenStrokePaletteId] = useState<string | null>(null);
  
  const [collapsedLayers, setCollapsedLayers] = useState<Record<string, boolean>>({});
  const [hoveringLayerId, setHoveringLayerId] = useState<string | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingLayerName, setEditingLayerName] = useState<string>('');
  const [draggedLayerIdx, setDraggedLayerIdx] = useState<number | null>(null);
  const [dragOverLayerIdx, setDragOverLayerIdx] = useState<number | null>(null);
  const isDraggingGripRef = useRef<boolean>(false);
  const [collapsedFilterGroups, setCollapsedFilterGroups] = useState<Record<string, boolean>>({});
  const [isAddLayerMenuOpen, setIsAddLayerMenuOpen] = useState(false);
  const addLayerMenuRef = useRef<HTMLDivElement>(null);
  const [isAddFilterMenuOpen, setIsAddFilterMenuOpen] = useState(false);
  const addFilterMenuRef = useRef<HTMLDivElement>(null);
  const [exportingDataset, setExportingDataset] = useState<any | null>(null);

  const layersRaw = useSelector((state: any) => selectLayers(state, KEPLER_ID));
  const datasetsRaw = useSelector((state: any) => selectDatasets(state, KEPLER_ID));
  const filtersRaw = useSelector((state: any) => selectFilters(state, KEPLER_ID));
  const visState = useSelector((state: any) => selectVisState(state, KEPLER_ID) || {});
  const mapState = useSelector((state: any) => selectMapState(state, KEPLER_ID)); 

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addLayerMenuRef.current && !addLayerMenuRef.current.contains(event.target as Node)) setIsAddLayerMenuOpen(false);
      if (addFilterMenuRef.current && !addFilterMenuRef.current.contains(event.target as Node)) setIsAddFilterMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { 
    if (activeTab) setCurrentTab(activeTab); 
  }, [activeTab]);

  useEffect(() => {
    setCollapsedLayers({});
    setCollapsedFilterGroups({});
  }, [currentTab]);
  
  let layers: any[] = [];
  try { if (Array.isArray(layersRaw)) layers = layersRaw; else if (layersRaw?.toArray) layers = layersRaw.toArray(); } catch (e) {}
  let filters: any[] = [];
  try { if (Array.isArray(filtersRaw)) filters = filtersRaw; else if (filtersRaw?.toArray) filters = filtersRaw.toArray(); } catch (e) {}

  let layerOrder: string[] = [];
  try {
    const orderRaw = visState.layerOrder;
    layerOrder = Array.isArray(orderRaw) ? orderRaw : orderRaw?.toArray ? orderRaw.toArray() : [];
  } catch (e) {}

  const orderedLayers = useMemo(() => {
    const uiOrder = [...layerOrder]; 
    const mapped = uiOrder.map((id) => layers.find(l => (l.id || l.get?.('id')) === id)).filter(Boolean);
    const unmapped = layers.filter(l => !layerOrder.includes(l.id || l.get?.('id')));
    return [...mapped, ...unmapped];
  }, [layers, layerOrder]);

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

  const DATASET_ACCENT_COLORS = ['#C5A059', '#E2D7C1', '#9CA3AF', '#CD9575', '#64748B'];

  const getDatasetAccentColor = (dataId: string) => {
    const index = availableDatasets.findIndex(d => d.id === dataId);
    const safeIndex = Math.max(0, index); 
    return DATASET_ACCENT_COLORS[safeIndex % DATASET_ACCENT_COLORS.length];
  };

  const startEditingLayer = (layerId: string, currentName: string) => { setEditingLayerId(layerId); setEditingLayerName(currentName); };
  const saveLayerName = (layer: any) => {
    if (editingLayerId && editingLayerName.trim() !== '') dispatch(wrapTo(KEPLER_ID, layerConfigChange(layer, { label: editingLayerName })));
    setEditingLayerId(null);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!isDraggingGripRef.current) { e.preventDefault(); return; }
    setDraggedLayerIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragEnter = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (isDraggingGripRef.current) setDragOverLayerIdx(index);
  };
  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedLayerIdx !== null && draggedLayerIdx !== dropIndex) {
      const currentUiOrder = orderedLayers.map(l => l.id || (l.get && l.get('id')));
      const [movedLayerId] = currentUiOrder.splice(draggedLayerIdx, 1);
      currentUiOrder.splice(dropIndex, 0, movedLayerId);
      dispatch(wrapTo(KEPLER_ID, reorderLayer(currentUiOrder)));
    }
    setDraggedLayerIdx(null);
    setDragOverLayerIdx(null);
    isDraggingGripRef.current = false;
  };
  const handleDragEnd = () => { setDraggedLayerIdx(null); setDragOverLayerIdx(null); isDraggingGripRef.current = false; };

  const handleDuplicateLayer = (layerId: string) => { dispatch(wrapTo(KEPLER_ID, duplicateLayer(layerId))); };
  const handleRemoveLayer = (layerId: string) => { dispatch(wrapTo(KEPLER_ID, removeLayer(layerId))); };
  const toggleLayerCollapse = (layerId: string) => { setCollapsedLayers(prev => ({ ...prev, [layerId]: !(prev[layerId] ?? true) })); };
  const handleToggleVis = (layer: any, currentVis: boolean) => dispatch(wrapTo(KEPLER_ID, layerConfigChange(layer, { isVisible: !currentVis } as any)));
  const handleVisConfigChange = (layer: any, propName: string, value: any) => dispatch(wrapTo(KEPLER_ID, layerVisConfigChange(layer, { [propName]: value })));
  const handleColorChange = (layer: any, hex: string) => dispatch(wrapTo(KEPLER_ID, layerConfigChange(layer, { color: hexToRgb(hex) } as any)));
  const handleStrokeColorChange = (layer: any, hex: string) => dispatch(wrapTo(KEPLER_ID, layerVisConfigChange(layer, { strokeColor: hexToRgb(hex) })));

  const handleFillPaletteChange = (layer: any, paletteId: string) => {
    const pal = MAONO_PALETTES.find((p) => p.id === paletteId) || MAONO_PALETTES[0];
    const currentScale = layer.config?.visConfig?.colorScale || 'quantile';
    dispatch(wrapTo(KEPLER_ID, layerVisConfigChange(layer, { colorRange: pal, colorScale: currentScale })));
  };
  const handleStrokePaletteChange = (layer: any, paletteId: string) => {
    const pal = MAONO_PALETTES.find((p) => p.id === paletteId) || MAONO_PALETTES[0];
    const currentScale = layer.config?.visConfig?.strokeColorScale || 'quantile';
    dispatch(wrapTo(KEPLER_ID, layerVisConfigChange(layer, { strokeColorRange: pal, strokeColorScale: currentScale })));
  };

  const handleFillColorFieldChange = (layer: any, fieldName: string, datasetId: string) => {
    if (!fieldName) { dispatch(wrapTo(KEPLER_ID, layerVisualChannelConfigChange(layer, { colorField: null }, 'color'))); return; }
    const dataset = availableDatasets.find((d) => d.id === datasetId);
    if (!dataset) return;
    const rawField = dataset.fields?.find((f: any) => (f.name || f.get?.('name')) === fieldName);
    if (!rawField) return;
    const isImmutable = typeof rawField.get === 'function';
    const fieldType = isImmutable ? rawField.get('type') : rawField.type;
    const targetScale = (fieldType === 'string' || fieldType === 'boolean') ? 'ordinal' : 'quantile';
    dispatch(wrapTo(KEPLER_ID, layerVisualChannelConfigChange(layer, { colorField: rawField }, 'color')));
    const layerId = layer.id || (layer.get && layer.get('id'));
    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
      dispatch(wrapTo(KEPLER_ID, layerVisConfigChange({ id: layerId } as any, { colorScale: targetScale, colorRange: MAONO_PALETTES[0] })));
      if (ticks >= 8) clearInterval(interval);
    }, 250);
  };

  const handleStrokeColorFieldChange = (layer: any, fieldName: string, datasetId: string) => {
    if (!fieldName) { dispatch(wrapTo(KEPLER_ID, layerVisualChannelConfigChange(layer, { strokeColorField: null }, 'strokeColor'))); return; }
    const dataset = availableDatasets.find((d) => d.id === datasetId);
    if (!dataset) return;
    const rawField = dataset.fields?.find((f: any) => (f.name || f.get?.('name')) === fieldName);
    if (!rawField) return;
    const isImmutable = typeof rawField.get === 'function';
    const fieldType = isImmutable ? rawField.get('type') : rawField.type;
    const targetScale = (fieldType === 'string' || fieldType === 'boolean') ? 'ordinal' : 'quantile';
    dispatch(wrapTo(KEPLER_ID, layerVisualChannelConfigChange(layer, { strokeColorField: rawField }, 'strokeColor')));
    const layerId = layer.id || (layer.get && layer.get('id'));
    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
      dispatch(wrapTo(KEPLER_ID, layerVisConfigChange({ id: layerId } as any, { strokeColorScale: targetScale, strokeColorRange: MAONO_PALETTES[0] })));
      if (ticks >= 8) clearInterval(interval);
    }, 250);
  };

  const handleDeleteFilter = (index: number) => { dispatch(wrapTo(KEPLER_ID, removeFilter(index))); };
  const handleFieldChange = (index: number, fieldName: string) => dispatch(wrapTo(KEPLER_ID, setFilter(index, 'name', fieldName, 0)));
  const handleFilterValueChange = (index: number, newValue: any) => dispatch(wrapTo(KEPLER_ID, setFilter(index, 'value', newValue)));

  const getTabClass = (tabName: string) => {
    const isActive = currentTab === tabName;
    return `flex-1 py-4 flex items-center justify-center transition-all relative z-10 outline-none ${ 
      isActive 
        ? '!text-[#C5A059] after:content-[\'\'] after:absolute after:bottom-0 after:inset-x-0 after:mx-auto after:w-8 after:h-[3px] after:bg-[#C5A059] after:rounded-t-md after:shadow-[0_0_12px_2px_rgba(197,160,89,0.9)]' 
        : '!text-[#64748b] hover:!text-gray-400' 
    }`;
  };

  // =========================================================================
  // 🚀 SENSOR DE CÂMERA INTELIGENTE (TOAST DE FILTRO ÚNICO)
  // =========================================================================
  const [lastFilteredDataId, setLastFilteredDataId] = useState<string | null>(null);
  const [topCenterDismissed, setTopCenterDismissed] = useState(true);
  const prevFiltersRef = useRef<string>('[]');
  const [isFlying, setIsFlying] = useState(false);

  // Monitora QUAL filtro foi o último a ser alterado
  useEffect(() => {
    const currentFiltersMapped = filters.map((f: any) => {
      const id = f.id || (f.get && f.get('id'));
      const dataId = f.dataId?.[0] || f.dataId || (f.get && (f.getIn(['dataId', 0]) || f.get('dataId')));
      const value = Array.isArray(f.value) ? f.value : f.value?.toArray ? f.value.toArray() : f.value;
      return { id, dataId, value };
    });
    const currentStr = JSON.stringify(currentFiltersMapped);
    
    if (currentStr !== prevFiltersRef.current) {
      const prev = JSON.parse(prevFiltersRef.current);
      const changed = currentFiltersMapped.find((c, i) => !prev[i] || JSON.stringify(c.value) !== JSON.stringify(prev[i].value));
      
      if (changed && changed.dataId && changed.value !== null && changed.value !== undefined && (!Array.isArray(changed.value) || changed.value.length !== 0)) {
        setLastFilteredDataId(changed.dataId);
        setTopCenterDismissed(false); 
      }
      prevFiltersRef.current = currentStr;
    }
  }, [filters]);

  // Calcula a Bounding Box APENAS daquele dataset que acabou de ser filtrado
  const [targetBounds, setTargetBounds] = useState<number[] | null>(null);
  const [centroid, setCentroid] = useState<{lat: number, lng: number} | null>(null);

  useEffect(() => {
    if (topCenterDismissed || !lastFilteredDataId) return;

    const debounceTimer = setTimeout(() => {
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

      try {
        orderedLayers.forEach((layer: any) => {
          // 🚀 CORREÇÃO 2: Leitura blindada
          const config = layer.config || (layer.get && layer.get('config'));
          const layerType = layer.type || (layer.get && layer.get('type'));

          if (!config?.isVisible) return;
          const dataId = config.dataId;
          if (dataId !== lastFilteredDataId) return;
          
          const isPoint = layerType === 'point' || layerType === 'cluster' || layerType === 'heatmap';
          const isGeojson = layerType === 'geojson';
          if (!isPoint && !isGeojson) return;
          
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

          const filteredIdx = ds.rawDataset?.filteredIndex || ds.rawDataset?.allIndexes || [];
          const dataContainer = ds.rawDataset?.dataContainer;
          const allData = ds.rawDataset?.allData;

          for (let i = 0; i < filteredIdx.length; i++) {
            const rowIndex = filteredIdx[i];
            if (isPoint && latIdx >= 0 && lngIdx >= 0) {
              const lat = dataContainer ? dataContainer.valueAt(rowIndex, latIdx) : allData[rowIndex][latIdx];
              const lng = dataContainer ? dataContainer.valueAt(rowIndex, lngIdx) : allData[rowIndex][lngIdx];
              if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
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
          setTargetBounds([minLng, minLat, maxLng, maxLat]);
          setCentroid({ lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 });
        } else {
          setTargetBounds(null);
          setCentroid(null);
        }
      } catch (err) {}
    }, 600);
    return () => clearTimeout(debounceTimer);
  }, [lastFilteredDataId, topCenterDismissed, orderedLayers, availableDatasets]);

  const handleTopCenterFly = () => {
    if (isFlying || !mapState?.width || !mapState?.height || !targetBounds) return;
    setIsFlying(true); 

    const viewport = new WebMercatorViewport({ width: mapState.width, height: mapState.height });
    const [minLng, minLat, maxLng, maxLat] = targetBounds;
    const fitted = viewport.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 120 });
    
    const startLng = mapState.longitude, startLat = mapState.latitude, startZoom = mapState.zoom;
    const endLng = fitted.longitude, endLat = fitted.latitude, endZoom = Math.max(0, fitted.zoom - 0.5);

    const duration = 2000; 
    const startTime = performance.now();

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
      else { 
        setIsFlying(false); 
        setTopCenterDismissed(true); // 🚀 MATOU!
      }
    };
    requestAnimationFrame(animateCamera);
  };

  return (
    <aside className="relative flex flex-col w-full h-full min-h-0 bg-gradient-to-b from-[#0a111f] to-[#030508] text-white overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#1a2b45] rounded-full blur-[140px] opacity-30 pointer-events-none z-0" />

      <div className="relative flex bg-transparent border-b border-[#1f2b3e]/60 shrink-0 px-2 z-10">
        <button onClick={() => setCurrentTab('layers')} className={getTabClass('layers')} title="Camadas">
          <LayersTabIcon />
        </button>
        <button onClick={() => setCurrentTab('filters')} className={getTabClass('filters')} title="Filtros">
          <FiltersTabIcon />
        </button>
      </div>

      <div className="relative flex flex-col gap-8 overflow-y-auto maono-scroll p-6 flex-1 min-h-0 touch-pan-y z-10">
        
        {currentTab === 'layers' && (
          <div className="flex flex-col gap-6 pb-6">
            <div className="flex flex-col gap-3 border-b border-[#1f2b3e]/60 pb-5">
              <div className="flex items-center justify-end">
                <div className="relative z-[999]" ref={addLayerMenuRef}>
                  <button 
                    onClick={() => setIsAddLayerMenuOpen(!isAddLayerMenuOpen)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#0E8A5E] hover:bg-[#11A872] !text-white text-xs font-medium rounded shadow-[0_0_10px_rgba(14,138,94,0.3)] transition-all"
                  >
                    <span className="text-lg leading-none mb-0.5">+</span> Add Camada
                  </button>
                  {isAddLayerMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-56 bg-[#0a0f18] border border-[#1f2b3e] rounded-xl shadow-2xl overflow-hidden">
                      <div className="px-4 py-2.5 bg-[#131c2a] border-b border-[#1f2b3e]/60">
                        <span className="text-[9px] font-bold text-[#8c9fba] uppercase tracking-widest">Selecione os Dados</span>
                      </div>
                      <div className="flex flex-col max-h-48 overflow-y-auto maono-scroll py-1">
                        {availableDatasets.length > 0 ? (
                          availableDatasets.map((ds) => (
                            <button
                              key={ds.id}
                              onClick={() => {
                                const datasetFields = ds.fields || [];
                                let layerType = 'point'; 
                                let columnsConfig: any = {};
                                const geojsonField = datasetFields.find((f: any) => f.type === 'geojson' || String(f.name).toLowerCase() === '_geojson' || String(f.name).toLowerCase() === 'geometry');
                                if (geojsonField) {
                                  layerType = 'geojson';
                                  columnsConfig = { geojson: geojsonField.name };
                                } else {
                                  const latRegex = /^(lat|latitude|_lat|_latitude|y)$/i;
                                  const lngRegex = /^(lon|lng|longitude|_lon|_lng|_longitude|x)$/i;
                                  const latField = datasetFields.find((f: any) => (f.type === 'real' || f.type === 'integer') && latRegex.test(f.name));
                                  const lngField = datasetFields.find((f: any) => (f.type === 'real' || f.type === 'integer') && lngRegex.test(f.name));
                                  if (latField && lngField) {
                                    layerType = 'point';
                                    columnsConfig = { lat: latField.name, lng: lngField.name, altitude: null };
                                  }
                                }
                                dispatch(wrapTo(KEPLER_ID, addLayer({
                                  id: `layer_${Date.now()}`, type: layerType, 
                                  config: { dataId: ds.id, label: ds.label, isVisible: true, columns: columnsConfig, color: [197, 160, 89], visConfig: { filled: true, opacity: 0.8, stroked: true } }
                                })));
                                setIsAddLayerMenuOpen(false); 
                              }}
                              className="w-full text-left px-4 py-3 text-xs text-gray-200 hover:text-[#C5A059] hover:bg-[#131c2a] transition-colors truncate border-b border-[#1f2b3e]/30 last:border-0"
                              title={ds.label}
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getDatasetAccentColor(ds.id) }} />
                                <span className="truncate">{ds.label}</span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-xs text-gray-500 italic text-center">Nenhum dado importado.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {orderedLayers.map((layer: any, index: number) => {
              const config = layer.config || layer.get?.('config');
              const vis = config?.visConfig;
              const dataId = config?.dataId;
              const layerDataset = availableDatasets.find((d) => d.id === dataId);
              const layerId = layer.id || (layer.get && layer.get('id')) || String(index);
              const layerType = layer.type || (layer.get && layer.get('type')) || 'geojson';
              const isLayerVisible = config?.isVisible ?? true;
              const stableLayerKey = `${dataId}_${config?.label || layerId}`;
              const isCollapsed = collapsedLayers[stableLayerKey] ?? true; 
              
              const filled = vis?.filled ?? true;
              const fillOpacity = vis?.opacity ?? 0.8;
              const fillHexColor = Array.isArray(config?.color) ? rgbToHex(config.color[0], config.color[1], config.color[2]) : '#ff0000';
              const fillColorFieldName = config?.colorField?.name || '';
              const fillColorScale = vis?.colorScale || 'quantile';
              const fillColorsArray = getSafeColors(vis?.colorRange);
              const stroked = vis?.stroked ?? false;
              const thickness = vis?.thickness ?? 1;
              const strokeHexColor = Array.isArray(vis?.strokeColor) ? rgbToHex(vis.strokeColor[0], vis.strokeColor[1], vis.strokeColor[2]) : '#000000';
              const strokeColorFieldName = config?.strokeColorField?.name || '';
              const strokeColorScale = vis?.strokeColorScale || 'quantile';
              const strokeColorsArray = getSafeColors(vis?.strokeColorRange);
              const dropdownOptions = (layerDataset && layerDataset.fields && layerDataset.fields.length > 0)
                ? [ { label: 'Fixo (Sem Coluna)', value: '' }, ...layerDataset.fields.map((f: any) => ({ label: f.name || (f.get && f.get('name')), value: f.name || (f.get && f.get('name')) })) ]
                : [];
              const accentColor = getDatasetAccentColor(dataId);
              let dragBorderClass = 'border-[#1f2b3e]';
              if (dragOverLayerIdx === index) dragBorderClass = draggedLayerIdx !== null && draggedLayerIdx > index ? 'border-t-[#C5A059] border-t-2' : 'border-b-[#C5A059] border-b-2';
              else if (isLayerVisible) dragBorderClass = 'border-y-[#1f2b3e] border-r-[#1f2b3e]';
              else dragBorderClass = 'border-[#1f2b3e] opacity-60';
              const hasActiveFilters = filters.some(f => {
                const fDataId = f.dataId?.[0] || f.dataId || (f.get && (f.getIn(['dataId', 0]) || f.get('dataId')));
                return fDataId === dataId;
              });
              return (
                <div key={layerId} draggable onDragStart={(e) => handleDragStart(e, index)} onDragEnter={(e) => handleDragEnter(e, index)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, index)} onDragEnd={handleDragEnd}
                  className={`group relative flex flex-col bg-gradient-to-b from-[#131c2a] to-[#0b1019] rounded border ${dragBorderClass} shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_25px_rgba(0,0,0,0.4)] transition-all duration-300 ${draggedLayerIdx === index ? 'opacity-40 scale-95' : ''}`}
                  onMouseEnter={() => setHoveringLayerId(layerId)} onMouseLeave={() => setHoveringLayerId(null)}
                >
                  <div className={`absolute top-0 left-0 bottom-0 w-1 rounded-l transition-opacity ${isLayerVisible ? 'opacity-100' : 'opacity-50'} z-10`} style={{ backgroundColor: accentColor }}></div>
                  <div className="relative flex items-center justify-between py-3 pr-4 cursor-pointer hover:bg-[#1a2435]/50 transition-colors">
                    <div className="w-8 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 cursor-grab text-[#64748b] hover:text-white transition-opacity" onMouseDown={() => { isDraggingGripRef.current = true; }} onMouseUp={() => { isDraggingGripRef.current = false; }} onMouseLeave={() => { isDraggingGripRef.current = false; }}>
                      <svg className="w-3.5 h-3.5 pointer-events-none" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="2"></circle><circle cx="9" cy="12" r="2"></circle><circle cx="9" cy="18" r="2"></circle><circle cx="15" cy="6" r="2"></circle><circle cx="15" cy="12" r="2"></circle><circle cx="15" cy="18" r="2"></circle></svg>
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 pr-2" onClick={() => toggleLayerCollapse(stableLayerKey)}>
                      {editingLayerId === layerId ? (
                        <input type="text" value={editingLayerName} onChange={(e) => setEditingLayerName(e.target.value)} onBlur={() => saveLayerName(layer)} onKeyDown={(e) => { if (e.key === 'Enter') saveLayerName(layer); }} autoFocus className="bg-[#0a0f18] border border-[#C5A059] text-xs text-gray-200 px-2 py-0.5 rounded outline-none w-full max-w-[180px] shadow-[0_0_8px_rgba(197,160,89,0.3)]" onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold tracking-wide truncate ${isLayerVisible ? 'text-gray-200' : 'text-gray-500'}`}>{config?.label || 'Nova Camada'}</span>
                          <button onClick={(e) => { e.stopPropagation(); startEditingLayer(layerId, config?.label || ''); }} className="opacity-0 group-hover:opacity-100 text-[#64748b] hover:text-[#C5A059] transition-all shrink-0"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                        </div>
                      )}
                      <span className="text-[9px] text-gray-500 capitalize mt-0.5">{layerType}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className={`flex items-center gap-1 transition-opacity duration-200 ${hoveringLayerId === layerId ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                         {hasActiveFilters && layerDataset && (
                          <button onClick={(e) => { e.stopPropagation(); setExportingDataset(layerDataset); }} className="text-[#C5A059] hover:text-white transition-colors p-1 rounded" title="Baixar Dados Filtrados">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); handleDuplicateLayer(layerId); }} className="text-[#64748b] hover:text-white transition-colors p-1 rounded"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg></button>
                        <button onClick={(e) => { e.stopPropagation(); handleRemoveLayer(layerId); }} className="text-[#64748b] hover:text-red-400 transition-colors p-1 rounded"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); handleToggleVis(layer, isLayerVisible); }} className="text-[#64748b] hover:text-white transition-colors p-1 ml-1 rounded">
                        {isLayerVisible ? (<svg className="w-4 h-4 text-[#C5A059]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>) : (<svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>)}
                      </button>
                      <svg onClick={() => toggleLayerCollapse(stableLayerKey)} className={`w-4 h-4 text-[#64748b] transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>
                  <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[1200px] opacity-100'}`}>
                    {dropdownOptions.length > 0 ? (
                      <div className="relative p-5 flex flex-col gap-7 border-t border-[#1f2b3e]/40 z-10 overflow-visible">
                        {['point', 'cluster', 'heatmap'].includes(layerType) && (
                          <div className="flex flex-col gap-3 pb-5 border-b border-[#1f2b3e]/40">
                            <span className="text-[11px] font-medium text-[#8c9fba]">Formato de Visualização</span>
                            <MaonoDropdown 
                              value={layerType} 
                              options={[
                                { label: <div className="flex items-center gap-2.5"><IconPointType /><span className="mt-0.5">Pontos (Point)</span></div>, value: 'point' },
                                { label: <div className="flex items-center gap-2.5"><IconClusterType /><span className="mt-0.5">Agrupamentos (Cluster)</span></div>, value: 'cluster' },
                                { label: <div className="flex items-center gap-2.5"><IconHeatmapType /><span className="mt-0.5">Mapa de Calor (Heatmap)</span></div>, value: 'heatmap' }
                              ]} 
                              onChange={(newType: string) => { if(layerType !== newType) dispatch(wrapTo(KEPLER_ID, layerTypeChange(layer, newType))); }} 
                            />
                          </div>
                        )}
                        <div className="flex flex-col gap-4">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-[#8c9fba]">Preenchimento</span>
                            <button onClick={() => handleVisConfigChange(layer, 'filled', !filled)} className={`relative inline-flex h-4 w-8 items-center rounded-full transition-all ${ filled ? 'bg-gradient-to-r from-[#8a6d3b] to-[#C5A059] shadow-[0_0_8px_rgba(197,160,89,0.3)]' : 'bg-[#161f30]' }`}>
                              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${ filled ? 'translate-x-4' : 'translate-x-1' }`} />
                            </button>
                          </div>
                          {filled && (
                            <div className="flex flex-col gap-5">
                              <div className="flex items-center gap-4">
                                <input type="color" value={fillHexColor} onChange={(e) => handleColorChange(layer, e.target.value)} className={`w-7 h-7 rounded border border-[#1f2b3e] cursor-pointer bg-[#0a0f18] p-0.5 ${ fillColorFieldName ? 'opacity-30 pointer-events-none' : '' }`} />
                                <div className="flex-1 flex flex-col gap-1.5">
                                  <span className="text-[9px] text-[#64748b] uppercase tracking-widest">Opacidade</span>
                                  <input type="range" min="0" max="1" step="0.05" value={fillOpacity} onChange={(e) => handleVisConfigChange(layer, 'opacity', parseFloat(e.target.value))} className="w-full h-1 bg-[#1a2435] rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-[#0b1019] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#C5A059] [&::-webkit-slider-thumb]:rounded-full shadow-lg" />
                                </div>
                              </div>
                              <div className="flex flex-col gap-4 pt-4 border-t border-[#1f2b3e]/40">
                                <div className="flex flex-col gap-1.5">
                                  <span className="text-[9px] text-[#64748b] uppercase tracking-widest">Colorir por Coluna</span>
                                  <MaonoDropdown value={fillColorFieldName} options={dropdownOptions} onChange={(v: string) => handleFillColorFieldChange(layer, v, dataId)} placeholder="Fixo (Sem Coluna)" />
                                </div>
                                {fillColorFieldName && (
                                  <>
                                    <div className="flex flex-col gap-1.5">
                                      <span className="text-[9px] text-[#64748b] uppercase tracking-widest">Escala da Cor</span>
                                      <MaonoDropdown value={fillColorScale} options={[{ label: 'Quantile (Distribuição)', value: 'quantile' }, { label: 'Quantize (Intervalos Iguais)', value: 'quantize' }, { label: 'Linear (Contínua)', value: 'linear' }, { label: 'Ordinal (Texto/Categorias)', value: 'ordinal' }]} onChange={(v: string) => dispatch(wrapTo(KEPLER_ID, layerVisConfigChange(layer, { colorScale: v })))} />
                                    </div>
                                    <div className="flex flex-col gap-1.5 relative">
                                      <span className="text-[9px] text-[#64748b] uppercase tracking-widest">Paleta de Cores</span>
                                      <div onClick={() => setOpenFillPaletteId(openFillPaletteId === layerId ? null : layerId)} className="flex h-6 w-full cursor-pointer rounded-lg border border-[#1a2435] overflow-hidden hover:border-[#C5A059]/50 shadow-[inset_0_2px_5px_rgba(0,0,0,0.5)] transition-all">
                                        {fillColorsArray.map((c: string, i: number) => (<div key={i} style={{ backgroundColor: c, flex: 1 }} />))}
                                      </div>
                                      {openFillPaletteId === layerId && (
                                        <>
                                          <div className="fixed inset-0 z-40" onClick={() => setOpenFillPaletteId(null)} />
                                          <div className="absolute top-12 left-0 w-full z-50 bg-[#0a0f18] border border-[#1f2b3e] rounded-xl shadow-2xl overflow-hidden">
                                            <div className="max-h-48 overflow-y-auto maono-scroll">
                                              {MAONO_PALETTES.map((pal) => (
                                                <div key={pal.id} onClick={() => { handleFillPaletteChange(layer, pal.id); setOpenFillPaletteId(null); }} className="flex flex-col px-4 py-3 hover:bg-[#131c2a] cursor-pointer border-b border-[#1f2b3e]/50 last:border-0">
                                                  <span className="text-[10px] font-medium text-[#8c9fba] mb-2">{pal.name}</span>
                                                  <div className="flex h-2.5 w-full rounded overflow-hidden">{pal.colors.map((c, i) => <div key={i} style={{ backgroundColor: c, flex: 1 }} />)}</div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-4 pt-5 border-t border-[#1f2b3e]/40">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-[#8c9fba]">Contorno das Bordas</span>
                            <button onClick={() => dispatch(wrapTo(KEPLER_ID, layerVisConfigChange(layer, { stroked: !stroked })))} className={`relative inline-flex h-4 w-8 items-center rounded-full transition-all ${ stroked ? 'bg-gradient-to-r from-[#8a6d3b] to-[#C5A059] shadow-[0_0_8px_rgba(197,160,89,0.3)]' : 'bg-[#161f30]' }`}>
                              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${ stroked ? 'translate-x-4' : 'translate-x-1' }`} />
                            </button>
                          </div>
                          {stroked && (
                            <div className="flex flex-col gap-5">
                              <div className="flex items-center gap-4">
                                <input type="color" value={strokeHexColor} onChange={(e) => handleStrokeColorChange(layer, e.target.value)} className={`w-7 h-7 rounded border border-[#1f2b3e] cursor-pointer bg-[#0a0f18] p-0.5 ${ strokeColorFieldName ? 'opacity-30 pointer-events-none' : '' }`} />
                                <div className="flex-1 flex flex-col gap-1.5">
                                  <span className="text-[9px] text-[#64748b] uppercase tracking-widest">Espessura</span>
                                  <input type="range" min="0.1" max="10" step="0.1" value={thickness} onChange={(e) => dispatch(wrapTo(KEPLER_ID, layerVisConfigChange(layer, { thickness: parseFloat(e.target.value) })))} className="w-full h-1 bg-[#1a2435] rounded-full appearance-none outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-[#0b1019] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#C5A059] [&::-webkit-slider-thumb]:rounded-full shadow-lg" />
                                </div>
                              </div>
                              <div className="flex flex-col gap-4 pt-4 border-t border-[#1f2b3e]/40">
                                <div className="flex flex-col gap-1.5">
                                  <span className="text-[9px] text-[#64748b] uppercase tracking-widest">Contorno por Coluna</span>
                                  <MaonoDropdown value={strokeColorFieldName} options={dropdownOptions} onChange={(v: string) => handleStrokeColorFieldChange(layer, v, dataId)} placeholder="Fixo (Sem Coluna)" />
                                </div>
                                {strokeColorFieldName && (
                                  <>
                                    <div className="flex flex-col gap-1.5">
                                      <span className="text-[9px] text-[#64748b] uppercase tracking-widest">Escala da Cor (Borda)</span>
                                      <MaonoDropdown value={strokeColorScale} options={[{ label: 'Quantile (Distribuição)', value: 'quantile' }, { label: 'Quantize (Intervalos Iguais)', value: 'quantize' }, { label: 'Linear (Contínua)', value: 'linear' }, { label: 'Ordinal (Texto/Categorias)', value: 'ordinal' }]} onChange={(v: string) => dispatch(wrapTo(KEPLER_ID, layerVisConfigChange(layer, { strokeColorScale: v })))} />
                                    </div>
                                    <div className="flex flex-col gap-1.5 relative">
                                      <span className="text-[9px] text-[#64748b] uppercase tracking-widest">Paleta de Cores (Borda)</span>
                                      <div onClick={() => setOpenStrokePaletteId(openStrokePaletteId === layerId ? null : layerId)} className="flex h-6 w-full cursor-pointer rounded-lg border border-[#1a2435] overflow-hidden hover:border-[#C5A059]/50 shadow-[inset_0_2px_5px_rgba(0,0,0,0.5)] transition-all">
                                        {strokeColorsArray.map((c: string, i: number) => (<div key={i} style={{ backgroundColor: c, flex: 1 }} />))}
                                      </div>
                                      {openStrokePaletteId === layerId && (
                                        <>
                                          <div className="fixed inset-0 z-40" onClick={() => setOpenStrokePaletteId(null)} />
                                          <div className="absolute top-12 left-0 w-full z-50 bg-[#0a0f18] border border-[#1f2b3e] rounded-xl shadow-2xl overflow-hidden">
                                            <div className="max-h-48 overflow-y-auto maono-scroll">
                                              {MAONO_PALETTES.map((pal) => (
                                                <div key={pal.id} onClick={() => { handleStrokePaletteChange(layer, pal.id); setOpenStrokePaletteId(null); }} className="flex flex-col px-4 py-3 hover:bg-[#131c2a] cursor-pointer border-b border-[#1f2b3e]/50 last:border-0">
                                                  <span className="text-[10px] font-medium text-[#8c9fba] mb-2">{pal.name}</span>
                                                  <div className="flex h-2.5 w-full rounded overflow-hidden">{pal.colors.map((c, i) => <div key={i} style={{ backgroundColor: c, flex: 1 }} />)}</div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-5 text-center text-xs text-[#8c9fba] italic bg-[#0a0f18]/50">Processando dados da camada...</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {currentTab === 'filters' && (
          <div className="flex flex-col gap-6 pb-6">
            <div className="relative z-50" ref={addFilterMenuRef}>
              <button onClick={() => setIsAddFilterMenuOpen(!isAddFilterMenuOpen)} className="w-full py-4 bg-gradient-to-b from-[#172233] to-[#0d141f] border border-[#C5A059]/20 shadow-lg hover:border-[#C5A059]/50 rounded-xl text-[#C5A059] font-semibold text-xs tracking-wide transition-all flex items-center justify-center gap-2 group">
                <span className="text-lg leading-none font-light group-hover:scale-110 transition-transform">+</span> Adicionar Novo Filtro
              </button>
              {isAddFilterMenuOpen && (
                <div className="absolute left-0 top-full mt-2 w-full bg-[#0a0f18] border border-[#1f2b3e] rounded-xl shadow-2xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#131c2a] border-b border-[#1f2b3e]/60"><span className="text-[9px] font-bold text-[#8c9fba] uppercase tracking-widest">Filtrar qual Base de Dados?</span></div>
                  <div className="flex flex-col max-h-48 overflow-y-auto maono-scroll py-1">
                    {availableDatasets.length > 0 ? (
                      availableDatasets.map((ds) => (
                        <button key={ds.id} onClick={() => { dispatch(wrapTo(KEPLER_ID, addFilter(ds.id))); setIsAddFilterMenuOpen(false); setCollapsedFilterGroups(prev => ({ ...prev, [ds.id]: false })); }} className="w-full text-left px-4 py-3 text-xs text-gray-200 hover:text-[#C5A059] hover:bg-[#131c2a] transition-colors truncate border-b border-[#1f2b3e]/30 last:border-0">
                          <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: getDatasetAccentColor(ds.id) }} /><span className="truncate">{ds.label}</span></div>
                        </button>
                      ))
                    ) : (<div className="px-4 py-3 text-xs text-gray-500 italic text-center">Nenhum dado disponível.</div>)}
                  </div>
                </div>
              )}
            </div>
            {availableDatasets.map((ds) => {
              const dsFilters = filters.map((f: any, i: number) => ({ filter: f, absoluteIndex: i })).filter(({ filter }) => {
                const dataId = filter.dataId?.[0] || filter.dataId || (filter.get && (filter.getIn(['dataId', 0]) || filter.get('dataId')));
                return dataId === ds.id;
              });
              if (dsFilters.length === 0) return null; 
              const isGroupCollapsed = collapsedFilterGroups[ds.id] ?? true; 
              const accentColor = getDatasetAccentColor(ds.id); 
              return (
                <div key={ds.id} className="flex flex-col border border-[#1f2b3e]/60 rounded-xl bg-[#0a0f18]/30 overflow-hidden shadow-lg">
                  <div onClick={() => setCollapsedFilterGroups(prev => ({ ...prev, [ds.id]: !(prev[ds.id] ?? true) }))} className="flex items-center justify-between p-4 bg-gradient-to-b from-[#131c2a] to-[#0b1019] border-b border-[#1f2b3e]/60 cursor-pointer hover:bg-[#1a2435]/50 transition-colors">
                    <div className="flex items-center gap-2.5 overflow-hidden pr-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px_rgba(0,0,0,0.5)]" style={{ backgroundColor: accentColor }} />
                      <span className="text-[11px] font-bold tracking-widest truncate" style={{ color: accentColor }}>{ds.label}</span>
                      <span className="text-[10px] bg-[#1a2435] text-[#8c9fba] px-2 py-0.5 rounded-full ml-1 shrink-0">{dsFilters.length}</span>
                    </div>
                    <svg className={`w-4 h-4 text-[#64748b] transition-transform duration-300 shrink-0 ${isGroupCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                  </div>
                  <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isGroupCollapsed ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'}`}>
                    <div className="p-4 flex flex-col gap-6">
                      {dsFilters.map(({ filter, absoluteIndex }) => {
                        const filterType = filter.type || (filter.get && filter.get('type'));
                        const domain = Array.isArray(filter.domain) ? filter.domain : filter.domain?.toArray ? filter.domain.toArray() : [];
                        const value = Array.isArray(filter.value) ? filter.value : filter.value?.toArray ? filter.value.toArray() : [];
                        const columns = ds.fields || [];
                        const dropdownOptions = columns.map((col: any) => ({ label: col.name || (col.get && col.get('name')), value: col.name || (col.get && col.get('name')) }));
                        const currentFieldArr = filter.name || (filter.get && filter.get('name'));
                        const currentField = Array.isArray(currentFieldArr) ? currentFieldArr[0] : currentFieldArr?.toArray ? currentFieldArr.toArray()[0] : currentFieldArr || '';
                        const filterId = filter.id || (filter.get && filter.get('id')) || String(absoluteIndex);
                        return (
                          <div key={filterId} className="relative bg-gradient-to-b from-[#131c2a] to-[#0b1019] rounded-lg border border-[#1f2b3e] p-4 shadow-md">
                            <div className="relative flex items-center justify-between mb-4 pb-2 z-10 border-b border-[#1f2b3e]/40">
                              <span className="text-[9px] font-bold text-[#64748b] tracking-widest uppercase">Propriedade do Filtro</span>
                              <button onClick={() => handleDeleteFilter(absoluteIndex)} className="text-[#64748b] hover:text-red-400 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
                            </div>
                            <div className="relative mb-5 z-10"><MaonoDropdown value={currentField} options={dropdownOptions} onChange={(v: string) => handleFieldChange(absoluteIndex, v)} placeholder="Selecione uma coluna..." /></div>
                            {filterType === 'range' && domain.length >= 2 && (<RangeFilterBlock filterIndex={absoluteIndex} domain={domain} value={value} dataset={ds} currentField={currentField} onChange={(nextValue: any) => handleFilterValueChange(absoluteIndex, nextValue)} allFilters={filters} />)}
                            {['multiSelect', 'select'].includes(filterType) && domain.length > 0 && (
                              <div className="relative flex flex-col gap-4 z-10 mt-1">
                                <div className="flex items-center gap-2">
                                  <div className="relative flex-1">
                                    <input type="text" placeholder="Pesquisar categoria..." value={searchQueries[absoluteIndex] || ''} onChange={(e) => setSearchQueries((prev) => ({ ...prev, [absoluteIndex]: e.target.value }))} className="w-full bg-[#131c2a] border border-[#2a3a54] shadow-[0_2px_5px_rgba(0,0,0,0.2)] focus:border-[#C5A059]/60 !text-white text-xs rounded-lg p-3 pl-9 outline-none transition-all" />
                                    <svg className="w-4 h-4 absolute left-3 top-3.5 text-[#64748b]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                  </div>
                                  {value && value.length > 0 && (
                                    <button onClick={() => handleFilterValueChange(absoluteIndex, [])} className="flex items-center justify-center p-3 bg-[#131c2a] border border-[#2a3a54] hover:border-[#ef4444] text-[#64748b] hover:text-[#ef4444] rounded-lg transition-all shadow-sm group" title="Limpar todas as seleções">
                                      <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                  )}
                                </div>
                                <div className="flex flex-col max-h-48 overflow-y-auto maono-scroll pr-2 border-y border-[#1f2b3e]/40 py-2">
                                  {domain.filter((itemValue: any) => { 
                                      const search = (searchQueries[absoluteIndex] || '').toLowerCase(); 
                                      return !search ? true : String(itemValue).toLowerCase().includes(search); 
                                    })
                                    .sort((a: any, b: any) => {
                                      const aChecked = value.includes(a);
                                      const bChecked = value.includes(b);
                                      if (aChecked === bChecked) return String(a).localeCompare(String(b));
                                      return aChecked ? -1 : 1;
                                    })
                                    .map((itemValue: any, itemIdx: number) => {
                                      const valString = itemValue !== null && itemValue !== undefined ? String(itemValue) : '';
                                      if (!valString) return null;
                                      const isChecked = value.includes(itemValue);
                                      return (
                                        <label key={`${valString}-${itemIdx}`} className="flex items-center gap-3 text-xs !text-white hover:text-[#C5A059] cursor-pointer select-none py-2 px-2 rounded-lg hover:bg-[#1a2435] transition-all">
                                          <div className={`w-[18px] h-[18px] rounded flex items-center justify-center border transition-all ${isChecked ? 'border-[#C5A059] bg-[#C5A059] shadow-[0_0_8px_rgba(197,160,89,0.5)]' : 'border-[#2a3a54] bg-[#0a0f18] shadow-inner'}`}>
                                            {isChecked && <svg className="w-3.5 h-3.5 text-[#0a0f18]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                          </div>
                                          <input type="checkbox" checked={isChecked} onChange={(e) => { let nextValue = [...value]; if (e.target.checked) nextValue.push(itemValue); else nextValue = nextValue.filter((v: any) => v !== itemValue); handleFilterValueChange(absoluteIndex, nextValue); }} className="hidden" />
                                          <span className={`truncate pt-0.5 transition-colors ${isChecked ? 'text-[#C5A059] font-bold' : ''}`}>{valString}</span>
                                        </label>
                                      );
                                    })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* 🚀 TOAST DE VOO ÚNICO (CENTRALIZAR APÓS FILTRO) */}
      {!topCenterDismissed && targetBounds && createPortal(
        <div className="fixed top-20 z-[99999] animate-fade-in" style={{ left: 'calc(50% + 140px)', transform: 'translateX(-50%)' }}>
          <div className="flex items-center bg-[#C5A059] rounded-full shadow-[0_15px_40px_rgba(197,160,89,0.5)] overflow-hidden border-2 border-[#dfb96f]">
            <div 
              onClick={handleTopCenterFly}
              role="button"
              className={`flex items-center gap-3 px-6 py-3 text-sm font-extrabold uppercase tracking-widest transition-all duration-300 group ${isFlying ? 'opacity-70 pointer-events-none cursor-wait' : 'hover:brightness-110 cursor-pointer'}`}
            >
              <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-[#0a0f18]/20 transition-colors">
                <svg style={{ color: '#0a0f18' }} className={`w-4 h-4 transition-transform ${isFlying ? 'animate-spin' : 'group-hover:scale-110'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isFlying ? ( <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /> ) : ( <> <circle cx="12" cy="12" r="3" strokeWidth="2.5" /> <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 2v3m0 14v3m10-10h-3M5 12H2" /> </> )}
                </svg>
              </div>
              <span style={{ color: '#0a0f18' }}>{isFlying ? "Centralizando..." : "Centralizar Filtro"}</span>
            </div>
            <div 
              onClick={() => setTopCenterDismissed(true)}
              className="px-3 py-3 border-l border-[#0a0f18]/20 hover:bg-[#0a0f18]/10 cursor-pointer transition-colors"
            >
              <CloseIcon />
            </div>
          </div>
        </div>,
        document.body
      )}

      {exportingDataset && (
        <DataExportModal dataset={exportingDataset} filters={filters} onClose={() => setExportingDataset(null)} />
      )}
    </aside>
  );
}