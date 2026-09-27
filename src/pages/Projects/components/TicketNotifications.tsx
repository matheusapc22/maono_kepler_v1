import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../../../lib/api-transport';
import TicketErrorNotice from './TicketErrorNotice';
import { toTicketApiError } from './tickets-api';
import './ticket-notifications.css';
import TicketNotificationOperations from './TicketNotificationOperations';

type Notification = {id:number;ticketId:number;code:string;subject:string;internal:boolean;createdAt:string;readAt:string|null};
type Inbox = {enabled:boolean;items:Notification[];unread:number;nextCursor:string|null};
export default function TicketNotifications({organizationId,onOpen,operator=false}:{organizationId:number|string;operator?:boolean;onOpen:(id:number)=>void}) {
  const [page,setPage]=useState<Inbox|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null);
  const [open,setOpen]=useState(false);
  const sequence=useRef(0);
  const path=`/api/organizations/${encodeURIComponent(String(organizationId))}/ticket-notifications`;
  const load=useCallback(async(before?:string)=>{
    const current=++sequence.current;
    setBusy(true);setError(null);
    try {
      const data=await requestJson<Inbox>(`${path}${before?`?before=${encodeURIComponent(before)}`:''}`);
      if(current===sequence.current) setPage(data);
    } catch(cause) { if(current===sequence.current) {setPage(null);setError(cause);} }
    finally {if(current===sequence.current)setBusy(false);}
  },[path]);
  const invalidate=useCallback(()=>{sequence.current++;},[]);
  useEffect(()=>{setPage(null);setOpen(false);void load();return invalidate;},[load,invalidate]);
  useEffect(()=>{
    const refresh=()=>{if(!document.hidden)void load();};
    window.addEventListener('focus',refresh);
    const timer=window.setInterval(refresh,60000);
    return()=>{window.removeEventListener('focus',refresh);window.clearInterval(timer);};
  },[load]);
  async function mark(item:Notification,read:boolean) {
    const current=++sequence.current;setBusy(true);setError(null);
    try {
      await requestJson(path,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,read})});
      if(current===sequence.current) await load();
    } catch(cause) { if(current===sequence.current){setPage(null);setError(cause);} }
    finally{if(current===sequence.current)setBusy(false);}
  }
  if(page?.enabled===false || page===null && error===null)return null;
  return <aside className="ticket-notifications" aria-label="Notificações de chamados">
    <button type="button" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void load();}}>
      Notificações{page ? ` (${page.unread} não lidas)` : ''}
    </button>
    {open && <div aria-busy={busy}>
      <button type="button" onClick={()=>void load()} disabled={busy}>Atualizar</button>
      {busy && <p role="status">Carregando notificações…</p>}
      {error!=null && <TicketErrorNotice error={toTicketApiError(error)} />}
      {!busy && page?.items.length===0 && <p>Nenhuma notificação.</p>}
      {operator && page?.enabled && <TicketNotificationOperations path={path} />}
      <ul>{page?.items.map(item=><li key={item.id}>
        <button type="button" onClick={()=>{onOpen(item.ticketId);void mark(item,true);}} disabled={busy}>
          {item.code}: {item.subject}{item.internal?' · Nota interna':''}{!item.readAt?' · Não lida':''}
        </button>
        <button type="button" onClick={()=>void mark(item,!item.readAt)} disabled={busy}>
          {item.readAt?'Marcar como não lida':'Marcar como lida'}
        </button>
      </li>)}</ul>
      {page?.nextCursor && <button type="button" disabled={busy} onClick={()=>void load(page.nextCursor!)}>Mais antigas</button>}
    </div>}
  </aside>;
}
