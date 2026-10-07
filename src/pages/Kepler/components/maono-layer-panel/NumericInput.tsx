import { useEffect, useState } from "react";

import {
  clampNumericValue,
  normalizeNumericDraft,
  parseNumericDraft,
  stepNumericValue,
} from "./numeric-control.ts";

type Props = {
  id?: string;
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
};

/** Shares the parent's numeric preview; only unfinished text stays local. */
export default function NumericInput({
  id,
  label,
  value,
  minimum,
  maximum,
  step,
  onPreview,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState<{ text: string; preview: number } | null>(null);
  useEffect(() => {
    setDraft(current => current && !Object.is(current.preview, value) ? null : current);
  }, [value]);
  // An external change (slider, reset, undo) supersedes a previous text draft.
  const text = draft && Object.is(draft.preview, value) ? draft.text : String(value);

  function commit() {
    if (!draft || !Object.is(draft.preview, value)) return;
    const next = normalizeNumericDraft(text, value, minimum, maximum);
    setDraft(null);
    onPreview(next);
    onCommit(next);
  }

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      aria-label={label}
      min={minimum}
      max={maximum}
      step={step}
      value={text}
      onChange={(event) => {
        const nextText = event.target.value;
        const parsed = parseNumericDraft(nextText);
        const preview = parsed === null
          ? value
          : clampNumericValue(parsed, minimum, maximum);
        setDraft({ text: nextText, preview });
        if (parsed !== null) onPreview(preview);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          const current = normalizeNumericDraft(text, value, minimum, maximum);
          const next = stepNumericValue(current, event.key === "ArrowUp" ? 1 : -1, step, minimum, maximum);
          setDraft({ text: String(next), preview: next });
          onPreview(next);
          return;
        }
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        // Blur is the single commit path, so Enter never submits or saves.
        event.currentTarget.blur();
      }}
    />
  );
}
