import { consumeChangeReconciliations } from "../functions/_lib/ticket-changes.js";
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      consumeChangeReconciliations(env).then((result) =>
        console.log(JSON.stringify({ operation: "cc08.reconcile", ...result })),
      ),
    );
  },
};
