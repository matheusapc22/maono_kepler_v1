import {
  useEffect,
  useMemo,
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
  const [ranges, setRanges] = useState<string[]>(
    DEFAULT_RANGES.time,
  );
  const [validationError, setValidationError] =
    useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setType("time");
    setMode("drive_traffic");
    setRanges(DEFAULT_RANGES.time);
    setValidationError(null);
  }, [open]);

  const unit = type === "time" ? "minutos" : "quilômetros";
  const maximum = type === "time" ? 240 : 100;
  const normalizedRanges = useMemo(
    () =>
      ranges
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    [ranges],
  );

  if (!open) return null;

  function changeType(nextType: IsochroneType) {
    setType(nextType);
    setRanges(DEFAULT_RANGES[nextType]);
    setValidationError(null);
  }

  function submit() {
    const unique = [...new Set(normalizedRanges)].sort(
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
        className="maono-isochrone-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="maono-isochrone-title"
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
          <fieldset>
            <legend>Método de geração</legend>
            <div className="maono-isochrone-dialog__segmented">
              <button
                type="button"
                className={type === "time" ? "is-active" : ""}
                onClick={() => changeType("time")}
              >
                Tempo
              </button>
              <button
                type="button"
                className={
                  type === "distance" ? "is-active" : ""
                }
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

          <fieldset>
            <legend>Intervalos em {unit}</legend>
            <div className="maono-isochrone-dialog__ranges">
              {ranges.map((value, index) => (
                <div key={`${index}-${ranges.length}`}>
                  <input
                    type="number"
                    min="1"
                    max={maximum}
                    step={type === "time" ? "1" : "0.1"}
                    value={value}
                    onChange={(event) => {
                      const next = [...ranges];
                      next[index] = event.target.value;
                      setRanges(next);
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

          {validationError || error ? (
            <p className="maono-isochrone-dialog__error" role="alert">
              {validationError || error}
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
