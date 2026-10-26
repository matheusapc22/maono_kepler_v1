import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { integratedDb } from '../../tests/helpers/ticket-integrated-db.mjs';
import { onRequestGet as list } from '../../functions/api/organizations/[id]/tickets.js';
import { onRequestGet as detail } from '../../functions/api/organizations/[id]/tickets/[ticketId].js';
import { createTicketDraft, createTicketMessage, resolveTicketConversationContext } from '../../functions/_lib/ticket-conversations.js';

// Offline only. Executes actual route/SQL code on disposable in-memory SQLite.
// Never logs SQL parameters, session tokens, response bodies or user content.
export async function fixture(records = 80, flow = true, bindingDelayMs = 0) {
  const cleanup = [];
  const f = await integratedDb({ after: fn => cleanup.push(fn) });
  Object.assign(f.env, { MAONO_TICKET_FLOW_ENABLED: String(flow), MAONO_TICKET_FLOW_ORGANIZATION_IDS: '1' });
  for (let i = 1; i <= records; i++) {
    f.sqlite.prepare("INSERT INTO organization_tickets(id,organization_id,code,subject,description,status,priority,assigned_to,created_by,created_at,updated_at,current_cycle_number,visibility) VALUES(?,1,?,?,'Synthetic',?,?,2,1,'2026-01-01','2026-01-01',1,?)")
      .run(i,`SYN-${i}`,`Synthetic ${i}`,['new','open','in_progress','in_review','closed'][i%5],['low','normal','high'][i%3],i%7===0?'private':'organization');
    f.sqlite.prepare("INSERT INTO ticket_cycles(organization_id,ticket_id,cycle_number,origin,opened_at,opened_by) VALUES(1,?,1,'created','2026-01-01',1)").run(i);
  }
  f.sqlite.exec("INSERT INTO ticket_labels VALUES('label',1,'Synthetic',1,1,'2026-01-01','2026-01-01')");
  for (let i = 1; i <= Math.min(records, 30); i++) {
    f.sqlite.prepare("INSERT INTO ticket_label_links VALUES(1,?,'label',1,'2026-01-01')").run(i);
    for (const audience of ['ticket']) {
      if (audience === 'ticket') f.sqlite.prepare("INSERT INTO ticket_attachments(organization_id,ticket_id,original_name,stored_name,storage_key,mime_type,size_bytes,status,uploaded_by,audience) VALUES(1,?,'synthetic.txt','synthetic',?,'text/plain',10,'ACTIVE',1,?)").run(i, `synthetic/${i}/${audience}`, audience);
      f.sqlite.prepare("INSERT INTO ticket_events(organization_id,ticket_id,event_type,actor_user_id,metadata,audience) VALUES(1,?,'created',1,'{}',?)").run(i, audience);
    }
  }
  const context = await resolveTicketConversationContext(f.env,1,1,{ id:1, role:'owner', activeOrganizationId:1 });
  const draft = await createTicketDraft(f.env,context,{kind:'internal',body:'Synthetic note'});
  f.sqlite.prepare("INSERT INTO ticket_attachments(organization_id,ticket_id,original_name,stored_name,storage_key,mime_type,size_bytes,status,uploaded_by,audience,draft_id) VALUES(1,1,'synthetic.txt','synthetic','synthetic/internal','text/plain',10,'ACTIVE',1,'draft',?)").run(draft.id);
  const attachmentId = Number(f.sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
  await createTicketMessage(f.env,context,{kind:'internal',body:draft.body,draftId:draft.id,draftVersion:draft.version,attachmentIds:[attachmentId]},new Request('http://synthetic.test/messages',{method:'POST',headers:{'Idempotency-Key':'synthetic-note'}}));
  const db = f.env.DB;
  const traces = [];
  function instrument(base, events, origin) {
    async function call(kind, sql, operation) {
      const start = performance.now();
      if (bindingDelayMs) await delay(bindingDelayMs);
      const bindingStart = performance.now();
      try { return await operation(); }
      finally {
        events.push({ kind, query: createHash('sha256').update(sql).digest('hex').slice(0,12),
          phase: /sqlite_master|PRAGMA table_info/i.test(sql) ? 'schema' : /ticket_query_snapshot/i.test(sql) ? 'snapshot' : /sessions|permissions|organization_users|ticket_acl|ticket_access_/i.test(sql) ? 'authorization' : 'query',
          startMs: start-origin, durationMs: performance.now()-start, adapterDurationMs: performance.now()-bindingStart });
      }
    }
    return {
      prepare(sql) {
        const stmt = base.prepare(sql);
        const wrapped = { bind(...args) { stmt.bind(...args); return wrapped; },
          first: () => call('first',sql,()=>stmt.first()), all: () => call('all',sql,()=>stmt.all()), run: () => call('run',sql,()=>stmt.run()),
          __execute: () => stmt.__execute(), __description: () => stmt.__description() };
        return wrapped;
      },
      batch: stmts => call('batch',stmts.map(s=>s.__description().sql).join('\n'),()=>base.batch(stmts)),
    };
  }
  const cookies = { owner: f.sessionCookie(1), viewer: f.sessionCookie(3) };
  async function request(kind, query = '', profile = 'owner') {
    const start = performance.now(), events = [];
    const countStart = f.statements.length;
    const response = await (kind === 'detail' ? detail : list)({ env: { ...f.env, DB: instrument(db,events,start) },
      params: { id: '1', ticketId: '1' }, request: new Request(`http://synthetic.test/api/organizations/1/tickets${kind === 'detail' ? '/1' : ''}?${query}`, { headers: { cookie: cookies[profile] } }) });
    const serializeStart = performance.now();
    const body = await response.text();
    const trace = { kind, profile, elapsedMs: performance.now()-start, consumeBodyMs: performance.now()-serializeStart,
      status: response.status, bytes: Buffer.byteLength(body), sqlCalls: f.statements.length-countStart, bindingCalls: events.length,
      bindingMs: events.reduce((n,e)=>n+e.durationMs,0), schemaCalls: events.filter(e=>e.phase==='schema').length, events };
    traces.push(trace);
    assert.equal(response.status,200,`Synthetic ${kind} failed: ${response.status}`);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    return { data: JSON.parse(body), trace };
  }
  return { ...f, request, traces, close: async () => { for (const fn of cleanup.reverse()) await fn(); } };
}
export const stats = values => {
  const sorted = [...values].sort((a,b)=>a-b);
  return { n: sorted.length, p50: sorted[Math.ceil(sorted.length*.5)-1], p95: sorted[Math.ceil(sorted.length*.95)-1] };
};
if (process.argv[1]?.endsWith('benchmark-read-paths.mjs')) {
  const label = process.argv[2] || 'baseline', repetitions = Number(process.env.PERF_SAMPLES || 30);
  assert.ok(repetitions >= 30);
  const bindingDelayMs = Number(process.env.PERF_BINDING_DELAY_MS || 0), runs = [];
  for (const records of [80,800]) for (const flow of [false,true]) for (const profile of ['owner','viewer']) {
    const f = await fixture(records,flow,bindingDelayMs);
    try {
      const cold = await f.request('list','limit=25&includeUndated=1',profile);
      await f.request('detail','',profile); // explicitly excluded warm-up
      const conditions = [];
      for (const [scenario, query] of [['list-reuse',`limit=25&includeUndated=1${flow ? '&snapshot='+cold.data.pagination.snapshot : ''}`], ['queue-reuse',`queue=open&limit=25&includeUndated=1${flow ? '&snapshot='+cold.data.pagination.snapshot : ''}`], ['queue-page2',`queue=open&page=2&limit=25&includeUndated=1${flow ? '&snapshot='+cold.data.pagination.snapshot : ''}`], ['filter-fresh','q=Synthetic&limit=25&includeUndated=1'], ['detail','']]) {
        const samples = [];
        for (let i=0;i<repetitions;i++) samples.push((await f.request(scenario==='detail'?'detail':'list',query,profile)).trace);
        conditions.push({ scenario, summary: Object.fromEntries(['elapsedMs','bytes','sqlCalls','bindingCalls','bindingMs','schemaCalls'].map(k=>[k,stats(samples.map(s=>s[k]))])), failures:0, aborts:0, samples });
      }
      runs.push({ records,flow,profile,firstRequest:cold.trace,conditions });
      console.log(JSON.stringify({ records,flow,profile,conditions:conditions.map(c=>({scenario:c.scenario,...c.summary.elapsedMs,bindings:c.summary.bindingCalls.p50,schema:c.summary.schemaCalls.p50})) }));
    } finally { await f.close(); }
  }
  const report = { schemaVersion:1,label,sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtime:process.version,platform:process.platform,createdAt:new Date().toISOString(),bindingDelayMs,
    environment:'isolated node:sqlite; actual HTTP handlers; no remote network',
    unavailable:['D1 remote latency','D1 SQL duration','rows_read','rows_written','browser timings','server serialization span'],
    overhead:'performance.now + query hashing per binding; same instrumentation for both variants; adapter duration includes wrapper overhead',runs };
  await mkdir('.tmp/ticket-performance',{recursive:true});
  await writeFile(`.tmp/ticket-performance/${label}.json`,JSON.stringify(report,null,2)+'\n');
}
