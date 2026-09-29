import {
  enabled,
  exportsEnabled,
  exportError,
} from "../functions/_lib/ticket-export-domain.js";
import {
  exportReady,
  processExportStep,
  cleanupTicketExports,
} from "../functions/_lib/ticket-exports.js";

export async function consumeTicketExports(env) {
  if (!enabled(env.MAONO_TICKET_EXPORT_WORKER_ENABLED))
    return { enabled: false };
  if (!["local", "production"].includes(String(env.MAONO_RUNTIME_ENV)))
    throw exportError("RUNTIME_DENIED", 503);
  const orgs = String(env.MAONO_TICKET_EXPORT_ORGANIZATION_IDS || "")
    .split(",")
    .map(Number);
  if (
    !orgs.length ||
    orgs.length > 20 ||
    orgs.some((x) => !Number.isSafeInteger(x) || x < 1)
  )
    throw exportError("SCOPE_REQUIRED", 503);
  let claimed = 0;
  const organizations = [...new Set(orgs)],
    offset = Math.floor(Date.now() / 60000) % organizations.length;
  // Rotate organizations to avoid starvation while bounding the entire invocation.
  for (const org of [
    ...organizations.slice(offset),
    ...organizations.slice(0, offset),
  ]) {
    await cleanupTicketExports(env, org);
    if (!exportsEnabled(env, org)) continue; // Cleanup stays active during a feature rollback.
    await exportReady(env, org);
    // Finite work per invocation; progress survives between cron executions.
    for (let step = 0; step < 5 && claimed < 5; step++) {
      const result = await processExportStep(env, org);
      if (!result.claimed) break;
      claimed++;
    }
  }
  return { enabled: true, claimed };
}
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      consumeTicketExports(env)
        .then((report) =>
          console.log(
            JSON.stringify({ event: "ticket.exports.batch", ...report }),
          ),
        )
        .catch(() => {
          console.error("ticket.exports.batch_failed");
          throw new Error("TICKET_EXPORT_BATCH_FAILED");
        }),
    );
  },
};
