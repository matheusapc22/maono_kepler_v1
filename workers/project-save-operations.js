import { runProjectPreviewRecovery } from "./project-preview-operations.js";
import { reconcileProjectSaveOperations } from "../functions/_lib/project-save-operations.js";

export async function runProjectSaveRecovery(env) {
  if (String(env.PROJECT_DURABLE_SAVE_WORKER_ENABLED || "false") !== "true") return {disabled:true};
  const limit=Math.min(25,Math.max(1,Number(env.PROJECT_DURABLE_SAVE_BATCH_SIZE) || 10));
  const startedAt=Date.now();
  const result=await reconcileProjectSaveOperations(env,{limit});
  // Only operation metadata and counts are logged; no payload, dataset or secret.
  console.log("[Maono durable save] recovery batch",{...result,durationMs:Date.now()-startedAt});
  const db=env.DB?.withSession ? env.DB.withSession("first-primary") : env.DB;
  const stagnant=await db.prepare(`SELECT COUNT(*) AS count, MIN(updated_at) AS oldest
    FROM project_save_operations WHERE payload_stored_at IS NOT NULL
      AND state IN ('PAYLOAD_STORED','PROCESSING','RETRY_WAIT')
      AND updated_at < datetime('now','-15 minutes')`).first();
  if(Number(stagnant?.count)>0)console.error("[Maono durable save] alert",{code:"PROJECT_SAVE_STAGNANT_OPERATIONS",count:Number(stagnant.count),oldest:stagnant.oldest});
  return result;
}

// Both domains share the scheduled invocation, never each other's journal/flag.
export async function runProjectRecoveryDomains(env, { saveRecovery = runProjectSaveRecovery, previewRecovery = runProjectPreviewRecovery } = {}) {
  const results = await Promise.allSettled([Promise.resolve().then(() => saveRecovery(env)), Promise.resolve().then(() => previewRecovery(env))]);
  for (const [index, result] of results.entries()) if (result.status === "rejected") {
    const raw = String(result.reason?.code || "RECOVERY_DOMAIN_FAILED");
    console.error("[Maono recovery] domain failed", { domain: index === 0 ? "save" : "preview", code: /^[A-Z0-9_]{1,120}$/.test(raw) ? raw : "RECOVERY_DOMAIN_FAILED" });
  }
  return results;
}

export default {
  async scheduled(_event,env,context) {
    context.waitUntil(runProjectRecoveryDomains(env));
  },
  async fetch() { return new Response("Not Found",{status:404}); },
};
