import { useEffect, useState } from 'react';
import { requestJson } from '../../../lib/api-transport';
import TicketErrorNotice from './TicketErrorNotice';
import { toTicketApiError } from './tickets-api';
type Operations = {deliveries:{state:string;total:number}[];metrics:{status:string;total:number;oldest:string;attempts:number}[];failures:{id:string;attempts:number;error:string;created_at:string}[]};
export default function TicketNotificationOperations({path}:{path:string}) {
  const [data,setData]=useState<Operations|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null);
  useEffect(()=>{
    const controller=new AbortController();
    void requestJson<Operations>(`${path}/operations`,{signal:controller.signal}).then(setData).catch(cause=>{if(!controller.signal.aborted)setError(cause);});
    return()=>controller.abort();
  },[path]);
  async function retry(id:string){
    setBusy(true);setError(null);
    try {
      await requestJson(`${path}/operations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outboxId:id})});
      setData(await requestJson<Operations>(`${path}/operations`));
    }catch(cause){setError(cause);}finally{setBusy(false);}
  }
  return <details><summary>Operação de notificações</summary>
    {error!=null && <TicketErrorNotice error={toTicketApiError(error)} />}
    <ul>{data?.metrics.map(m=><li key={m.status}>{m.status}: {m.total} · Tentativas: {m.attempts} · Mais antiga: {m.oldest}</li>)}</ul>
    <ul>{data?.deliveries.map(d=><li key={d.state}>{d.state}: {d.total}</li>)}</ul>
    {data?.failures.length===0 && <p>Nenhuma falha aguardando reprocessamento.</p>}
    <ul>{data?.failures.map(f=><li key={f.id}>Falha {f.id} · {f.attempts} tentativas
      <button type="button" disabled={busy} onClick={()=>void retry(f.id)}>Reprocessar</button>
    </li>)}</ul>
  </details>;
}
