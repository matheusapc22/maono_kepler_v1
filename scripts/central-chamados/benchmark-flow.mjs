// Local SQLite baseline, not Cloudflare latency or a production acceptance result.
import {performance} from 'node:perf_hooks';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createTicketCommandDb,COMMAND_ACTORS} from '../../tests/helpers/ticket-command-db.mjs';
import {listTickets,parseTicketListOptions} from '../../functions/_lib/ticket-center.js';
const cleanup=[];const db=await createTicketCommandDb({after:fn=>cleanup.push(fn)});
try{
 db.sqlite.exec(readFileSync(new URL('../../migrations/0032_ticket_flow_navigation.sql',import.meta.url),'utf8'));
 db.env.MAONO_TICKET_FLOW_ENABLED='true';db.env.MAONO_TICKET_FLOW_ORGANIZATION_IDS='1';
 const stmt=db.sqlite.prepare("INSERT INTO organization_tickets(organization_id,code,subject,description,status,priority,category,created_by,created_at,updated_at) VALUES(1,?,'Benchmark','Fixture','open','normal','support',1,'2026-09-01','2026-09-01')");
 for(let n=0;n<1000;n++)stmt.run(`BENCH-${n}`);
 const samples=[];
 for(let n=0;n<5;n++){
   let start=performance.now();const first=await listTickets(db.env,1,parseTicketListOptions('https://local/?limit=50'),COMMAND_ACTORS.owner);const firstMs=performance.now()-start;
   start=performance.now();const next=await listTickets(db.env,1,parseTicketListOptions(`https://local/?limit=50&page=2&snapshot=${first.pagination.snapshot}`),COMMAND_ACTORS.owner);
   samples.push({firstMs:+firstMs.toFixed(2),nextMs:+(performance.now()-start).toFixed(2),returned:first.tickets.length,total:first.pagination.total,nextReturned:next.tickets.length});
 }
 const evidence=new URL('../../docs/central-chamados/cc-09/evidence/',import.meta.url);mkdirSync(evidence,{recursive:true});
 writeFileSync(new URL('benchmark.json',evidence),JSON.stringify({localOnly:true,engine:'node:sqlite',records:1000,pageSize:50,budget:{localPerPageMs:500,productionP95Ms:1500,productionBudgetUnverified:true},samples},null,2));console.log(JSON.stringify(samples));
}finally{cleanup.forEach(fn=>fn());}
