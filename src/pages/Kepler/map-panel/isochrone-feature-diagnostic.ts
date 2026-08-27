export const ISOCHRONE_FEATURE_REASON = Object.freeze({
  ENABLED: "ENABLED",
  OVERLAY_DISABLED: "OVERLAY_DISABLED",
  KILL_SWITCH_ACTIVE: "KILL_SWITCH_ACTIVE",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  UNKNOWN: "UNKNOWN",
} as const);

export type IsochroneFeatureReason =
  (typeof ISOCHRONE_FEATURE_REASON)[keyof typeof ISOCHRONE_FEATURE_REASON];

export type IsochroneFeatureState = {
  enabled: boolean;
  reason: IsochroneFeatureReason;
};

const VALID_REASONS = new Set<IsochroneFeatureReason>(
  Object.values(ISOCHRONE_FEATURE_REASON),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeIsochroneFeatureState(
  value: unknown,
  fallbackEnabled = false,
): IsochroneFeatureState {
  if (isRecord(value)) {
    const rawReason =
      typeof value.reason === "string" ? value.reason.trim() : "";
    const reason = VALID_REASONS.has(rawReason as IsochroneFeatureReason)
      ? (rawReason as IsochroneFeatureReason)
      : ISOCHRONE_FEATURE_REASON.UNKNOWN;
    const enabled = value.enabled === true;

    if (enabled && reason !== ISOCHRONE_FEATURE_REASON.ENABLED) {
      return {
        enabled: true,
        reason: ISOCHRONE_FEATURE_REASON.ENABLED,
      };
    }

    return { enabled, reason };
  }

  return fallbackEnabled
    ? {
        enabled: true,
        reason: ISOCHRONE_FEATURE_REASON.ENABLED,
      }
    : {
        enabled: false,
        reason: ISOCHRONE_FEATURE_REASON.UNKNOWN,
      };
}

export function describeIsochroneAvailability(
  state: IsochroneFeatureState | null | undefined,
  capabilityEnabled: boolean,
) {
  if (capabilityEnabled) {
    return "Inserir marcador para análise";
  }

  switch (state?.reason) {
    case ISOCHRONE_FEATURE_REASON.PROVIDER_NOT_CONFIGURED:
      return "Isócronas indisponíveis: provedor não configurado.";
    case ISOCHRONE_FEATURE_REASON.KILL_SWITCH_ACTIVE:
      return "Isócronas temporariamente desativadas.";
    case ISOCHRONE_FEATURE_REASON.OVERLAY_DISABLED:
      return "Isócronas indisponíveis: overlay do mapa desativado.";
    case ISOCHRONE_FEATURE_REASON.ENABLED:
      return "Isócronas indisponíveis para este modo ou permissão.";
    default:
      return "Isócronas indisponíveis neste ambiente.";
  }
}