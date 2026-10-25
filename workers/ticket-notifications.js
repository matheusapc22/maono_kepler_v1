import { consumeTicketNotifications } from '../functions/_lib/ticket-notifications.js';
import { notificationAcceptancePolicy } from '../functions/_lib/ticket-notification-acceptance.js';
export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async()=>{
      // A readiness receipt never touches D1 or the notification queue.
      if(env.MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON&&env.MAONO_TICKET_NOTIFICATION_CONSUMER_ENABLED==='false'){
        const policy=notificationAcceptancePolicy(env);
        const versionId=env.CF_VERSION_METADATA?.id;
        if(!/^[a-f0-9-]{36}$/.test(versionId||'')||controller.cron!=='* * * * *'||!Number.isSafeInteger(controller.scheduledTime))throw Error('OFF_RECEIPT_INVALID');
        if(!policy.active)return {enabled:false,claimed:0,windowClosed:true};
        console.log(JSON.stringify({event:'ticket.notifications.off-ready',schemaVersion:1,versionId,runId:policy.runId,organizationId:policy.organizationId,
          scheduledTime:controller.scheduledTime,cron:controller.cron,consumerEnabled:false,claimed:0}));
        return null;
      }
      return consumeTicketNotifications(env);
    })().then(report => {
      if(report===null)return;
      console.log(JSON.stringify({event:'ticket.notifications.batch',...report}));
    }).catch(() => { console.error('ticket.notifications.batch_failed'); throw new Error('NOTIFICATION_BATCH_FAILED'); }));
  },
};
