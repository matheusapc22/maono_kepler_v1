import type {
  BufferFeatureCollection,
  BufferResult,
  BufferUnit,
} from "../../../map-panel/buffer-api";
import type { MapToolPoint } from "./map-tool-state";

export type BufferSessionItem = {
  id: string;
  origin: MapToolPoint;
  inputUnit: BufferUnit;
  ranges: number[];
  rangesMeters: number[];
  featureIds: string[];
};

export type BufferSession = {
  id: string;
  dataId: string;
  items: BufferSessionItem[];
  geojson: BufferFeatureCollection;
};

export type AppendBufferSessionInput = {
  origin: MapToolPoint;
  result: BufferResult;
};

function safeSessionToken(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96);
}

export function bufferSessionDataId(sessionId: string) {
  const token = safeSessionToken(sessionId.trim());
  if (!token) throw new Error("Buffer session id is required.");
  return `maono_analysis_buffer_${token}`;
}

export function createBufferSession(
  sessionId: string,
  dataId = bufferSessionDataId(sessionId),
): BufferSession {
  if (!sessionId.trim()) throw new Error("Buffer session id is required.");
  if (!dataId.trim()) throw new Error("Buffer session dataId is required.");

  return {
    id: sessionId,
    dataId,
    items: [],
    geojson: {
      type: "FeatureCollection",
      features: [],
    },
  };
}

function cloneFeature(feature: Record<string, unknown>) {
  return {
    ...feature,
    properties: {
      ...((feature.properties && typeof feature.properties === "object"
        ? feature.properties
        : {}) as Record<string, unknown>),
    },
  };
}

export function appendBufferSessionResult(
  session: BufferSession,
  input: AppendBufferSessionInput,
): BufferSession {
  const itemIndex = session.items.length + 1;
  const itemId = `${session.id}:item:${itemIndex}`;
  const featureIds: string[] = [];

  const nextFeatures = input.result.geojson.features.map((sourceFeature, index) => {
    const feature = cloneFeature(sourceFeature);
    const featureId = `${itemId}:feature:${index + 1}`;
    featureIds.push(featureId);

    const properties = feature.properties as Record<string, unknown>;
    const radiusMeters = Number(properties.radius_m);

    return {
      ...feature,
      id: featureId,
      properties: {
        ...properties,
        maono_buffer_session_id: session.id,
        maono_buffer_item_id: itemId,
        maono_buffer_feature_id: featureId,
        origin_longitude: input.origin.longitude,
        origin_latitude: input.origin.latitude,
        radius_m: radiusMeters,
      },
    };
  });

  const item: BufferSessionItem = {
    id: itemId,
    origin: { ...input.origin },
    inputUnit: input.result.metadata.inputUnit,
    ranges: [...input.result.metadata.ranges],
    rangesMeters: [...input.result.metadata.rangesMeters],
    featureIds,
  };

  return {
    ...session,
    items: [...session.items, item],
    geojson: {
      type: "FeatureCollection",
      features: [...session.geojson.features, ...nextFeatures],
    },
  };
}

export function bufferSessionFeatureCount(session: BufferSession) {
  return session.geojson.features.length;
}

export function bufferSessionOriginCount(session: BufferSession) {
  return session.items.length;
}

export function bufferSessionRadiusCount(session: BufferSession) {
  return session.items.reduce(
    (total, item) => total + item.rangesMeters.length,
    0,
  );
}
