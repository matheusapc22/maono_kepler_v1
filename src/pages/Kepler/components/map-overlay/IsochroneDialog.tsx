import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  IsochroneMode,
  IsochroneType,
} from "../../map-panel/isochrone-api";

type IsochroneDialogProps = {
  busy: boolean;
  error: string | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    type: IsochroneType;
    mode: IsochroneMode;
    ranges: number[];
  }) => void;
};

const DEFAULT_RANGES: Record<IsochroneType, string[]> = {
  time: ["10", "20", "30"],
  distance: ["1", "2", "3"],
};

export default function IsochroneDialog({
  busy,
  error,
  open,
  onClose,
  onSubmit,
}: IsochroneDialogProps) {
  const [type, setType] = useState<IsochroneType>("time");
  const [mode, setMode] =
    useState<IsochroneMode>("drive_traffic");
  const [ranges, setRanges] = useState<string[]>([
    ...DEFAULT_RANGES.time,
  ]);
  const [validationError, setValidationError] =
    useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);

  busyRef.current = busy;
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setValidationError(null);

    const animationFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(
          "button:not(:disabled), select:not(:disabled), input:not(:disabled)",
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
      } else if (
        event.shiftKey &&
        document.activeElement === first
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
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

  const unit = type === "time" ? "minutos" : "quilômetros";
  const maximum = type === "time" ? 240 : 100;
  const minimum = type === "time" ? 1 : 0.1;
  const parsedRanges = useMemo(
    () => ranges.map((value) => Number(value)),
    [ranges],
  );

  if (!open) return null;

  function changeType(nextType: IsochroneType) {
    setType(nextType);
    setRanges([...DEFAULT_RANGES[nextType]]);
    setValidationError(null);
  }

  function submit() {
    if (
      parsedRanges.some(
        (value) => !Number.isFinite(value) || value < minimum,
      )
    ) {
      setValidationError(
        `Todos os intervalos devem ser números maiores ou iguais a ${minimum}.`,
      );
      return;
    }

    const unique = [...new Set(parsedRanges)].sort(
      (left, right) => left - right,
    );

    if (unique.length < 1 || unique.length > 4) {
      setValidationError(
        "Informe entre um e quatro intervalos válidos.",
      );
      return;
    }

    if (unique.some((value) => value > maximum)) {
      setValidationError(
        `Cada intervalo deve ser menor ou igual a ${maximum} ${unit}.`,
      );
      return;
    }

    setValidationError(null);
    onSubmit({ type, mode, ranges: unique });
  }

  const errorMessage = validationError || error;

  return (
    <div
      className="maono-isochrone-dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="maono-isochrone-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="maono-isochrone-title"
        aria-describedby={
          errorMessage ? "maono-isochrone-error" : undefined
        }
      >
        <header>
          <div>
            <span>Análise de acessibilidade</span>
            <h2 id="maono-isochrone-title">Criar isócronas</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar configuração de isócronas"
          >
            ×
          </button>
        </header>

        <div className="maono-isochrone-dialog__body">
          <p className="maono-isochrone-dialog__hint">
            A prévia só será persistida depois da sua confirmação.
          </p>

          <fieldset disabled={busy}>
            <legend>Método de geração</legend>
            <div className="maono-isochrone-dialog__segmented">
              <button
                type="button"
                className={type === "time" ? "is-active" : ""}
                aria-pressed={type === "time"}
                onClick={() => changeType("time")}
              >
                Tempo
              </button>
              <button
                type="button"
                className={
                  type === "distance" ? "is-active" : ""
                }
                aria-pressed={type === "distance"}
                onClick={() => changeType("distance")}
              >
                Distância
              </button>
            </div>
          </fieldset>

          <label>
            <span>Modalidade</span>
            <select
              value={mode}
              disabled={busy}
              onChange={(event) =>
                setMode(event.target.value as IsochroneMode)
              }
            >
              <option value="drive_traffic">
                Carro com trânsito
              </option>
              <option value="drive">Carro</option>
              <option value="bicycle">Bicicleta</option>
              <option value="walk">Caminhada</option>
            </select>
          </label>

          <fieldset disabled={busy}>
            <legend>Intervalos em {unit}</legend>
            <div className="maono-isochrone-dialog__ranges">
              {ranges.map((value, index) => (
                <div key={`${index}-${ranges.length}`}>
                  <input
                    type="number"
                    min={minimum}
                    max={maximum}
                    step={type === "time" ? "1" : "0.1"}
                    value={value}
                    onChange={(event) => {
                      const next = [...ranges];
                      next[index] = event.target.value;
                      setRanges(next);
                      setValidationError(null);
                    }}
                    aria-label={`Intervalo ${index + 1} em ${unit}`}
                  />
                  {ranges.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setRanges((current) =>
                          current.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        )
                      }
                      aria-label={`Remover intervalo ${index + 1}`}
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {ranges.length < 4 ? (
              <button
                type="button"
                className="maono-isochrone-dialog__add"
                onClick={() =>
                  setRanges((current) => [...current, ""])
                }
              >
                + Adicionar intervalo
              </button>
            ) : null}
          </fieldset>

          {errorMessage ? (
            <p
              id="maono-isochrone-error"
              className="maono-isochrone-dialog__error"
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
            {busy ? "Gerando análise..." : "Gerar prévia"}
          </button>
        </footer>
      </section>
    </div>
  );
}
