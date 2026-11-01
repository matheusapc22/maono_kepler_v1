export const healthChecks = [
  { key: 'dbBinding', label: 'Vínculo com banco D1', confirmed: 'Presente', unconfirmed: 'Ausente' },
  { key: 'databaseReachable', label: 'Consulta básica ao D1', confirmed: 'Respondeu ao teste', unconfirmed: 'Não confirmado' },
  { key: 'dropboxAppKey', label: 'Chave do aplicativo Dropbox', confirmed: 'Presente', unconfirmed: 'Ausente' },
  { key: 'dropboxAppSecret', label: 'Segredo do aplicativo Dropbox', confirmed: 'Presente', unconfirmed: 'Ausente' },
  { key: 'dropboxRefreshToken', label: 'Token de renovação Dropbox', confirmed: 'Presente', unconfirmed: 'Ausente' },
] as const;
export type HealthCheckKey = typeof healthChecks[number]['key'];
export type BasicHealth = Record<HealthCheckKey, boolean | null>;

export function parseBasicHealth(value: unknown): BasicHealth {
  if (!value || typeof value !== 'object') throw new Error('Invalid health response');
  const data = value as { ok?: unknown; checks?: unknown };
  if (typeof data.ok !== 'boolean' || !data.checks || typeof data.checks !== 'object' || Array.isArray(data.checks)) throw new Error('Invalid health response');
  const checks = data.checks as Record<string, unknown>;
  // Strict booleans only. A secret or an unrecognized value is never rendered.
  return Object.fromEntries(healthChecks.map(({ key }) => [key, typeof checks[key] === 'boolean' ? checks[key] : null])) as BasicHealth;
}

export function basicHealthSummary(checks: BasicHealth): string {
  const states = Object.values(checks);
  if (states.some(state => state === null)) return 'Resposta parcial: há verificações indisponíveis.';
  return states.every(state => state === true) ? 'Verificações básicas confirmadas.' : 'Há verificações básicas não confirmadas.';
}
