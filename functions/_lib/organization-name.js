// Shared Unicode comparison only; importing this module performs no I/O.
// Keep display names unchanged. The functional rollout imports this same rule.
export function canonicalOrganizationName(name) {
  return String(name).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase().normalize('NFKC');
}
