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

function normalizeLongitude(value, boundaryPreference = null) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;

  if (Math.abs(normalized + 180) < 1e-10) {
    if (boundaryPreference === 180 || boundaryPreference === -180) {
      return boundaryPreference;
    }
    return value >= 0 ? 180 : -180;
  }

  return normalized;
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
    radiansToDegrees(longitude2),
    radiansToDegrees(latitude2),
  ];
}

function closeLinearRing(coordinates) {
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (!first) return coordinates;
  if (!last || first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push([...first]);
  }
  return coordinates;
}

function removeConsecutiveDuplicates(coordinates) {
  const output = [];
  for (const position of coordinates) {
    const previous = output[output.length - 1];
    if (
      !previous ||
      previous[0] !== position[0] ||
      previous[1] !== position[1]
    ) {
      output.push(position);
    }
  }
  return output;
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

function unwrapRing(coordinates) {
  if (!coordinates.length) return [];
  const output = [[coordinates[0][0], coordinates[0][1]]];
  let previousLongitude = coordinates[0][0];

  for (let index = 1; index < coordinates.length; index += 1) {
    let longitude = coordinates[index][0];
    const latitude = coordinates[index][1];

    while (longitude - previousLongitude > 180) longitude -= 360;
    while (longitude - previousLongitude < -180) longitude += 360;

    output.push([longitude, latitude]);
    previousLongitude = longitude;
  }

  closeLinearRing(output);
  return output;
}

function longitudeIntersection(start, end, boundary) {
  const deltaLongitude = end[0] - start[0];
  if (Math.abs(deltaLongitude) < Number.EPSILON) {
    return [boundary, start[1]];
  }

  const ratio = (boundary - start[0]) / deltaLongitude;
  return [
    boundary,
    start[1] + (end[1] - start[1]) * ratio,
  ];
}

function clipRingByLongitude(ring, boundary, keepLessOrEqual) {
  const vertices = ring.slice(0, -1);
  if (!vertices.length) return [];
  const inside = (position) =>
    keepLessOrEqual
      ? position[0] <= boundary
      : position[0] >= boundary;
  const output = [];
  let previous = vertices[vertices.length - 1];
  let previousInside = inside(previous);

  for (const current of vertices) {
    const currentInside = inside(current);

    if (currentInside) {
      if (!previousInside) {
        output.push(longitudeIntersection(previous, current, boundary));
      }
      output.push([...current]);
    } else if (previousInside) {
      output.push(longitudeIntersection(previous, current, boundary));
    }

    previous = current;
    previousInside = currentInside;
  }

  return closeLinearRing(removeConsecutiveDuplicates(output));
}

function normalizeRing(
  ring,
  longitudeShift = 0,
  boundaryPreference = null,
) {
  const normalized = removeConsecutiveDuplicates(
    ring.map(([longitude, latitude]) => [
      roundCoordinate(
        normalizeLongitude(longitude + longitudeShift, boundaryPreference),
      ),
      roundCoordinate(latitude),
    ]),
  );
  closeLinearRing(normalized);
  validateGeneratedRing(normalized);
  return normalized;
}

function polygonFromRing(ring) {
  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

function multiPolygonFromRings(rings) {
  return {
    type: "MultiPolygon",
    coordinates: rings.map((ring) => [ring]),
  };
}

function assertPolarCapSupported(origin, radiusMeters) {
  const angularRadiusDegrees = radiansToDegrees(
    radiusMeters / EARTH_MEAN_RADIUS_METERS,
  );
  if (Math.abs(origin.latitude) + angularRadiusDegrees >= 90) {
    throw createBufferError(
      "Buffers que envolvem um dos polos ainda não são suportados nesta versão.",
      422,
      "BUFFER_POLAR_CAP_UNSUPPORTED",
      { radiusMeters },
    );
  }
}

function buildRadialGeometry(origin, radiusMeters, options = {}) {
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

  assertPolarCapSupported(origin, radiusMeters);

  const rawRing = [];
  for (let index = 0; index < totalSegments; index += 1) {
    const bearing = (index / totalSegments) * Math.PI * 2;
    rawRing.push(destinationPoint(origin, radiusMeters, bearing));
  }
  const unwrapped = unwrapRing(rawRing);
  const longitudes = unwrapped.map((position) => position[0]);
  const minimum = Math.min(...longitudes);
  const maximum = Math.max(...longitudes);

  if (maximum <= 180 && minimum >= -180) {
    return {
      geometry: polygonFromRing(normalizeRing(unwrapped)),
      antimeridianSplit: false,
    };
  }

  if (maximum > 180 && minimum < -180) {
    throw createBufferError(
      "A geometria cruza mais de um limite longitudinal suportado.",
      422,
      "BUFFER_GEOMETRY_SPAN_UNSUPPORTED",
      { radiusMeters },
    );
  }

  let primary;
  let wrapped;

  if (maximum > 180) {
    primary = clipRingByLongitude(unwrapped, 180, true);
    wrapped = clipRingByLongitude(unwrapped, 180, false);
    return {
      geometry: multiPolygonFromRings([
        normalizeRing(primary, 0, 180),
        normalizeRing(wrapped, -360, -180),
      ]),
      antimeridianSplit: true,
    };
  }

  primary = clipRingByLongitude(unwrapped, -180, false);
  wrapped = clipRingByLongitude(unwrapped, -180, true);
  return {
    geometry: multiPolygonFromRings([
      normalizeRing(primary, 0, -180),
      normalizeRing(wrapped, 360, 180),
    ]),
    antimeridianSplit: true,
  };
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
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
  let antimeridianSplitCount = 0;

  const features = [...ranges]
    .reverse()
    .map(({ radiusMeters, inputValue, sequence }) => {
      const built = buildRadialGeometry(input.origin, radiusMeters, {
        segmentsPerQuadrant,
      });
      if (built.antimeridianSplit) antimeridianSplitCount += 1;

      return {
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
        geometry: built.geometry,
      };
    });

  return {
    geojson: {
      type: "FeatureCollection",
      features,
    },
    engineMetadata: {
      engine: "maono-radial-geodesic-v2",
      segmentsPerQuadrant,
      totalSegments: segmentsPerQuadrant * 4,
      antimeridianSplitCount,
    },
  };
}
