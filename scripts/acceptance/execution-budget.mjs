// Reviewed code-only limits. No timeout, shell or flag inputs are accepted from
// workflow dispatch. The protected job has 210 minutes; execution has at most
// 190, leaving 20 minutes for checkout/setup and Actions/reporting overhead.
export const MINUTE_MS = 60_000;
export const WORKFLOW_TIMEOUT_MINUTES = 210;
export const MAX_MUTATION_BUDGET_MS = 45 * MINUTE_MS;
export const PHASE_BUDGET_MS = Object.freeze({
  preflight: 10 * MINUTE_MS,
  activation: 60 * MINUTE_MS,
  suite: MAX_MUTATION_BUDGET_MS,
  cleanup: 10 * MINUTE_MS,
  restoration: 60 * MINUTE_MS,
  report: 5 * MINUTE_MS,
});
const ORDER = Object.keys(PHASE_BUDGET_MS);
const CLOSURE_RESERVE_MS = PHASE_BUDGET_MS.cleanup + PHASE_BUDGET_MS.restoration + PHASE_BUDGET_MS.report;

function budgetError(code, message) {
  return Object.assign(new Error(message), { name: "AcceptanceBudgetError", code });
}
export function totalBudgetMs(manifest = {}) {
  return Object.values(PHASE_BUDGET_MS).reduce((sum, value) => sum + value, 0) - MAX_MUTATION_BUDGET_MS + (manifest.mutationBudgetMs ?? MAX_MUTATION_BUDGET_MS);
}
export function createExecutionBudget(manifest = {}, { now = Date.now } = {}) {
  const configuredSuiteMs = manifest.mutationBudgetMs ?? MAX_MUTATION_BUDGET_MS;
  if (!Number.isSafeInteger(configuredSuiteMs) || configuredSuiteMs <= 0 || configuredSuiteMs > MAX_MUTATION_BUDGET_MS) {
    throw budgetError("ACCEPTANCE_BUDGET_INVALID", "Orçamento da suite fora do limite revisado.");
  }
  const startedAt = now();
  const endAt = startedAt + totalBudgetMs(manifest);
  let phase = null, phaseDeadline = startedAt, ordinal = -1;
  const remainingMs = () => {
    const remaining = Math.floor(Math.min(phaseDeadline, endAt) - now());
    if (remaining <= 0) throw budgetError("ACCEPTANCE_PHASE_TIMEOUT", `Orçamento da fase ${phase || "não iniciada"} esgotado; seguir para fechamento.`);
    return remaining;
  };
  return {
    startedAt, endAt, closureReserveMs: CLOSURE_RESERVE_MS,
    get phase() { return phase; },
    get phaseDeadline() { return phaseDeadline; },
    enter(next) {
      const index = ORDER.indexOf(next);
      if (index <= ordinal) throw budgetError("ACCEPTANCE_PHASE_INVALID", "Fase inválida ou regressiva no operador.");
      const allocation = next === "suite" ? configuredSuiteMs : PHASE_BUDGET_MS[next];
      if (next === "activation" || next === "suite") {
        if (endAt - now() < allocation + CLOSURE_RESERVE_MS) {
          throw budgetError("ACCEPTANCE_CLOSURE_BUDGET_REQUIRED", "Tempo insuficiente para admitir mutações e preservar cleanup/restauração.");
        }
      }
      const reserve = next === "cleanup" ? PHASE_BUDGET_MS.restoration + PHASE_BUDGET_MS.report :
        next === "restoration" ? PHASE_BUDGET_MS.report :
          ["activation", "suite"].includes(next) ? CLOSURE_RESERVE_MS : 0;
      phase = next;
      ordinal = index;
      phaseDeadline = Math.min(now() + allocation, endAt - reserve);
      remainingMs();
      return phaseDeadline;
    },
    remainingMs,
    assertActive() { remainingMs(); },
    assertAdmission() {
      remainingMs();
      if (endAt - now() < CLOSURE_RESERVE_MS) {
        throw budgetError("ACCEPTANCE_CLOSURE_BUDGET_REQUIRED", "Não há reserva suficiente para fechar a janela.");
      }
    },
    requestTimeoutMs(requested = 30_000) { return Math.max(1, Math.min(requested, remainingMs())); },
    async pause(ms, sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration))) {
      await sleep(Math.min(ms, remainingMs()));
      remainingMs();
    },
  };
}
