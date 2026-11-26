import type {Detail, Plan} from './organizations-types.ts';

export type OrganizationDraftSection = 'general' | 'people' | 'policy';
export type OrganizationDraftValues = {
  name: string;
  description: string;
  owner: string;
  plan: Plan;
  customLimit: boolean;
  limit: string;
};
export type OrganizationDraftConfirmation = {receipt: number; item: Record<string, unknown>};
export type OrganizationDraftState = {
  organizationId: number;
  baseline: OrganizationDraftValues;
  values: OrganizationDraftValues;
  reasons: Record<OrganizationDraftSection, string>;
  acknowledged: number;
};

const valueKeys = ['name', 'description', 'owner', 'plan', 'customLimit', 'limit'] as const;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const planValue = (value: unknown): value is Plan => value === 'free' || value === 'pro' || value === 'enterprise';

/** Validate the server fields consumed by the editor before replacing its last valid detail. */
export function isOrganizationDraftDetail(value: unknown, expectedId: number): value is Detail {
  if (!record(value) || !record(value.organization) || !record(value.policy)) return false;
  const org = value.organization, policy = value.policy;
  return org.id === expectedId && integer(org.id, 1) && integer(org.version) &&
    ['name', 'description', 'slug', 'storageStatus'].every(key => typeof org[key] === 'string') &&
    typeof org.active === 'boolean' && planValue(org.plan) &&
    (org.owner === null || (record(org.owner) && integer(org.owner.id, 1))) &&
    policy.plan === org.plan && integer(policy.projects) &&
    (policy.projectOverride === null || integer(policy.projectOverride, 1)) &&
    typeof policy.projectQuotaEnforced === 'boolean' &&
    ['used', 'reserved', 'remaining', 'storageUsedMb', 'storageMb'].every(key => typeof policy[key] === 'number' && Number.isFinite(policy[key]));
}

function serverValues(detail: Detail): OrganizationDraftValues {
  return {
    name: detail.organization.name,
    description: detail.organization.description,
    owner: String(detail.organization.owner?.id || ''),
    plan: detail.organization.plan,
    customLimit: detail.policy.projectOverride !== null,
    limit: String(detail.policy.projectOverride ?? detail.policy.projects),
  };
}

export function createOrganizationDraft(detail: Detail): OrganizationDraftState {
  const baseline = serverValues(detail);
  return {organizationId: detail.organization.id, baseline, values: {...baseline}, reasons: {general: '', people: '', policy: ''}, acknowledged: 0};
}

// Text uses the management API's trim rule. Invalid numeric input stays distinct from a valid limit.
function comparable(key: keyof OrganizationDraftValues, value: OrganizationDraftValues[keyof OrganizationDraftValues]) {
  if (key === 'name' || key === 'description') return String(value).trim();
  if (key === 'limit') {
    const raw = String(value).trim(), numeric = Number(raw);
    return raw !== '' && Number.isSafeInteger(numeric) && numeric >= 1 ? numeric : `invalid:${raw}`;
  }
  return value;
}

export function organizationDraftIsDirty(state: OrganizationDraftState): boolean {
  return valueKeys.some(key => {
    if (key === 'limit' && !state.values.customLimit) return false;
    return comparable(key, state.values[key]) !== comparable(key, state.baseline[key]);
  }) || Object.values(state.reasons).some(reason => reason.trim() !== '');
}

function changeSection(item: Record<string, unknown>): OrganizationDraftSection | null {
  if ('name' in item || 'description' in item) return 'general';
  if ('ownerId' in item) return 'people';
  if ('plan' in item || 'projectLimit' in item) return 'policy';
  return null;
}

/** A version bump alone cannot acknowledge a submitted edit. Every submitted field must match. */
export function organizationChangeMatchesDetail(item: Record<string, unknown>, detail: Detail): boolean {
  if (!isOrganizationDraftDetail(detail, Number(item.id)) || !integer(item.version) || detail.organization.version < item.version || !changeSection(item)) return false;
  if ('name' in item && (typeof item.name !== 'string' || item.name.trim() !== detail.organization.name)) return false;
  if ('description' in item && (typeof item.description !== 'string' || item.description.trim() !== detail.organization.description)) return false;
  if ('ownerId' in item && item.ownerId !== detail.organization.owner?.id) return false;
  if ('plan' in item && item.plan !== detail.organization.plan) return false;
  if ('projectLimit' in item && item.projectLimit !== detail.policy.projectOverride) return false;
  return true;
}

export function reconcileOrganizationDraft(state: OrganizationDraftState, detail: Detail, confirmation?: OrganizationDraftConfirmation): OrganizationDraftState {
  if (!isOrganizationDraftDetail(detail, detail?.organization?.id)) return state;
  if (state.organizationId !== detail.organization.id) return createOrganizationDraft(detail);
  const baseline = serverValues(detail), values = {...state.values}, reasons = {...state.reasons};
  // A read refreshes untouched fields and leaves local edits intact, including an inactive limit.
  for (const key of valueKeys) {
    if (comparable(key, state.values[key]) === comparable(key, state.baseline[key])) Object.assign(values, {[key]: baseline[key]});
  }
  let acknowledged = state.acknowledged;
  if (confirmation && confirmation.receipt > acknowledged && organizationChangeMatchesDetail(confirmation.item, detail)) {
    const item = confirmation.item, section = changeSection(item)!;
    const submitted: Partial<OrganizationDraftValues> = {
      ...('name' in item ? {name: String(item.name)} : {}),
      ...('description' in item ? {description: String(item.description)} : {}),
      ...('ownerId' in item ? {owner: String(item.ownerId)} : {}),
      ...('plan' in item ? {plan: item.plan as Plan} : {}),
      ...('projectLimit' in item ? {customLimit: item.projectLimit !== null, ...(item.projectLimit !== null ? {limit: String(item.projectLimit)} : {})} : {}),
    };
    for (const key of valueKeys) {
      const sent = submitted[key];
      if (sent !== undefined && comparable(key, state.values[key]) === comparable(key, sent)) Object.assign(values, {[key]: baseline[key]});
    }
    if (typeof item.reason === 'string' && reasons[section] === item.reason) reasons[section] = '';
    acknowledged = confirmation.receipt;
  }
  return {...state, baseline, values, reasons, acknowledged};
}

export function creationDraftIsDirty(value: {name: string; description: string; plan: Plan; email: string; ownerId: number | null; confirmed: boolean}): boolean {
  return Boolean(value.name.trim() || value.description.trim() || value.email.trim() || value.plan !== 'free' || value.ownerId !== null || value.confirmed);
}
