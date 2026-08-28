import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  convertBufferDistance,
  convertBufferDistanceText,
  parseBufferNumber,
  type BufferUnit,
} from "../../map-panel/buffer-api";

type BufferDialogProps = {
  busy: boolean;
  error: string | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    unit: BufferUnit;
    ranges: number[];
  }) => void;
};

const DEFAULT_UNIT: BufferUnit = "m";
const DEFAULT_RANGES = ["500"];
const MIN_RADIUS_METERS = 1;
const MAX_RADIUS_METERS = 200_000;
const MAX_RANGES = 4;

export default function BufferDialog({
  busy,
  error,
  open,
  onClose,
  onSubmit,
}: BufferDialogProps) {
  const [unit, setUnit] = useState<BufferUnit>(DEFAULT_UNIT);
  const [ranges, setRanges] = useState<string[]>([...DEFAULT_RANGES]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);

  busyRef.current = busy;
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    setUnit(DEFAULT_UNIT);
    setRanges([...DEFAULT_RANGES]);
    setValidationError(null);
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const animationFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(
          "select:not(:disabled), input:not(:disabled), button:not(:disabled)",
        )
        ?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), select:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
        ) || [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  const parsedRanges = useMemo(
    () => ranges.map((value) => parseBufferNumber(value)),
    [ranges],
  );

  if (!open) return null;

  function changeUnit(nextUnit: BufferUnit) {
    if (nextUnit === unit) return;

    const converted = ranges.map((value) =>
      convertBufferDistanceText(value, unit, nextUnit),
    );

    if (converted.some((value) => value === null)) {
      setValidationError(
        "Corrija os valores dos raios antes de alterar a unidade.",
      );
      return;
    }

    setRanges(converted as string[]);
    setUnit(nextUnit);
    setValidationError(null);
  }

  function updateRange(index: number, value: string) {
    setRanges((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
    setValidationError(null);
  }

  function addRange() {
    if (ranges.length >= MAX_RANGES) return;
    setRanges((current) => [...current, ""]);
    setValidationError(null);
  }

  function removeRange(index: number) {
    if (index === 0) return;
    setRanges((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    setValidationError(null);
  }

  function submit() {
    if (
      parsedRanges.some(
        (value) => value === null || !Number.isFinite(value) || value <= 0,
      )
    ) {
      setValidationError("Informe valores numéricos válidos para todos os raios.");
      return;
    }

    const numericRanges = parsedRanges as number[];
    const rangesMeters = numericRanges.map((value) =>
      convertBufferDistance(value, unit, "m"),
    );

    if (
      rangesMeters.some(
        (value) =>
          value < MIN_RADIUS_METERS || value > MAX_RADIUS_METERS,
      )
    ) {
      setValidationError(
        "Cada raio deve estar entre 1 metro e 200 quilômetros.",
      );
      return;
    }

    const uniqueMeters = new Set(
      rangesMeters.map((value) => value.toFixed(3)),
    );
    if (uniqueMeters.size !== rangesMeters.length) {
      setValidationError("Já existe um buffer com esse raio.");
      return;
    }

    if (numericRanges.length < 1 || numericRanges.length > MAX_RANGES) {
      setValidationError("Informe entre um e quatro raios.");
      return;
    }

    setValidationError(null);
    onSubmit({
      unit,
      ranges: numericRanges,
    });
  }

  const errorMessage = validationError || error;
  const unitLabel = unit === "m" ? "metros" : "quilômetros";

  return (
    <div
      className="maono-isochrone-dialog__backdrop maono-buffer-dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="maono-isochrone-dialog maono-buffer-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="maono-buffer-title"
        aria-describedby={errorMessage ? "maono-buffer-error" : undefined}
      >
        <header>
          <div>
            <span>Análise de proximidade</span>
            <h2 id="maono-buffer-title">Criar buffers</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar configuração de buffers"
          >
            ×
          </button>
        </header>

        <div className="maono-isochrone-dialog__body">
          <p className="maono-isochrone-dialog__hint">
            Defina um ou mais raios a partir da origem selecionada no mapa.
            A prévia não altera o projeto.
          </p>

          <label>
            <span>Unidade</span>
            <select
              value={unit}
              disabled={busy}
              onChange={(event) =>
                changeUnit(event.target.value as BufferUnit)
              }
              aria-label="Unidade dos raios do buffer"
            >
              <option value="m">Metros (m)</option>
              <option value="km">Quilômetros (km)</option>
            </select>
          </label>

          <fieldset disabled={busy}>
            <legend>Raios em {unitLabel}</legend>
            <div className="maono-isochrone-dialog__ranges maono-buffer-dialog__radii">
              {ranges.map((value, index) => (
                <div key={`${index}-${ranges.length}`}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={(event) => updateRange(index, event.target.value)}
                    aria-label={`Raio ${index + 1} em ${unitLabel}`}
                    placeholder={index === 0 ? "500" : "Informe o raio"}
                  />
                  {index > 0 ? (
                    <button
                      type="button"
                      onClick={() => removeRange(index)}
                      aria-label={`Remover raio ${index + 1}`}
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            {ranges.length < MAX_RANGES ? (
              <button
                type="button"
                className="maono-isochrone-dialog__add maono-buffer-dialog__add"
                onClick={addRange}
              >
                + Adicionar outro raio
              </button>
            ) : null}
          </fieldset>

          <p className="maono-isochrone-dialog__hint">
            Use vírgula ou ponto para valores decimais.
          </p>

          {errorMessage ? (
            <p
              id="maono-buffer-error"
              className="maono-isochrone-dialog__error maono-buffer-dialog__error"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer>
          <button
            type="button"
            className="is-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Gerando buffers…" : "Gerar buffers"}
          </button>
        </footer>
      </section>
    </div>
  );
}
