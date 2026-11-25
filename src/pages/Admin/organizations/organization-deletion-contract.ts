export const DELETION_CONFIRMATION = 'EXCLUIR PERMANENTEMENTE';

export type DeletionPreview = {
  organizationId: number;
  name: string;
  version: number;
  eligible: boolean;
  blockers: {code: string; count: number}[];
  confirmation: string;
};

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
    && preview.blockers.every(blocker => blocker
      && typeof blocker.code === 'string'
      && blocker.code.length > 0
      && Number.isSafeInteger(blocker.count)
      && blocker.count >= 0)
    && preview.eligible === (preview.blockers.length === 0);
}
