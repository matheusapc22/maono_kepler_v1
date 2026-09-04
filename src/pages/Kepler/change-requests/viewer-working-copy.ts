export type ViewerChangeOperation = {
  id: string;
  type: string;
  version: number;
  payload: unknown;
  createdAt: string;
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

function validatePointCreate(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  const source = payload as Record<string, unknown>;
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

export const viewerOperationRegistry: Readonly<Record<string, OperationRegistryEntry>> =
  Object.freeze({
    "point.create": Object.freeze({ version: 1, validate: validatePointCreate }),
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
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
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

export const indexedDbWorkingCopyStorage: ViewerWorkingCopyStorage = {
  async get(key) {
    const db = await openWorkingCopyDb();
    try {
      const value = await requestResult(
        db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
      );
      return value ? clone(value as ViewerWorkingCopy) : null;
    } finally {
      db.close();
    }
  },

  async put(value) {
    const db = await openWorkingCopyDb();
    try {
      await requestResult(
        db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(clone(value)),
      );
    } finally {
      db.close();
    }
  },

  async delete(key) {
    const db = await openWorkingCopyDb();
    try {
      await requestResult(
        db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key),
      );
    } finally {
      db.close();
    }
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

export class ViewerWorkingCopyStore {
  readonly key: string;
  private readonly identity: ReturnType<typeof normalizeIdentity>;

  constructor(
    identity: ViewerWorkingCopyIdentity,
    private readonly storage: ViewerWorkingCopyStorage = indexedDbWorkingCopyStorage,
  ) {
    this.identity = normalizeIdentity(identity);
    this.key = workingCopyKey(identity);
  }

  async load() {
    return this.storage.get(this.key);
  }

  async ensure(baseRevision: number): Promise<ViewerWorkingCopy> {
    const existing = await this.load();
    if (existing) return existing;
    if (!Number.isInteger(baseRevision) || baseRevision < 0) {
      throw new Error("WORKING_COPY_BASE_REVISION_INVALID");
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

  async appendOperation(
    baseRevision: number,
    operation: ViewerChangeOperation,
  ): Promise<ViewerWorkingCopy> {
    validateOperation(operation);
    const current = await this.ensure(baseRevision);
    if (current.operations.some((item) => item.id === operation.id)) {
      throw new Error("WORKING_COPY_OPERATION_ID_DUPLICATED");
    }
    const next = {
      ...current,
      operations: [...current.operations, clone(operation)],
      updatedAt: new Date().toISOString(),
    };
    await this.storage.put(next);
    return clone(next);
  }

  async removeOperation(operationId: string): Promise<ViewerWorkingCopy | null> {
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

  async snapshot(): Promise<ViewerWorkingCopy | null> {
    const current = await this.load();
    return current ? clone(current) : null;
  }

  async clear() {
    await this.storage.delete(this.key);
  }

  async assertCurrentRevision(currentRevision: number) {
    const current = await this.load();
    if (!current) return null;
    if (current.baseRevision !== Number(currentRevision)) {
      const error = new Error("WORKING_COPY_BASE_REVISION_STALE");
      Object.assign(error, {
        code: "WORKING_COPY_BASE_REVISION_STALE",
        baseRevision: current.baseRevision,
        currentRevision: Number(currentRevision),
      });
      throw error;
    }
    return clone(current);
  }
}
