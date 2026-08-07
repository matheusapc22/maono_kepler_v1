import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

import {
  histogramRatioToValue,
  histogramValueToRatio,
} from "../../../engine-adapter/histogram-strategies.ts";
import type { MapSmartHistogram } from "../../../engine-adapter/histogram-types.ts";

type Range = [number, number];

type Props = {
  histogram: MapSmartHistogram;
  selectedRange: Range | null;
  editable: boolean;
  step: number;
  onRangeChange: (range: Range) => void;
  onRangeCommit: (range: Range) => void;
};

type DragMode = "minimum" | "maximum" | "window";

type DragState = {
  mode: DragMode;
  pointerId: number;
  startX: number;
  startRange: Range;
  startPointerValue: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

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
  const domain = histogram.displayDomain ?? histogram.originalDomain;
  const maximum = Math.max(1, ...histogram.bins.map((bin) => bin.count));
  const temporal = histogram.axisScale === "time";

  useEffect(() => {
    currentRangeRef.current = selectedRange;
  }, [selectedRange?.[0], selectedRange?.[1]]);

  if (!domain || !selectedRange) {
    return (
      <div className="maono-filter-histogram is-empty" role="status">
        <span>Distribuição indisponível para este filtro.</span>
      </div>
    );
  }

  const safeRange: Range = [
    clamp(selectedRange[0], domain[0], domain[1]),
    clamp(selectedRange[1], domain[0], domain[1]),
  ];
  const minimumRatio = histogramValueToRatio(
    safeRange[0],
    domain,
    histogram.axisScale,
  );
  const maximumRatio = histogramValueToRatio(
    safeRange[1],
    domain,
    histogram.axisScale,
  );
  const selectionLeft = Math.min(minimumRatio, maximumRatio) * 100;
  const selectionWidth = Math.max(0, maximumRatio - minimumRatio) * 100;

  function ratioAt(clientX: number) {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }

  function valueAt(clientX: number) {
    return histogramRatioToValue(
      ratioAt(clientX),
      domain as Range,
      histogram.axisScale,
    );
  }

  function snapped(value: number) {
    const safeStep = Number.isFinite(step) && step > 0 ? step : (domain![1] - domain![0]) / 1000;
    const steps = Math.round((value - domain![0]) / safeStep);
    return clamp(domain![0] + steps * safeStep, domain![0], domain![1]);
  }

  function beginDrag(
    mode: DragMode,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();

    const range = currentRangeRef.current ?? safeRange;
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startRange: [...range] as Range,
      startPointerValue: valueAt(event.clientX),
    };
    plotRef.current?.setPointerCapture(event.pointerId);
  }

  function updateDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const pointerValue = valueAt(event.clientX);
    let next: Range;

    if (drag.mode === "minimum") {
      const minimum = Math.min(snapped(pointerValue), drag.startRange[1]);
      next = [minimum, drag.startRange[1]];
    } else if (drag.mode === "maximum") {
      const maximumValue = Math.max(snapped(pointerValue), drag.startRange[0]);
      next = [drag.startRange[0], maximumValue];
    } else {
      const amplitude = drag.startRange[1] - drag.startRange[0];
      const delta = pointerValue - drag.startPointerValue;
      let minimum = drag.startRange[0] + delta;
      let maximumValue = drag.startRange[1] + delta;

      if (minimum < domain[0]) {
        minimum = domain[0];
        maximumValue = minimum + amplitude;
      }
      if (maximumValue > domain[1]) {
        maximumValue = domain[1];
        minimum = maximumValue - amplitude;
      }
      next = [minimum, maximumValue];
    }

    currentRangeRef.current = next;
    onRangeChange(next);
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const next = currentRangeRef.current ?? drag.startRange;
    dragRef.current = null;
    if (plotRef.current?.hasPointerCapture(event.pointerId)) {
      plotRef.current.releasePointerCapture(event.pointerId);
    }
    onRangeCommit(next);
  }

  function keyboardHandle(mode: "minimum" | "maximum", delta: number) {
    if (!editable) return;
    const range = currentRangeRef.current ?? safeRange;
    const safeStep = Number.isFinite(step) && step > 0 ? step : (domain[1] - domain[0]) / 1000;
    const next: Range =
      mode === "minimum"
        ? [clamp(range[0] + delta * safeStep, domain[0], range[1]), range[1]]
        : [range[0], clamp(range[1] + delta * safeStep, range[0], domain[1])];
    currentRangeRef.current = next;
    onRangeChange(next);
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
        onPointerMove={updateDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div className="maono-filter-histogram__bars" role="img" aria-label={`Distribuição em ${histogram.bins.length} intervalos`}>
          {histogram.bins.length ? (
            histogram.bins.map((bin, index) => {
              const selected =
                bin.end >= safeRange[0] && bin.start <= safeRange[1];
              const height = bin.count <= 0 ? 0 : Math.max(3, (bin.count / maximum) * 100);

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
          title="Arraste para mover o intervalo sem alterar sua amplitude"
          aria-hidden="true"
        />

        <button
          type="button"
          className="maono-filter-histogram__handle is-minimum"
          style={{ left: `${selectionLeft}%` }}
          disabled={!editable}
          role="slider"
          aria-label="Limite mínimo do filtro"
          aria-valuemin={domain[0]}
          aria-valuemax={safeRange[1]}
          aria-valuenow={safeRange[0]}
          onPointerDown={(event) => beginDrag("minimum", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") keyboardHandle("minimum", -1);
            if (event.key === "ArrowRight") keyboardHandle("minimum", 1);
          }}
        />
        <button
          type="button"
          className="maono-filter-histogram__handle is-maximum"
          style={{ left: `${selectionLeft + selectionWidth}%` }}
          disabled={!editable}
          role="slider"
          aria-label="Limite máximo do filtro"
          aria-valuemin={safeRange[0]}
          aria-valuemax={domain[1]}
          aria-valuenow={safeRange[1]}
          onPointerDown={(event) => beginDrag("maximum", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") keyboardHandle("maximum", -1);
            if (event.key === "ArrowRight") keyboardHandle("maximum", 1);
          }}
        />
      </div>

      <footer className="maono-filter-histogram__axis">
        <span>{valueLabel(domain[0], temporal)}</span>
        <span>{valueLabel(domain[1], temporal)}</span>
      </footer>

      {histogram.source === "kepler-native" && histogram.fallbackReason ? (
        <small className="maono-filter-histogram__fallback">
          Distribuição de compatibilidade · {histogram.fallbackReason}
        </small>
      ) : null}
    </div>
  );
}
