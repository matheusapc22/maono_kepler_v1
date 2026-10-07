import { useEffect, useId, useState } from "react";

import NumericInput from "./NumericInput";
import { normalizeNumericDraft, numericRangeStep, snapNumericSliderValue, stepNumericValue } from "./numeric-control.ts";
import "./slider-number-control.css";

type Props = {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  suffix?: string;
  onCommit: (value: number) => void;
};

export default function SliderNumberControl({
  label,
  value,
  minimum,
  maximum,
  step,
  suffix,
  onCommit,
}: Props) {
  const inputId = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  function commit(next = draft) {
    if (!Object.is(next, value)) onCommit(next);
  }

  return (
    <div className="maono-style-range">
      <span>
        <label htmlFor={inputId}>{label}</label>
        <span className="maono-style-range__value">
          <NumericInput
            id={inputId}
            label={suffix === "%" ? `${label} em porcentagem` : `${label}${suffix ? ` em ${suffix.trim()}` : ""}`}
            value={draft}
            minimum={minimum}
            maximum={maximum}
            step={step}
            onPreview={setDraft}
            onCommit={commit}
          />
          {suffix ? <span aria-hidden="true">{suffix.trim()}</span> : null}
        </span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={minimum}
        max={maximum}
        step={numericRangeStep(draft, minimum, step)}
        value={draft}
        onChange={(event) => {
          const next = normalizeNumericDraft(event.target.value, draft, minimum, maximum);
          setDraft(snapNumericSliderValue(next, minimum, maximum, step));
        }}
        onKeyDown={(event) => {
          if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            const direction = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : -1;
            setDraft(stepNumericValue(draft, direction, step, minimum, maximum));
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            setDraft(event.key === "Home" ? minimum : maximum);
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
          }
        }}
        onPointerUp={(event) => commit(normalizeNumericDraft(event.currentTarget.value, draft, minimum, maximum))}
        onTouchEnd={(event) => commit(normalizeNumericDraft(event.currentTarget.value, draft, minimum, maximum))}
        onKeyUp={() => commit()}
        onBlur={() => commit()}
      />
    </div>
  );
}
