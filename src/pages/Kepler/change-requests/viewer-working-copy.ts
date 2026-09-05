export type ViewerChangeOperation = {
  id: string;
  type: string;
  version: number;
  payload: unknown;
  createdAt: string;
};

export type ViewerLayerStyleChanges = Partial<{
  fixedColor: [number, number, number];
  opacity: number;
  fillEnabled: boolean;
  strokeEnabled: boolean;
  strokeColor: [number, number, number];
  strokeOpacity: number;
  strokeWidth: number;
  pointRadius: number;
  clusterRadius: number;
  heatmapRadius: number;
}>;

export type ViewerLayerStyleUpdatePayload = {
  targetLayerId: string;
  targetDataId: string | null;
  targetLabel: string;
  changes: ViewerLayerStyleChanges;
};

export type ViewerWorkingCopy = {
  key: string;
  organizationId: string;
  projectId: string;
  projectSlug: string;
  userId: string;
  baseRevision: number;
  submissionKey: string;
  operations: ViewerChangeOperation[];
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
};

export type ViewerWorkingCopyIdentity = {
  organizationId: string | number;
  projectId: string | number;
  projectSlug: string;
  userId: string | number;
};

export interface ViewerWorkingCopyStorage {
  get(key: string): Promise<ViewerWorkingCopy | null>;
  put(value: ViewerWorkingCopy): Promise<void>;
  delete(key: string): Promise<void>;
}

type OperationRegistryEntry = {
  version: number;
  validate(payload: unknown): void;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function validRgb(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((channel) => {
      const number = Number(channel);
      return Number.isFinite(number) && number >= 0 && number <= 255;
    })
  );
}

function validBoundedNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}

function validatePointCreate(payload: unknown) {
  const source = record(payload);
  if (!source) throw new Error("WORKING_COPY_OPERATION_INVALID");
  const latitude = Number(source.latitude);
  const longitude = Number(source.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

function validateLayerStyleUpdate(payload: unknown) {
  const source = record(payload);
  const changes = record(source?.changes);
  if (!source || !text(source.targetLayerId) || !changes || !Object.keys(changes).length) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }

  const allowed = new Set([
    "fixedColor",
    "opacity",
    "fillEnabled",
    "strokeEnabled",
    "strokeColor",
    "strokeOpacity",
    "strokeWidth",
    "pointRadius",
    "clusterRadius",
    "heatmapRadius",
  ]);
  if (Object.keys(changes).some((key) => !allowed.has(key))) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  if ("fixedColor" in changes && !validRgb(changes.fixedColor)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  if ("strokeColor" in changes && !validRgb(changes.strokeColor)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  for (const key of ["opacity", "strokeOpacity"] as const) {
    if (key in changes && !validBoundedNumber(changes[key], 0, 1)) {
      throw new Error("WORKING_COPY_OPERATION_INVALID");
    }
  }
  for (const key of ["strokeWidth", "pointRadius", "clusterRadius", "heatmapRadius"] as const) {
    if (key in changes && !validBoundedNumber(changes[key], 0, 500)) {
      throw new Error("WORKING_COPY_OPERATION_INVALID");
    }
  }
  for (const key of ["fillEnabled", "strokeEnabled"] as const) {
    if (key in changes && typeof changes[key] !== "boolean") {
      throw new Error("WORKING_COPY_OPERATION_INVALID");
    }
  }
}

export const viewerOperationRegistry: Readonly<Record<string, OperationRegistryEntry>> =
  Object.freeze({
    "point.create": Object.freeze({ version: 1, validate: validatePointCreate }),
    "layer.style.update": Object.freeze({
      version: 1,
      validate: validateLayerStyleUpdate,
    }),
  });

const DB_NAME = "maono-map-workspace";
const DB_VERSION = 1;
const STORE_NAME = "viewerWorkingCopies";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function openWorkingCopyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("WORKING_COPY_INDEXEDDB_UNAVAILABLE"));
      return;
    }
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("WORKING_COPY_INDEXEDDB_OPEN_FAILED"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("WORKING_COPY_INDEXEDDB_REQUEST_FAILED"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openWorkingCopyDb();
  try {
    return await requestResult(action(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)));
  } finally {
    db.close();
  }
}

export const indexedDbWorkingCopyStorage: ViewerWorkingCopyStorage = {
  async get(key) {
    const value = await withStore("readonly", (store) => store.get(key));
    return value ? clone(value as ViewerWorkingCopy) : null;
  },
  async put(value) {
    await withStore("readwrite", (store) => store.put(clone(value)));
  },
  async delete(key) {
    await withStore("readwrite", (store) => store.delete(key));
  },
};

function normalizeIdentity(identity: ViewerWorkingCopyIdentity) {
  return {
    organizationId: String(identity.organizationId),
    projectId: String(identity.projectId),
    projectSlug: String(identity.projectSlug),
    userId: String(identity.userId),
  };
}

function workingCopyKey(identity: ViewerWorkingCopyIdentity) {
  const value = normalizeIdentity(identity);
  return `${value.organizationId}:${value.projectId}:${value.userId}`;
}

function validateOperation(operation: ViewerChangeOperation) {
  const entry = viewerOperationRegistry[operation.type];
  if (!entry) throw new Error("WORKING_COPY_OPERATION_UNSUPPORTED");
  if (operation.version !== entry.version) {
    throw new Error("WORKING_COPY_OPERATION_VERSION_UNSUPPORTED");
  }
  entry.validate(operation.payload);
}

function pointPayload(operation: ViewerChangeOperation) {
  if (operation.type !== "point.create") return null;
  return record(operation.payload);
}

function temporaryPointTarget(
  current: ViewerWorkingCopy,
  operation: ViewerChangeOperation,
): ViewerChangeOperation {
  const payload = pointPayload(operation);
  if (!payload) return clone(operation);

  const currentLayerId = text(payload.targetLayerId);
  const currentDataId = text(payload.targetDataId);
  if (currentLayerId || currentDataId) return clone(operation);

  const targetLabel = text(payload.targetLabel) || "Pontos adicionados";
  const existingTarget = current.operations
    .map(pointPayload)
    .find((candidate) => {
      if (!candidate || candidate.targetMode !== "new") return false;
      return (
        text(candidate.targetLayerId) &&
        text(candidate.targetDataId) &&
        text(candidate.targetLabel) === targetLabel
      );
    });

  const groupId = crypto.randomUUID();
  const targetLayerId = text(existingTarget?.targetLayerId) || `tmp_layer_${groupId}`;
  const targetDataId = text(existingTarget?.targetDataId) || `tmp_data_${groupId}`;

  return {
    ...clone(operation),
    payload: {
      ...clone(payload),
      targetLayerId,
      targetDataId,
      targetLabel,
      targetMode: "new",
    },
  };
}

function assertBaseRevision(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("WORKING_COPY_BASE_REVISION_INVALID");
  }
}

function staleError(baseRevision: number, currentRevision: number) {
  return Object.assign(new Error("WORKING_COPY_BASE_REVISION_STALE"), {
    code: "WORKING_COPY_BASE_REVISION_STALE",
    baseRevision,
    currentRevision,
  });
}

export class ViewerWorkingCopyStore {
  readonly key: string;
  private readonly identity: ReturnType<typeof normalizeIdentity>;
  private readonly storage: ViewerWorkingCopyStorage;

  constructor(
    identity: ViewerWorkingCopyIdentity,
    storage: ViewerWorkingCopyStorage = indexedDbWorkingCopyStorage,
  ) {
    this.identity = normalizeIdentity(identity);
    this.storage = storage;
    this.key = workingCopyKey(identity);
  }

  load() {
    return this.storage.get(this.key);
  }

  async ensure(baseRevision: number): Promise<ViewerWorkingCopy> {
    assertBaseRevision(baseRevision);
    const existing = await this.load();
    if (existing) {
      if (existing.baseRevision !== baseRevision) {
        throw staleError(existing.baseRevision, baseRevision);
      }
      return existing;
    }
    const now = new Date().toISOString();
    const value: ViewerWorkingCopy = {
      key: this.key,
      ...this.identity,
      baseRevision,
      submissionKey: crypto.randomUUID(),
      operations: [],
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.put(value);
    return clone(value);
  }

  async appendOperation(baseRevision: number, operation: ViewerChangeOperation) {
    validateOperation(operation);
    const current = await this.ensure(baseRevision);
    if (current.operations.some((item) => item.id === operation.id)) {
      throw new Error("WORKING_COPY_OPERATION_ID_DUPLICATED");
    }
    const normalizedOperation = temporaryPointTarget(current, operation);
    validateOperation(normalizedOperation);
    const next = {
      ...current,
      operations: [...current.operations, normalizedOperation],
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put(next);
    return clone(next);
  }

  async upsertLayerStyleOperation(
    baseRevision: number,
    payload: ViewerLayerStyleUpdatePayload,
  ) {
    const current = await this.ensure(baseRevision);
    const layerId = text(payload.targetLayerId);
    if (!layerId) throw new Error("WORKING_COPY_OPERATION_INVALID");
    const existingIndex = current.operations.findIndex((operation) => {
      const source = record(operation.payload);
      return operation.type === "layer.style.update" && text(source?.targetLayerId) === layerId;
    });
    const changes = record(payload.changes) || {};

    let operations = [...current.operations];
    if (!Object.keys(changes).length) {
      if (existingIndex < 0) return clone(current);
      operations.splice(existingIndex, 1);
    } else {
      const existing = existingIndex >= 0 ? operations[existingIndex] : null;
      const operation: ViewerChangeOperation = {
        id: existing?.id || `op_${crypto.randomUUID()}`,
        type: "layer.style.update",
        version: 1,
        payload: clone(payload),
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
      validateOperation(operation);
      if (existingIndex >= 0) operations[existingIndex] = operation;
      else operations.push(operation);
    }

    const next = {
      ...current,
      operations,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put(next);
    return clone(next);
  }

  async removeOperation(operationId: string) {
    const current = await this.load();
    if (!current) return null;
    const next = {
      ...current,
      operations: current.operations.filter((item) => item.id !== operationId),
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put(next);
    return clone(next);
  }

  async completeSubmission(operationIds: string[]) {
    const current = await this.load();
    if (!current) return null;
    const submitted = new Set(operationIds.map(String));
    const operations = current.operations.filter((item) => !submitted.has(item.id));
    if (operations.length === current.operations.length) {
      return clone(current);
    }
    if (operations.length === 0) {
      await this.clear();
      return null;
    }
    const next = {
      ...current,
      operations,
      submissionKey: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put(next);
    return clone(next);
  }

  async snapshot() {
    const current = await this.load();
    return current ? clone(current) : null;
  }

  clear() {
    return this.storage.delete(this.key);
  }

  async assertCurrentRevision(currentRevision: number) {
    assertBaseRevision(Number(currentRevision));
    const current = await this.load();
    if (!current) return null;
    if (current.baseRevision !== Number(currentRevision)) {
      throw staleError(current.baseRevision, Number(currentRevision));
    }
    return clone(current);
  }
}
