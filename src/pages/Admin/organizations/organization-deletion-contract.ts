export const DELETION_CONFIRMATION = 'EXCLUIR PERMANENTEMENTE';

export type DeletionBlockerAction = {
  kind: 'pause' | 'query' | 'follow' | 'review'; enabled: boolean; reason?: string | null;
  organizationId: number; operationId?: string; itemIndex?: number; deletionId?: string;
  expectedVersion?: number | null; waitUntil?: string | null;
};
export type DeletionBlocker = {
  code: string; count: number; key?: string; organizationId?: number; description?: string;
  operationId?: string; itemIndex?: number; deletionId?: string; resourceType?: string;
  action?: DeletionBlockerAction;
};

export type DeletionPreview = {
  organizationId: number;
  name: string;
  version: number;
  eligible: boolean;
  blockers: DeletionBlocker[];
  confirmation: string;
  waitUntil?: string | null;
};

export function isDeletionBlocker(value: unknown): value is DeletionBlocker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const blocker = value as Partial<DeletionBlocker>;
  if (typeof blocker.code !== 'string' || !blocker.code || blocker.code.length > 120 || !Number.isSafeInteger(blocker.count) || Number(blocker.count) < 0) return false;
  if (blocker.description !== undefined && (typeof blocker.description !== 'string' || blocker.description.length > 1600)) return false;
  if (blocker.action !== undefined) {
    const action = blocker.action;
    if (!action || !['pause', 'query', 'follow', 'review'].includes(action.kind) || typeof action.enabled !== 'boolean' || !Number.isSafeInteger(action.organizationId) || action.organizationId < 1) return false;
    if (action.reason != null && (typeof action.reason !== 'string' || action.reason.length > 1600)) return false;
    if (action.expectedVersion != null && (!Number.isSafeInteger(action.expectedVersion) || action.expectedVersion < 0)) return false;
    if (action.itemIndex != null && (!Number.isSafeInteger(action.itemIndex) || action.itemIndex < 0)) return false;
    if ([action.operationId, action.deletionId].some(id => id !== undefined && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)))) return false;
  }
  return true;
}

/** A prepared destination must still belong to the requested organization. */
export function isDeletionPreview(value: unknown, organizationId: number): value is DeletionPreview {
  if (!value || typeof value !== 'object') return false;
  const preview = value as Partial<DeletionPreview>;
  return preview.organizationId === organizationId
    && typeof preview.name === 'string'
    && typeof preview.version === 'number'
    && Number.isSafeInteger(preview.version)
    && preview.version >= 0
    && typeof preview.eligible === 'boolean'
    && preview.confirmation === DELETION_CONFIRMATION
    && Array.isArray(preview.blockers)
    && preview.blockers.every(blocker => isDeletionBlocker(blocker) && (!blocker.action || blocker.action.organizationId === organizationId))
    && preview.eligible === (preview.blockers.length === 0);
}
