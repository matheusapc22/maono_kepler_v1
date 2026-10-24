import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../../../lib/api-transport';
import TicketErrorNotice from './TicketErrorNotice';
import { toTicketApiError } from './tickets-api';
import './ticket-notifications.css';
import TicketNotificationOperations from './TicketNotificationOperations';
import {invalidateNotices, NOTICE_CHANGED, NOTICE_SESSION_RESET, NOTICE_SESSION_READY} from '../../../components/notices/notice-events';

type Notification = {id:number;ticketId:number;code:string;subject:string;internal:boolean;createdAt:string;readAt:string|null};
type Inbox = {enabled:boolean;items:Notification[];unread:number;nextCursor:string|null};
type Props={organizationId:number|string;userId?:number|string|null;operator?:boolean;onOpen:(id:number)=>void};
export default function TicketNotifications(props:Props) {
  return <ScopedTicketNotifications key={`${props.userId ?? ''}:${props.organizationId}`} {...props}/>;
}
function ScopedTicketNotifications({organizationId,userId,onOpen,operator=false}:Props) {
  const [page,setPage]=useState<Inbox|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null);
  const [open,setOpen]=useState(false);
  const sequence=useRef(0);
  const blocked=useRef(false);
  const mutating=useRef(false);
  const path=`/api/organizations/${encodeURIComponent(String(organizationId))}/ticket-notifications`;
  const load=useCallback(async(before?:string)=>{
    if(blocked.current)return;
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
    window.addEventListener(NOTICE_CHANGED,refresh);
    const reset=()=>{blocked.current=true;invalidate();setPage(null);setOpen(false);setBusy(false);setError(null);};
    const ready=(event:Event)=>{if((event as CustomEvent<string>).detail===`${userId ?? ''}:${organizationId}`){blocked.current=false;void load();}};
    window.addEventListener(NOTICE_SESSION_RESET,reset);
    window.addEventListener(NOTICE_SESSION_READY,ready);
    const timer=window.setInterval(refresh,60000);
    return()=>{window.removeEventListener('focus',refresh);window.removeEventListener(NOTICE_CHANGED,refresh);window.removeEventListener(NOTICE_SESSION_RESET,reset);window.removeEventListener(NOTICE_SESSION_READY,ready);window.clearInterval(timer);};
  },[load,invalidate,userId,organizationId]);
  async function mark(item:Notification,read:boolean) {
    if(blocked.current||mutating.current)return;
    mutating.current=true;
    const current=++sequence.current;setBusy(true);setError(null);
    try {
      await requestJson(path,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,read})});
      if(current===sequence.current) {invalidateNotices();}
    } catch(cause) { if(current===sequence.current){setPage(null);setError(cause);} }
    finally{mutating.current=false;if(current===sequence.current)setBusy(false);}
  }
  if(page?.enabled===false || page===null && error===null)return null;
  return <aside className="ticket-notifications" aria-label="Notificações de chamados">
    <button type="button" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void load();}}>
      Notificações{page && !busy ? ` (${page.unread} não lidas)` : ''}
    </button>
    {open && <div aria-busy={busy}>
      <button type="button" onClick={()=>void load()} disabled={busy}>Atualizar</button>
      {busy && <p role="status">Carregando notificações…</p>}
      {error!=null && <TicketErrorNotice error={toTicketApiError(error)} />}
      {!busy && page?.items.length===0 && <p>Nenhuma notificação.</p>}
      {operator && page?.enabled && <TicketNotificationOperations path={path} />}
      <ul>{!busy && page?.items.map(item=><li key={item.id}>
        <button type="button" onClick={()=>onOpen(item.ticketId)} disabled={busy}>
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
