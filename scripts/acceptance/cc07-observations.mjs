// Aggregate evidence only: never persist SQL rows, recipient content, provider
// response bodies, credentials, leases or session material in diagnostics.
const countStates=(rows,key,states)=>Object.fromEntries(states.map(state=>[state,rows.filter(row=>row[key]===state).length]));
export function summarizeCc07Inventory(audit){
 const {outbox,candidates,notices,tickets}=audit.scoped;
 const attempts=outbox.reduce((sum,row)=>sum+row.notification_attempts,0);
 const outboxStates=countStates(outbox,'status',['pending','processing','delivered','failed']);
 const candidateStates=countStates(candidates,'state',['pending','delivered','suppressed']);
 const processingObserved=attempts>0||notices.length>0||outboxStates.processing>0||outboxStates.delivered>0||outboxStates.failed>0||candidateStates.delivered>0||candidateStates.suppressed>0;
 return {oldestQueryAt:audit.startedAt,completedAt:audit.completedAt,
  counts:{tickets:tickets.length,outbox:outbox.length,candidates:candidates.length,notices:notices.length},
  attempts,outboxStates,candidateStates,
  evidence:processingObserved?'PERSISTED_PROCESSING_OBSERVED':'NO_PERSISTED_PROCESSING_OBSERVED'};
}

// A successful control-plane readback is not an invocation/propagation receipt.
export function summarizeCc07Worker(snapshot,{active,observedAt}){
 const current=snapshot.deployments.deployments[0];
 return {observedAt,active,deploymentId:current.id,versionId:current.versions[0].version_id,
  percentage:current.versions[0].percentage,crons:snapshot.schedules.schedules.map(row=>row.cron),
  configurationReadbackOnly:true};
}
