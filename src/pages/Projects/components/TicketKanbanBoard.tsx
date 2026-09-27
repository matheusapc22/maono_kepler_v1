import { useEffect, useRef, useState } from 'react';
import TicketKanbanView from './TicketKanbanView';
import TicketErrorNotice from './TicketErrorNotice';
import { listTickets, toTicketApiError, type TicketApiError } from './tickets-api';
import type { Ticket, TicketFilters, TicketPagination, TicketQueuePolicy, TicketStatus } from './ticket-types';
const queues = ['open','in_progress','in_review','closed'];
type Column = {tickets: Ticket[]; total: number; hasMore: boolean; loading: boolean; pagination?: TicketPagination; error?: TicketApiError};
export default function TicketKanbanBoard({organizationId,filters,policies,canManage,busyTicketIds,onOpen,onStatusChange}: {
 organizationId: number | string; filters: TicketFilters; policies: TicketQueuePolicy[]; canManage: boolean;
 busyTicketIds: ReadonlySet<string>; onOpen: (ticket: Ticket) => void; onStatusChange: (ticket: Ticket,status: TicketStatus) => void;
}) {
 const [columns,setColumns] = useState<Record<string,Column>>({});
 const current = useRef(columns); current.current = columns;
 const controllers = useRef(new Map<string,AbortController>());
 const generation = useRef(0);
 async function load(queue: string, more=false) {
   controllers.current.get(queue)?.abort(); const controller = new AbortController(); controllers.current.set(queue,controller);
   const epoch=generation.current, previous=current.current[queue];
   const page=more ? (previous?.pagination?.page || 0)+1 : 1;
   setColumns(state=>({...state,[queue]:{...(state[queue] || {tickets:[],total:0,hasMore:false}),loading:true,error:undefined}}));
   try {
     const data=await listTickets(organizationId,filters,page,controller.signal,{limit:25,includeUndated:true,queue,snapshot:more?previous?.pagination?.snapshot:null});
     if(controller.signal.aborted || epoch!==generation.current) return;
     setColumns(state=>({...state,[queue]:{tickets:more?[...(previous?.tickets || []),...data.tickets]:data.tickets,total:data.pagination.total,hasMore:data.pagination.hasMore,loading:false,pagination:data.pagination}}));
   } catch(error) {
     if(controller.signal.aborted || epoch!==generation.current) return;
     setColumns(state=>({...state,[queue]:{...(state[queue] || {tickets:[],total:0,hasMore:false}),loading:false,error:toTicketApiError(error)}}));
   }
 }
 useEffect(()=>{
   generation.current+=1;setColumns({});for(const queue of queues) void load(queue);
   return ()=>{generation.current+=1;for(const controller of controllers.current.values()) controller.abort();};
 // The parent remounts this board for every query/snapshot, including refresh.
 }, []);
 const tickets=Object.values(columns).flatMap(column=>column.tickets);
 return <>{queues.map(queue=>columns[queue]?.error?<TicketErrorNotice key={queue} error={columns[queue].error!} onRetry={()=>void load(queue)}/>:null)}
 <TicketKanbanView tickets={tickets} columnPages={columns} totals={{new:0,open:0,in_progress:0,in_review:0,closed:0}}
  policies={policies} hasMore={false} loading={false} onLoadMore={queue=>void load(queue,true)}
  canManage={canManage} busyTicketIds={busyTicketIds} onOpen={onOpen} onStatusChange={onStatusChange}/></>;
}
