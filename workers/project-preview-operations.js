// Example recovery entry point only. No binding, cron, deployment or flag is
// provisioned by this change. Activation requires separate operator approval.
import { reconcilePreviewOperations } from '../functions/_lib/project-preview-operations.js';
export async function runProjectPreviewRecovery(env) {
  return reconcilePreviewOperations(env,{limit:Math.min(25,Math.max(1,Number(env.PROJECT_PREVIEW_BATCH_SIZE) || 10))});
}
export default {
  async scheduled(_event,env,context) { context.waitUntil(runProjectPreviewRecovery(env)); },
  async fetch() { return new Response('Not Found',{status:404}); },
};
