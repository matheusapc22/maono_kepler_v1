export function overviewMetricPresentation({ value, available = true, state }: {
  value: number;
  available?: boolean;
  state: { loaded: boolean; pending: boolean; error?: string };
}): { value: number | null; note: string } {
  if (!state.loaded || !available || !Number.isSafeInteger(value) || value < 0) return { value: null, note: state.pending ? '' : 'Indisponível' };
  if (state.error) return { value, note: 'Dados anteriores - leitura falhou' };
  if (state.pending) return { value, note: 'Atualizando dados anteriores' };
  return { value, note: '' };
}
