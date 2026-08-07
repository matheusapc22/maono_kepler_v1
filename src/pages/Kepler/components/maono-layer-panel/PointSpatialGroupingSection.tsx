import type { PointClusterLayerPolicy } from "../../clustering/point-cluster-policy";
import { usePointClusterController } from "../../clustering/point-cluster-controller-bridge";
import "./point-spatial-grouping.css";

const REASON_MESSAGES: Record<string, string> = {
  unsupported_layer: "Esta camada não contém uma geometria pontual compatível.",
  mixed_geometry: "O GeoJSON possui geometrias mistas ou não pôde ser validado.",
  missing_coordinates: "Defina campos válidos de latitude e longitude.",
  invalid_coordinates: "A camada possui coordenadas inválidas.",
  technical_read_only: "Esta camada está bloqueada para edição técnica.",
  temporal_animation: "Desative a animação temporal antes de agrupar.",
  below_minimum: "A camada precisa conter ao menos um ponto.",
  tile_required: "Acima de 300 mil pontos, publique os dados como MVT.",
};

function formatPointCount(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

type Props = {
  layerId: string;
  editable: boolean;
};

export default function PointSpatialGroupingSection({
  layerId,
  editable,
}: Props) {
  const controller = usePointClusterController();
  const item = controller?.layers.find(
    (candidate: { pointLayerId: string }) =>
      candidate.pointLayerId === layerId,
  );

  if (!controller?.featureEnabled || !item) {
    return null;
  }

  const policy = item.policy ?? {
    enabled: false,
    clusterMaxZoom: item.defaults.clusterMaxZoom,
    hysteresis: 0.25,
    clusterSize: item.defaults.clusterSize,
    showCount: true,
  };
  const settingsDisabled = !editable || !item.eligibility.eligible;

  function update(patch: Partial<PointClusterLayerPolicy>) {
    if (!editable || !item) return;

    controller?.updateLayerPolicy(
      item.pointLayerId,
      patch,
      item.eligibility.pointCount,
    );
  }

  return (
    <section
      className="maono-point-spatial-grouping"
      data-layer-id={layerId}
      aria-label="Agrupamento espacial"
    >
      <header>
        <div>
          <strong>Agrupamento espacial</strong>
          <small>
            {formatPointCount(item.eligibility.pointCount)} pontos · alternância interna por zoom
          </small>
        </div>
        <label className="maono-point-spatial-grouping__switch">
          <input
            type="checkbox"
            checked={policy.enabled}
            disabled={settingsDisabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          <span aria-hidden="true" />
          <em>{policy.enabled ? "Ativo" : "Inativo"}</em>
        </label>
      </header>

      <p className="maono-point-spatial-grouping__description">
        Os agrupamentos são uma representação interna da mesma camada. A
        visibilidade, a ordem e o estilo lógico permanecem únicos no painel.
      </p>

      {!editable ? (
        <p className="maono-point-spatial-grouping__notice">
          Modo de visualização: as configurações permanecem somente leitura.
        </p>
      ) : !item.eligibility.eligible ? (
        <p
          className="maono-point-spatial-grouping__notice is-warning"
          role="status"
        >
          {REASON_MESSAGES[item.eligibility.reason] ??
            "Esta camada não pode ser agrupada no momento."}
        </p>
      ) : policy.enabled ? (
        <div className="maono-point-spatial-grouping__grid">
          <label>
            <span>Exibir pontos a partir do zoom</span>
            <input
              type="number"
              min="0"
              max="24"
              step="0.25"
              value={policy.clusterMaxZoom}
              onChange={(event) =>
                update({ clusterMaxZoom: event.target.valueAsNumber })
              }
            />
          </label>

          <label>
            <span>Tamanho do agrupamento</span>
            <input
              type="number"
              min="1"
              max="500"
              step="1"
              value={policy.clusterSize}
              onChange={(event) =>
                update({ clusterSize: event.target.valueAsNumber })
              }
            />
          </label>

          <label>
            <span>Histerese do zoom</span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.05"
              value={policy.hysteresis}
              onChange={(event) =>
                update({ hysteresis: event.target.valueAsNumber })
              }
            />
          </label>

          <label className="maono-point-spatial-grouping__checkbox">
            <input
              type="checkbox"
              checked={policy.showCount}
              onChange={(event) =>
                update({ showCount: event.target.checked })
              }
            />
            Mostrar quantidade nos agrupamentos
          </label>
        </div>
      ) : null}
    </section>
  );
}
