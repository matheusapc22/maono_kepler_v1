import {useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router';
import {StaticLoadingText} from '../../../components/loading/Skeleton';
import {api,denied,errorText,dateLabel} from './organizations-api';
import {Notice} from './OrganizationDialogs';

const CONFIRMATION='EXCLUIR PERMANENTEMENTE';
type Deletion={id:string;organizationId:number;state:'pending'|'storage_deleted'|'completed';retryable:boolean;errorCode:string|null;notBefore?:string};
type Preview={organizationId:number;name:string;version:number;eligible:boolean;blockers:{code:string;count:number}[];confirmation:string};
const blockerLabels:Record<string,string>={
  PAUSE_REQUIRED:'Pause a organização antes de excluir',STORAGE_NOT_SETTLED:'Armazenamento ainda não estabilizado',
  UNGUARDED_DEPENDENCY:'O esquema de dados exige revisão antes da exclusão',LINKED_DATA:'Dados vinculados, inclusive inativos ou históricos',
  UNRESOLVED_OPERATION:'Operação pendente de conclusão',DELETION_IN_PROGRESS:'Já existe uma exclusão em andamento; retome pelo endereço salvo',
  STORAGE_DRAIN_REQUIRED:'Aguarde o encerramento das operações de armazenamento após a pausa',
  ORGANIZATION_DELETE_UNSAFE_PATH:'A pasta não pôde ser confirmada como segura',ORGANIZATION_DELETE_SHARED_PATH:'A pasta não pertence exclusivamente à organização',
  ORGANIZATION_HAS_PROJECTS:'Projetos vinculados',ORGANIZATION_HAS_FILES:'Arquivos vinculados',
  ORGANIZATION_HAS_TICKETS:'Chamados vinculados',ORGANIZATION_ACTIVE:'Pause a organização antes de excluir',
  ORGANIZATION_STORAGE_NOT_READY:'Armazenamento não está pronto',ORGANIZATION_STORAGE_UNSAFE:'A pasta não pôde ser confirmada como exclusiva',
};

/** No mutation on mount. URL stores only recovery identifiers, never the phrase or document data. */
export function OrganizationDeletionPanel({organizationId,onBusy,onDenied,onComplete,onCancel}:{organizationId:number;onBusy:(value:boolean)=>void;onDenied:()=>void;onComplete:()=>void;onCancel:()=>void}){
  const [params,setParams]=useSearchParams();
  const operationId=params.get('org_deletion'),requestKey=params.get('org_delete_key');
  const [preview,setPreview]=useState<Preview|null>(null),[deletion,setDeletion]=useState<Deletion|null>(null);
  const [confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[uncertain,setUncertain]=useState(Boolean(operationId||requestKey));
  const panel=useRef<HTMLElement|null>(null);
  const controller=useRef<AbortController|null>(null),mounted=useRef(true),submitting=useRef(false),complete=useRef(false);
  const callbacks=useRef({onBusy,onDenied,onComplete});callbacks.current={onBusy,onDenied,onComplete};
  // Snapshot recovery coordinates for this mounted organization; URL changes caused by this panel do not restart requests.
  const initial=useRef({operationId,requestKey});
  const knownId=useRef(operationId),key=useRef(requestKey);
  useEffect(()=>{mounted.current=true;panel.current?.focus();return()=>{mounted.current=false;controller.current?.abort();callbacks.current.onBusy(false);};},[]);
  function remember(id:string|null,nextKey:string|null){
    if(id)knownId.current=id;if(nextKey)key.current=nextKey;
    setParams(previous=>{const next=new URLSearchParams(previous);if(id)next.set('org_deletion',id);if(nextKey)next.set('org_delete_key',nextKey);return next;},{replace:true});
  }
  const observe=useCallback((value:Deletion)=>{
    if(value.organizationId!==organizationId)throw new Error('A operação retornada não corresponde à organização.');
    knownId.current=value.id;setDeletion(value);setUncertain(false);
    if(value.state==='completed'&&!complete.current){complete.current=true;callbacks.current.onComplete();}
  },[organizationId]);
  const readExisting=useCallback(async(signal:AbortSignal):Promise<Deletion|null>=>{
    if(knownId.current)return (await api<{deletion:Deletion}>(`/deletions/${encodeURIComponent(knownId.current)}`,{signal,timeoutMs:15000})).deletion;
    if(key.current)return (await api<{deletion:Deletion|null}>(`/deletions/by-key?key=${encodeURIComponent(key.current)}`,{signal,timeoutMs:15000})).deletion;
    return null;
  },[]);
  useEffect(()=>{
    const c=new AbortController();controller.current=c;
    void(async()=>{
      try{
        if(initial.current.operationId||initial.current.requestKey){
          const existing=await readExisting(c.signal);
          if(c.signal.aborted||!mounted.current)return;
          if(existing){observe(existing);return;}
          // A missing response is not proof that an in-flight start never persisted.
          setUncertain(true);
        }
        const result=await api<Preview>(`/organizations/${organizationId}/deletion-preview`,{signal:c.signal,timeoutMs:15000});
        if(!c.signal.aborted&&mounted.current){if(result.organizationId!==organizationId||result.confirmation!==CONFIRMATION)throw new Error('Prévia de exclusão inválida.');setPreview(result);}
      }catch(e){if(!c.signal.aborted&&mounted.current){if(denied(e))callbacks.current.onDenied();setError(errorText(e));}}
      finally{if(!c.signal.aborted&&mounted.current)setLoading(false);}
    })();
    return()=>c.abort();
    // This panel is keyed by organizationId. URL recovery writes must not replay the effect.
  },[organizationId,observe,readExisting]);
  async function run(){
    if(submitting.current||loading)return;
    if(!knownId.current&&(!preview?.eligible||confirmation!==CONFIRMATION))return;
    submitting.current=true;setBusy(true);callbacks.current.onBusy(true);setError('');
    const c=new AbortController();controller.current?.abort();controller.current=c;
    try{
      // Always observe after a timeout/reload before attempting another mutation.
      let value=await readExisting(c.signal);
      if(!value){
        if(!preview?.eligible||confirmation!==CONFIRMATION)throw new Error('Revise a prévia e a confirmação antes de continuar.');
        const requestId=key.current||crypto.randomUUID();remember(null,requestId);setUncertain(true);
        value=(await api<{deletion:Deletion}>(`/organizations/${organizationId}/permanent-delete`,{body:{version:preview.version,confirmation},key:requestId,signal:c.signal,timeoutMs:20000})).deletion;
      }
      if(c.signal.aborted||!mounted.current)return;
      if(value.organizationId!==organizationId)throw new Error('A operação não corresponde à organização.');
      remember(value.id,key.current);observe(value);
      // Bounded progression. Only explicit user action resumes an unfinished/failed operation.
      for(let step=0;step<2&&value.state!=='completed';step++){
        if(value.errorCode&&!value.retryable)break;
        value=(await api<{deletion:Deletion}>(`/deletions/${encodeURIComponent(value.id)}/step`,{body:{},signal:c.signal,timeoutMs:20000})).deletion;
        if(c.signal.aborted||!mounted.current)return;
        observe(value);if(value.errorCode)break;
      }
    }catch(e){if(!c.signal.aborted&&mounted.current){setUncertain(true);if(denied(e))callbacks.current.onDenied();setError('Não foi possível confirmar a conclusão. Consulte e retome a mesma exclusão antes de iniciar outra. '+errorText(e));}}
    finally{submitting.current=false;if(mounted.current){setBusy(false);callbacks.current.onBusy(false);}}
  }
  async function consult(){
    if(submitting.current)return;submitting.current=true;setBusy(true);callbacks.current.onBusy(true);setError('');
    const c=new AbortController();controller.current?.abort();controller.current=c;
    try{const value=await readExisting(c.signal);if(!c.signal.aborted&&mounted.current){if(value){remember(value.id,key.current);observe(value);}else setError('Ainda não há confirmação da operação. Revise a prévia e use a mesma confirmação para tentar novamente com a mesma chave.');}}
    catch(e){if(!c.signal.aborted&&mounted.current){if(denied(e))callbacks.current.onDenied();setError(errorText(e));}}
    finally{submitting.current=false;if(mounted.current){setBusy(false);callbacks.current.onBusy(false);}}
  }
  return <section ref={panel} tabIndex={-1} className="aog-deletion-panel" aria-label="Confirmação de exclusão permanente" aria-busy={busy||loading}>
    <Notice message={error}/>
    {loading&&<p role="status">Verificando dependências e segurança da exclusão…</p>}
    {preview&&<><p><strong>{preview.name}</strong> · organização #{organizationId}</p><p>Esta ação remove o cadastro e a pasta exclusiva da organização no Dropbox. Organizações com dados vinculados não podem ser excluídas por este fluxo. As contas de usuários e o histórico de auditoria são preservados.</p>
      <p>Não há opção de desfazer na aplicação. Histórico e backups do Dropbox continuam sujeitos à retenção do serviço.</p>
      {!preview.eligible&&<><p role="status">Exclusão bloqueada. Resolva as dependências antes de abrir uma nova confirmação.</p><ul className="aog-records">{preview.blockers.map((blocker,index)=><li key={`${blocker.code}:${index}`}>{blockerLabels[blocker.code]||'Dependência ou condição de segurança pendente'}{blocker.count>0?` (${blocker.count})`:''}<small>Referência: {blocker.code}</small></li>)}</ul></>}
      {!deletion&&preview.eligible&&<label className="aog-form">Digite EXCLUIR PERMANENTEMENTE<input autoComplete="off" spellCheck={false} value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} aria-describedby="organization-deletion-exact-help"/><small id="organization-deletion-exact-help">Use exatamente as letras maiúsculas e o espaço indicado, sem espaços extras.</small></label>}
    </>}
    {deletion&&<><p>Operação <code>{deletion.id}</code> · organização #{deletion.organizationId}</p><p role="status">{deletion.errorCode==='ORGANIZATION_DELETE_DRAINING'?`Aguardando ${deletion.notBefore?'até '+dateLabel(deletion.notBefore):'dois minutos'} para encerrar operações de armazenamento em andamento. A pasta ainda não foi removida. `:deletion.state==='storage_deleted'?'Pasta removida do Dropbox. Finalização no banco ainda pendente.':deletion.state==='completed'?'Exclusão concluída.':'Exclusão iniciada. A conclusão ainda não foi confirmada.'}</p>{deletion.errorCode&&deletion.errorCode!=='ORGANIZATION_DELETE_DRAINING'&&<Notice message={`A operação precisa de ${deletion.retryable?'nova tentativa':'verificação administrativa'}. Referência: ${deletion.errorCode}`}/>}</>}
    {(deletion||uncertain)&&<p>Fechar este painel não cancela etapas já enviadas. Guarde este endereço para consultar e retomar a mesma operação. Nenhuma nova etapa será enviada automaticamente ao reabrir.</p>}
    <div className="aog-danger-zone">
      {!deletion&&!uncertain&&<button type="button" disabled={busy} onClick={onCancel}>Cancelar</button>}
      {uncertain&&<button type="button" disabled={busy||loading} onClick={()=>void consult()}>Consultar exclusão</button>}
      {deletion?deletion.state!=='completed'&&(!deletion.errorCode||deletion.retryable)&&<button type="button" className="aog-destructive" disabled={busy||loading} onClick={()=>void run()}><StaticLoadingText pending={busy}>Retomar exclusão</StaticLoadingText></button>:preview?.eligible&&<button type="button" className="aog-destructive" disabled={busy||loading||confirmation!==CONFIRMATION} onClick={()=>void run()}><StaticLoadingText pending={busy}>{uncertain?'Retomar com a mesma confirmação':'Confirmar exclusão permanente'}</StaticLoadingText></button>}
    </div>
  </section>;
}
