import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Link} from 'react-router';
import {requestJson} from '../../lib/api-transport';
import {invalidateNotices, NOTICE_CHANGED, NOTICE_SESSION_READY, NOTICE_SESSION_RESET} from './notice-events';
import './notice-board.css';

type Notice = {id:number; ticketId:number; code:string; subject:string; internal:boolean; createdAt:string; readAt:string|null; dismissedAt:string|null; version:number};
type Inbox = {enabled:boolean; recipientState:boolean; items:Notice[]; unread:number; nextCursor:string|null};
type Props = {userId?:string|number|null; organizationId?:string|number|null; canView:boolean; suspended?:boolean};

// A changed identity remounts synchronously, before effects can display old data.
export default function NoticeBoard(props:Props) {
  return <ScopedNoticeBoard key={`${props.userId ?? ''}:${props.organizationId ?? ''}:${props.canView}:${Boolean(props.suspended)}`} {...props}/>;
}
function ScopedNoticeBoard({userId,organizationId,canView,suspended=false}:Props) {
  const [page,setPage]=useState<Inbox|null>(null);
  const [folder,setFolder]=useState<'active'|'deleted'>('active');
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),[open,setOpen]=useState(false);
  const [blocked,setBlocked]=useState(suspended);
  const button=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDialogElement>(null);
  const request=useRef<AbortController|null>(null), sequence=useRef(0), mutating=useRef(false), blockedRef=useRef(suspended);
  const id=useId(), scope=`${userId ?? ''}:${organizationId ?? ''}`;
  const hasIdentity=Boolean(userId && organizationId && !suspended);
  const valid=hasIdentity && canView;
  const path=`/api/organizations/${encodeURIComponent(String(organizationId))}/ticket-notifications`;
  const clear=useCallback(()=>{sequence.current++;request.current?.abort();setPage(null);setError(false);setBusy(false);setOpen(false);},[]);
  const load=useCallback(async(before?:string)=>{
    if(!valid || blockedRef.current || mutating.current)return;
    const current=++sequence.current;request.current?.abort();const controller=new AbortController();request.current=controller;
    setBusy(true);setError(false);setPage(null); // revoked content is never retained behind a failed refresh
    try {
      const params=new URLSearchParams({folder});if(before)params.set('before',before);
      const data=await requestJson<Inbox>(`${path}?${params}`,{signal:controller.signal,cache:'no-store'});
      if(current===sequence.current && !controller.signal.aborted)setPage(data);
    } catch {if(current===sequence.current && !controller.signal.aborted)setError(true);}
    finally {if(current===sequence.current)setBusy(false);}
  },[valid,path,folder]);
  const invalidate=useCallback(()=>{sequence.current++;request.current?.abort();},[]);
  useEffect(()=>{void load();return invalidate;},[load,invalidate]);
  useEffect(()=>{
    const reset=()=>{blockedRef.current=true;setBlocked(true);clear();};
    const ready=(event:Event)=>{const matches=(event as CustomEvent<string>).detail===scope;blockedRef.current=!matches;setBlocked(!matches);clear();if(matches)void load();};
    const refresh=()=>{if(!document.hidden)void load();};
    window.addEventListener(NOTICE_SESSION_RESET,reset);window.addEventListener(NOTICE_SESSION_READY,ready);
    window.addEventListener(NOTICE_CHANGED,refresh);window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);const timer=window.setInterval(refresh,60000);
    return()=>{window.removeEventListener(NOTICE_SESSION_RESET,reset);window.removeEventListener(NOTICE_SESSION_READY,ready);window.removeEventListener(NOTICE_CHANGED,refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);window.clearInterval(timer);};
  },[scope,clear,load]);
  useEffect(()=>{
    const element=dialog.current;if(!element)return;
    if(open){const rect=button.current?.getBoundingClientRect();element.style.top=`${Math.min((rect?.bottom ?? 48)+8,Math.max(8,window.innerHeight-320))}px`;element.style.left=`${Math.max(8,Math.min(rect?.left ?? 8,window.innerWidth-392))}px`;element.showModal();}
    else if(element.open)element.close();
  },[open]);
  function close(){setOpen(false);button.current?.focus();}
  async function act(item:Notice,action:'read'|'dismiss'|'restore'){
    if(mutating.current||blockedRef.current||!valid)return;
    mutating.current=true;const current=++sequence.current;request.current?.abort();const controller=new AbortController();request.current=controller;
    setBusy(true);setError(false);
    try{
      await requestJson(path,{method:'PATCH',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,action,version:item.version})});
      if(current===sequence.current){mutating.current=false;invalidateNotices();}
    }catch{if(current===sequence.current&&!controller.signal.aborted){setPage(null);setError(true);}}
    finally{mutating.current=false;if(current===sequence.current)setBusy(false);}
  }
  const unread=page?.enabled && !busy && !error && !blocked ? page.unread : null;
  return <>
    <button ref={button} type="button" className="maono-notice-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      aria-label={`Quadro de avisos${unread && unread>0 ? `, ${unread} pendentes` : ''}`}
      onClick={()=>{setOpen(true);void load();}}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>
      {unread!=null && unread>0 && <span className="maono-notice-badge" aria-hidden="true">{unread>99?'99+':unread}</span>}
    </button>
    {createPortal(<dialog ref={dialog} id={id} className="maono-notice-board" aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();close();}}
      onKeyDown={event=>{
        if(event.key!=='Tab')return;
        const nodes=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')).filter(node=>node.getClientRects().length>0);
        const first=nodes[0],last=nodes.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }}
      onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}}}>
      <header><h2 id={`${id}-title`}>Quadro de avisos</h2><button type="button" onClick={close} aria-label="Fechar quadro de avisos" autoFocus>×</button></header>
      <p className="maono-notice-caption">Avisos da sua conta nesta organização.</p>
      <nav aria-label="Pastas de avisos"><button type="button" aria-pressed={folder==='active'} onClick={()=>setFolder('active')} disabled={busy}>Todos</button><button type="button" aria-pressed={folder==='deleted'} onClick={()=>setFolder('deleted')} disabled={busy || page?.recipientState===false}>Excluídos</button><button type="button" onClick={()=>void load()} disabled={busy||blocked}>Atualizar</button></nav>
      <div aria-busy={busy} className="maono-notice-content">
        {(!hasIdentity||blocked) && <p role="status">Selecione uma organização com sua sessão ativa.</p>}
        {hasIdentity && !blocked && !canView && <p role="status">Você não tem acesso aos avisos nesta organização.</p>}
        {busy && <p role="status">Carregando avisos…</p>}
        {error && <p role="alert">Não foi possível atualizar os avisos. Atualize para conferir o estado antes de tentar novamente.</p>}
        {!busy && page?.enabled===false && <p>Os avisos ainda não estão disponíveis nesta organização.</p>}
        {!busy && page?.enabled && page.items.length===0 && <p>{folder==='deleted'?'Nenhum aviso excluído.':'Nenhum aviso por aqui.'}</p>}
        {!busy && page?.enabled && <ul>{page.items.map(item=><li key={item.id} className={!item.readAt?'is-unread':''}>
          <span className="maono-notice-state">{item.readAt?'Visualizado':'Pendente'}</span>
          <Link to={`/projects?cc_org=${encodeURIComponent(String(organizationId))}&cc_ticket=${item.ticketId}`} onClick={close}>{item.code}: {item.subject}</Link>
          {item.internal && <span>Nota interna</span>}
          <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('pt-BR')}</time>
          <div className="maono-notice-actions">
            {folder==='active' && !item.readAt && <button type="button" disabled={!page.recipientState} onClick={()=>void act(item,'read')}>Confirmar visualização</button>}
            <button type="button" disabled={!page.recipientState} onClick={()=>void act(item,folder==='deleted'?'restore':'dismiss')}>{folder==='deleted'?'Restaurar':'Excluir'}</button>
          </div>
        </li>)}</ul>}
        {page?.enabled && page.recipientState===false && <p>As ações dos avisos ainda não estão disponíveis.</p>}
        {page?.enabled && folder==='active' && <p className="maono-notice-caption">Excluir move o aviso para Excluídos, onde você pode restaurá-lo.</p>}
        {page?.nextCursor && <button type="button" disabled={busy} onClick={()=>void load(page.nextCursor!)}>Próxima página</button>}
        {page?.enabled && <button type="button" disabled={busy} onClick={()=>void load()}>Voltar ao início</button>}
      </div>
    </dialog>,document.body)}
  </>;
}
