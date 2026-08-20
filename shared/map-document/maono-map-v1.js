import {
  MAP_DOCUMENT_ENGINE_KEPLER,
  MAP_DOCUMENT_SCHEMA_MAONO,
  MAP_DOCUMENT_SCHEMA_MAONO_VERSION,
} from "./constants.js";
import { validateMaonoMapV1 } from "./validate-document.js";

export function createMaonoMapDocumentV1({
  map,
  datasets,
  layers,
  filters,
  analyses = [],
  engine,
  extensions = {},
}) {
  const document = {
    schema: MAP_DOCUMENT_SCHEMA_MAONO,
    version: MAP_DOCUMENT_SCHEMA_MAONO_VERSION,
    map,
    datasets,
    layers,
    filters,
    analyses,
    engine: {
      type: engine?.type ?? MAP_DOCUMENT_ENGINE_KEPLER,
      payload: engine?.payload,
    },
    extensions,
  };
  validateMaonoMapV1(document);
  return document;
}
