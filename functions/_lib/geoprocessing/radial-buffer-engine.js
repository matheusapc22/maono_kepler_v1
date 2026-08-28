import { createBufferError } from "./buffer-contract.js";

export const EARTH_MEAN_RADIUS_METERS = 6_371_008.8;
export const DEFAULT_SEGMENTS_PER_QUADRANT = 16;
export const COORDINATE_PRECISION = 7;

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}

function roundCoordinate(value) {
  return Number(value.toFixed(COORDINATE_PRECISION));
}

function normalizeLongitude(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function destinationPoint(origin, distanceMeters, bearingRadians) {
  const latitude1 = degreesToRadians(origin.latitude);
  const longitude1 = degreesToRadians(origin.longitude);
  const angularDistance = distanceMeters / EARTH_MEAN_RADIUS_METERS;

  const sinLatitude1 = Math.sin(latitude1);
  const cosLatitude1 = Math.cos(latitude1);
  const sinAngularDistance = Math.sin(angularDistance);
  const cosAngularDistance = Math.cos(angularDistance);

  const latitude2 = Math.asin(
    sinLatitude1 * cosAngularDistance +
      cosLatitude1 * sinAngularDistance * Math.cos(bearingRadians),
  );
  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(bearingRadians) * sinAngularDistance * cosLatitude1,
      cosAngularDistance - sinLatitude1 * Math.sin(latitude2),
    );

  return [
    roundCoordinate(normalizeLongitude(radiansToDegrees(longitude2))),
    roundCoordinate(radiansToDegrees(latitude2)),
  ];
}

function crossesAntimeridian(coordinates) {
  for (let index = 1; index < coordinates.length; index += 1) {
    if (Math.abs(coordinates[index][0] - coordinates[index - 1][0]) > 180) {
      return true;
    }
  }
  return false;
}

function closeLinearRing(coordinates) {
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (!last || first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push([...first]);
  }
  return coordinates;
}

function validateGeneratedRing(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 4) {
    throw createBufferError(
      "Não foi possível gerar a geometria do buffer.",
      500,
      "BUFFER_GEOMETRY_INVALID",
    );
  }

  for (const position of coordinates) {
    if (
      !Array.isArray(position) ||
      position.length < 2 ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1]) ||
      position[0] < -180 ||
      position[0] > 180 ||
      position[1] < -90 ||
      position[1] > 90
    ) {
      throw createBufferError(
        "O motor gerou uma coordenada inválida.",
        500,
        "BUFFER_GEOMETRY_INVALID",
      );
    }
  }

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw createBufferError(
      "O anel do buffer não foi fechado corretamente.",
      500,
      "BUFFER_GEOMETRY_INVALID",
    );
  }
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function buildRadialPolygon(origin, radiusMeters, options = {}) {
  const segmentsPerQuadrant = Number.isInteger(options.segmentsPerQuadrant)
    ? options.segmentsPerQuadrant
    : DEFAULT_SEGMENTS_PER_QUADRANT;
  const totalSegments = segmentsPerQuadrant * 4;

  if (segmentsPerQuadrant < 4 || segmentsPerQuadrant > 64) {
    throw createBufferError(
      "A resolução geométrica solicitada é inválida.",
      500,
      "BUFFER_ENGINE_CONFIGURATION_INVALID",
    );
  }

  const ring = [];
  for (let index = 0; index < totalSegments; index += 1) {
    const bearing = (index / totalSegments) * Math.PI * 2;
    ring.push(destinationPoint(origin, radiusMeters, bearing));
  }
  closeLinearRing(ring);
  validateGeneratedRing(ring);

  if (crossesAntimeridian(ring)) {
    throw createBufferError(
      "Buffers que cruzam o antimeridiano ainda não são suportados nesta versão.",
      422,
      "BUFFER_ANTIMERIDIAN_UNSUPPORTED",
      { radiusMeters },
    );
  }

  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

export function executeRadialBuffer(input, options = {}) {
  const segmentsPerQuadrant = Number.isInteger(options.segmentsPerQuadrant)
    ? options.segmentsPerQuadrant
    : DEFAULT_SEGMENTS_PER_QUADRANT;
  const ranges = input.rangesMeters.map((radiusMeters, index) => ({
    radiusMeters,
    inputValue: input.ranges[index],
    sequence: index + 1,
  }));

  const features = [...ranges]
    .reverse()
    .map(({ radiusMeters, inputValue, sequence }) => ({
      type: "Feature",
      properties: {
        maono_analysis: "radial_buffer",
        analysis_label: "Buffer radial",
        source: "pin",
        sequence,
        radius_m: radiusMeters,
        radius_label: `${formatNumber(inputValue)} ${input.inputUnit}`,
        input_unit: input.inputUnit,
        origin_latitude: input.origin.latitude,
        origin_longitude: input.origin.longitude,
      },
      geometry: buildRadialPolygon(input.origin, radiusMeters, {
        segmentsPerQuadrant,
      }),
    }));

  return {
    geojson: {
      type: "FeatureCollection",
      features,
    },
    engineMetadata: {
      engine: "maono-radial-geodesic-v1",
      segmentsPerQuadrant,
      totalSegments: segmentsPerQuadrant * 4,
    },
  };
}
