export type MapDocumentKind =
  | "legacy-kepler@1"
  | "maono-map@1"
  | "future"
  | "invalid";

export interface MapDocumentDetection {
  kind: MapDocumentKind;
  schemaName: string | null;
  schemaVersion: number | null;
  supported: boolean;
  reasonCode: string | null;
}

export interface MaonoMapDatasetRefV1 {
  id: string;
  engineDataId?: unknown;
  label?: string;
}

export interface MaonoMapLayerRefV1 {
  id: string;
  engineLayerId?: string;
  engineDataId?: unknown;
  type?: string | null;
  label?: string;
  visible?: boolean;
}

export interface MaonoMapFilterRefV1 {
  id: string;
  engineFilterId?: string;
  dataId?: unknown;
  name?: unknown;
  type?: string | null;
  enabled?: boolean;
}

export interface MaonoMapDocumentV1 {
  schema: "maono-map";
  version: 1;
  map: Record<string, unknown>;
  datasets: MaonoMapDatasetRefV1[];
  layers: MaonoMapLayerRefV1[];
  filters: MaonoMapFilterRefV1[];
  analyses: unknown[];
  engine: {
    type: "kepler";
    payload: Record<string, unknown>;
  };
  extensions: Record<string, unknown>;
}

export class MapDocumentValidationError extends Error {
  code: string;
  path: string;
  details: unknown;
}

export function detectSchema(document: unknown): MapDocumentDetection;
export function validateDocument(
  document: unknown,
  options?: { expectedSchemaName?: string | null; expectedSchemaVersion?: number | null },
): { kind: MapDocumentKind; schemaName: string; schemaVersion: number };
export function validateLegacyKeplerV1(document: unknown): unknown;
export function validateMaonoMapV1(document: unknown): unknown;
export function canonicalSerialize(document: unknown): string;
export function canonicalSerializeBytes(document: unknown): { text: string; bytes: Uint8Array };
export function legacyKeplerToMaonoMapV1(document: unknown): MaonoMapDocumentV1;
export function toLegacyKeplerDocument(document: unknown): Record<string, unknown>;
export function toMaonoMapDocumentV1(document: unknown): MaonoMapDocumentV1;
