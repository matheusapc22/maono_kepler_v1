import { consumeTicketNotifications } from '../functions/_lib/ticket-notifications.js';
export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(consumeTicketNotifications(env).then(report => {
      console.log(JSON.stringify({event:'ticket.notifications.batch',...report}));
    }).catch(() => { console.error('ticket.notifications.batch_failed'); throw new Error('NOTIFICATION_BATCH_FAILED'); }));
  },
};
