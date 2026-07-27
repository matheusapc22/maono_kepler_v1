// @ts-nocheck

import { useId, useState } from "react";
import type { PointClusterLayerPolicy } from "../clustering/point-cluster-policy.ts";
import "./point-cluster-settings-panel.css";

const REASON_MESSAGES = {
  unsupported_layer: "Apenas camadas Point e GeoJSON Point são elegíveis.",
  mixed_geometry: "O GeoJSON possui geometrias mistas ou não pôde ser validado.",
  missing_coordinates: "Defina campos válidos de latitude e longitude.",
  invalid_coordinates: "A camada possui coordenadas inválidas.",
  technical_read_only: "Esta camada está bloqueada para edição técnica.",
  temporal_animation: "Desative a animação temporal antes de agrupar.",
  below_minimum: "O agrupamento é liberado a partir de 250 pontos.",
  tile_required: "Acima de 300 mil pontos, publique como MVT.",
};

function formatPointCount(value) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export default function PointClusterSettingsPanel({
  controller,
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (!controller.featureEnabled) {
    return null;
  }

  function update(
    item,
    patch: Partial<PointClusterLayerPolicy>,
  ) {
    controller.updateLayerPolicy(
      item.pointLayerId,
      patch,
      item.eligibility.pointCount,
    );
  }

  return (
    <div className="maono-point-cluster-settings">
      <button
        type="button"
        className="maono-point-cluster-settings__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        Agrupar pontos
      </button>

      {open && (
        <section
          id={panelId}
          className="maono-point-cluster-settings__panel"
          aria-label="Configurações de agrupamento de pontos"
        >
          <header className="maono-point-cluster-settings__header">
            <div>
              <h2>Agrupamento por zoom</h2>
              <p>
                Mostra bolhas no zoom baixo e pontos individuais no zoom alto.
              </p>
            </div>
            <button
              type="button"
              aria-label="Fechar configurações de agrupamento"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="maono-point-cluster-settings__content">
            {controller.layers.length === 0 && (
              <p className="maono-point-cluster-settings__empty">
                Nenhuma camada de pontos disponível.
              </p>
            )}

            {controller.layers.map((item) => {
              const policy = item.policy ?? {
                enabled: false,
                clusterMaxZoom:
                  item.defaults.clusterMaxZoom,
                hysteresis: 0.25,
                clusterSize: item.defaults.clusterSize,
                showCount: true,
              };
              const disabled = !item.eligibility.eligible;

              return (
                <fieldset
                  key={item.pointLayerId}
                  className="maono-point-cluster-settings__layer"
                >
                  <legend>{item.label}</legend>
                  <p className="maono-point-cluster-settings__meta">
                    {formatPointCount(
                      item.eligibility.pointCount,
                    )}{" "}
                    pontos ·{" "}
                    {item.eligibility.delivery === "safe"
                      ? "processamento local"
                      : item.eligibility.delivery === "warn"
                        ? "medir desempenho"
                        : "MVT necessário"}
                  </p>

                  <label className="maono-point-cluster-settings__toggle">
                    <input
                      type="checkbox"
                      checked={policy.enabled}
                      disabled={disabled}
                      onChange={(event) =>
                        update(item, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                    Ativar nesta camada
                  </label>

                  {disabled ? (
                    <p
                      className="maono-point-cluster-settings__warning"
                      role="status"
                    >
                      {REASON_MESSAGES[
                        item.eligibility.reason
                      ] ?? "Esta camada não é elegível."}
                    </p>
                  ) : (
                    <div className="maono-point-cluster-settings__grid">
                      <label>
                        Trocar para pontos no zoom
                        <input
                          type="number"
                          min="0"
                          max="24"
                          step="0.25"
                          value={policy.clusterMaxZoom}
                          disabled={!policy.enabled}
                          onChange={(event) =>
                            update(item, {
                              clusterMaxZoom:
                                event.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                      <label>
                        Tamanho do agrupamento
                        <input
                          type="number"
                          min="1"
                          max="500"
                          step="1"
                          value={policy.clusterSize}
                          disabled={!policy.enabled}
                          onChange={(event) =>
                            update(item, {
                              clusterSize:
                                event.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                      <label>
                        Histerese do zoom
                        <input
                          type="number"
                          min="0"
                          max="2"
                          step="0.05"
                          value={policy.hysteresis}
                          disabled={!policy.enabled}
                          onChange={(event) =>
                            update(item, {
                              hysteresis:
                                event.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                      <label className="maono-point-cluster-settings__toggle">
                        <input
                          type="checkbox"
                          checked={policy.showCount}
                          disabled={!policy.enabled}
                          onChange={(event) =>
                            update(item, {
                              showCount: event.target.checked,
                            })
                          }
                        />
                        Mostrar quantidade nas bolhas
                      </label>
                    </div>
                  )}
                </fieldset>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
