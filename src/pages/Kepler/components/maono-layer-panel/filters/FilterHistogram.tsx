import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import {
  histogramValueToRatio,
} from "../../../engine-adapter/histogram-strategies.ts";
import type { MapHistogramAxisScale, MapSmartHistogram } from "../../../engine-adapter/histogram-types.ts";

import {
  clampHistogramRange,
  dragHistogramRange,
  keyboardHistogramRange,
  type HistogramDragMode,
  type HistogramRange as Range,
} from "./histogram-range.ts";

type Props = {
  histogram: MapSmartHistogram;
  selectedRange: Range | null;
  editable: boolean;
  step: number;
  onRangeChange: (range: Range) => void;
  onRangeCommit: (range: Range) => void;
};

type DragState = {
  mode: HistogramDragMode;
  pointerId: number;
  startRange: Range;
  startClientX: number;
  plotWidth: number;
  domain: Range;
  scale: MapHistogramAxisScale;
  step: number;
};

function strategyLabel(histogram: MapSmartHistogram) {
  switch (histogram.strategy) {
    case "freedman-diaconis":
      return "Auto · FD";
    case "sturges":
      return "Auto · Sturges";
    case "sqrt":
      return "Auto · √n";
    case "calendar":
      return "Auto · tempo";
    case "native":
      return "Kepler";
    default:
      return "Auto";
  }
}

function valueLabel(value: number, temporal: boolean) {
  if (temporal) {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  }

  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(value);
}

export default function FilterHistogram({
  histogram,
  selectedRange,
  editable,
  step,
  onRangeChange,
  onRangeCommit,
}: Props) {
  const plotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const currentRangeRef = useRef<Range | null>(selectedRange);
  const [dragging, setDragging] = useState<HistogramDragMode | null>(null);
  const domain = histogram.displayDomain ?? histogram.originalDomain;
  const maximum = Math.max(1, ...histogram.bins.map((bin) => bin.count));
  const temporal = histogram.axisScale === "time";

  useEffect(() => {
    if (!dragRef.current) currentRangeRef.current = selectedRange;
  }, [selectedRange]);

  useEffect(() => {
    const plot = plotRef.current;
    return () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag && plot?.hasPointerCapture(drag.pointerId)) {
        plot.releasePointerCapture(drag.pointerId);
      }
    };
  }, []);

  useEffect(() => {
    const drag = dragRef.current;
    if (!drag || (editable && selectedRange && domain?.[0] === drag.domain[0] && domain?.[1] === drag.domain[1] && histogram.axisScale === drag.scale)) return;
    dragRef.current = null;
    setDragging(null);
    if (plotRef.current?.hasPointerCapture(drag.pointerId)) {
      plotRef.current.releasePointerCapture(drag.pointerId);
    }
  }, [editable, selectedRange, domain, histogram.axisScale]);

  if (!domain || !selectedRange) {
    return (
      <div className="maono-filter-histogram is-empty" role="status">
        <span>Distribuição indisponível para este filtro.</span>
      </div>
    );
  }

  const activeDomain: Range = domain;
  const safeRange = clampHistogramRange(selectedRange, activeDomain);
  const minimumRatio = histogramValueToRatio(
    safeRange[0],
    activeDomain,
    histogram.axisScale,
  );
  const maximumRatio = histogramValueToRatio(
    safeRange[1],
    activeDomain,
    histogram.axisScale,
  );
  const selectionLeft = Math.min(minimumRatio, maximumRatio) * 100;
  const selectionWidth = Math.max(0, maximumRatio - minimumRatio) * 100;

  function beginDrag(mode: HistogramDragMode, event: ReactPointerEvent<HTMLElement>) {
    const plot = plotRef.current;
    const rect = plot?.getBoundingClientRect();
    if (!editable || event.button !== 0 || event.isPrimary === false || dragRef.current || !plot || !rect || rect.width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    plot.setPointerCapture(event.pointerId);
    const range = clampHistogramRange(currentRangeRef.current ?? safeRange, activeDomain);
    currentRangeRef.current = range;
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startRange: range,
      startClientX: event.clientX,
      plotWidth: rect.width,
      domain: activeDomain,
      scale: histogram.axisScale,
      step,
    };
    setDragging(mode);
  }

  function publishRange(next: Range) {
    const previous = currentRangeRef.current;
    currentRangeRef.current = next;
    if (!previous || next[0] !== previous[0] || next[1] !== previous[1]) onRangeChange(next);
  }

  function updateDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    publishRange(dragHistogramRange(
      drag.startRange,
      drag.mode,
      (event.clientX - drag.startClientX) / drag.plotWidth,
      drag.domain,
      drag.scale,
      drag.step,
    ));
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Cancellation/lost capture have no reliable coordinates. Keep the latest
    // live value; pointerup also includes its final position without a move event.
    if (event.type === "pointerup") updateDrag(event);
    event.stopPropagation();
    const next = currentRangeRef.current ?? drag.startRange;
    dragRef.current = null;
    setDragging(null);
    if (plotRef.current?.hasPointerCapture(event.pointerId)) {
      plotRef.current.releasePointerCapture(event.pointerId);
    }
    onRangeCommit(next);
  }

  function keyboardHandle(mode: HistogramDragMode, event: ReactKeyboardEvent<HTMLElement>) {
    if (!editable || dragRef.current) return;
    const next = keyboardHistogramRange(currentRangeRef.current ?? safeRange, mode, event.key, activeDomain, histogram.axisScale, step);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    publishRange(next);
    onRangeCommit(next);
  }

  return (
    <div className="maono-filter-histogram" aria-label="Histograma inteligente do filtro">
      <header className="maono-filter-histogram__meta">
        <span>
          {strategyLabel(histogram)} · {histogram.bins.length} faixas
          {histogram.axisScale === "log-shifted" ? " · escala log" : ""}
        </span>
        <span>
          {histogram.quality === "sampled" && histogram.sampleSize
            ? `Amostra · ${histogram.sampleSize.toLocaleString("pt-BR")}`
            : `${histogram.observedCount.toLocaleString("pt-BR")} valores`}
        </span>
      </header>

      <div
        ref={plotRef}
        className="maono-filter-histogram__plot"
        data-dragging={dragging ?? undefined}
        onPointerMove={updateDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
      >
        <div
          className="maono-filter-histogram__bars"
          role="img"
          aria-label={`Distribuição em ${histogram.bins.length} intervalos`}
        >
          {histogram.bins.length ? (
            histogram.bins.map((bin, index) => {
              const selected =
                bin.end >= safeRange[0] && bin.start <= safeRange[1];
              const height =
                bin.count <= 0
                  ? 0
                  : Math.max(3, (bin.count / maximum) * 100);

              return (
                <span
                  key={`${bin.start}-${bin.end}-${index}`}
                  className={selected ? "is-selected" : ""}
                  style={{ height: `${height}%` }}
                  title={`${valueLabel(bin.start, temporal)} – ${valueLabel(bin.end, temporal)} · ${bin.count.toLocaleString("pt-BR")} registros`}
                />
              );
            })
          ) : (
            <em>Nenhum valor após os demais filtros.</em>
          )}
        </div>

        <div
          className="maono-filter-histogram__selection"
          style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
          onPointerDown={(event) => beginDrag("window", event)}
          title="Arraste para mover o intervalo sem alterar sua largura visual"
          role="slider"
          tabIndex={editable ? 0 : -1}
          aria-disabled={!editable}
          aria-label="Intervalo selecionado do filtro"
          aria-valuemin={activeDomain[0]}
          aria-valuemax={activeDomain[1]}
          aria-valuenow={safeRange[0]}
          aria-valuetext={`${valueLabel(safeRange[0], temporal)} a ${valueLabel(safeRange[1], temporal)}`}
          onKeyDown={(event) => keyboardHandle("window", event)}
        />

        <button
          type="button"
          className="maono-filter-histogram__handle is-minimum"
          style={{ left: `${selectionLeft}%` }}
          disabled={!editable}
          role="slider"
          aria-label="Limite mínimo do filtro"
          aria-valuemin={activeDomain[0]}
          aria-valuemax={safeRange[1]}
          aria-valuenow={safeRange[0]}
          onPointerDown={(event) => beginDrag("minimum", event)}
          onKeyDown={(event) => keyboardHandle("minimum", event)}
        />
        <button
          type="button"
          className="maono-filter-histogram__handle is-maximum"
          style={{ left: `${selectionLeft + selectionWidth}%` }}
          disabled={!editable}
          role="slider"
          aria-label="Limite máximo do filtro"
          aria-valuemin={safeRange[0]}
          aria-valuemax={activeDomain[1]}
          aria-valuenow={safeRange[1]}
          onPointerDown={(event) => beginDrag("maximum", event)}
          onKeyDown={(event) => keyboardHandle("maximum", event)}
        />
      </div>

      <footer className="maono-filter-histogram__axis">
        <span>{valueLabel(activeDomain[0], temporal)}</span>
        <span>{valueLabel(activeDomain[1], temporal)}</span>
      </footer>

      {histogram.source === "kepler-native" && histogram.fallbackReason ? (
        <small className="maono-filter-histogram__fallback">
          Distribuição de compatibilidade · {histogram.fallbackReason}
        </small>
      ) : null}
    </div>
  );
}
