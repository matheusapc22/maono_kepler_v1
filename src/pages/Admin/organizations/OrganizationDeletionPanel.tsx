import {useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router';
import {UniversalLoader} from '../../../components/loading/UniversalLoader';
import {StaticLoadingText} from '../../../components/loading/Skeleton';
import {api,denied,errorText,dateLabel} from './organizations-api';

const CONFIRMATION='EXCLUIR PERMANENTEMENTE';
type Deletion={id:string;organizationId:number;state:'pending'|'storage_deleted'|'completed';retryable:boolean;errorCode:string|null;notBefore?:string;automatic?:boolean;automaticPaused?:boolean;automaticBlocked?:boolean};
type Preview={organizationId:number;name:string;version:number;eligible:boolean;blockers:{code:string;count:number}[];confirmation:string};
const blockerLabels:Record<string,string>={
  MIXED_SCOPE_PERMISSION:'Permissões vinculadas também a projetos exigem revisão antes da exclusão',
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
  const [dismissedError,setDismissedError]=useState('');
  const [pollError,setPollError]=useState(''),[pollRevision,setPollRevision]=useState(0);
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
    knownId.current=value.id;setDeletion(value);setUncertain(false);setPollError('');
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
  // Polling is observation only: the durable server worker owns progression, even after this panel closes.
  const automatic=deletion?.automatic===true;
  const following=automatic&&!deletion?.automaticPaused&&!deletion?.automaticBlocked&&deletion?.state!=='completed';
  useEffect(()=>{
    if(!following||busy||loading)return;
    const c=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,failures=0;
    async function poll(){
      try{
        const value=await readExisting(c.signal);
        if(c.signal.aborted||!mounted.current)return;
        if(!value)throw new Error('Operação ainda não localizada.');
        observe(value);failures=0;
        if(value.state==='completed'||value.automatic!==true||value.automaticPaused||value.automaticBlocked)return;
      }catch(e){
        if(c.signal.aborted||!mounted.current)return;
        if(denied(e)){callbacks.current.onDenied();return;}
        failures++;
        setPollError('Não foi possível atualizar o acompanhamento. Isso não confirma falha da exclusão. '+(failures>=3?'Atualização automática interrompida após três falhas. Use Consultar exclusão para verificar novamente. ':'')+errorText(e));
        if(failures>=3)return;
      }
      timer=setTimeout(()=>void poll(),5000);
    }
    timer=setTimeout(()=>void poll(),5000);
    return()=>{c.abort();if(timer)clearTimeout(timer);};
  },[following,busy,loading,pollRevision,observe,readExisting]);
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
      // Automatic operations are owned by the server; never send competing steps from this panel.
      if(value.automatic)return;
      // Legacy/manual operations retain explicit recovery.
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
    finally{submitting.current=false;if(mounted.current){setBusy(false);callbacks.current.onBusy(false);setPollRevision(v=>v+1);}}
  }
  // A spinner represents observed active work, never a paused, blocked or unobservable operation.
  const operationError=deletion?.errorCode&&deletion.errorCode!=='ORGANIZATION_DELETE_DRAINING'&&(!automatic||deletion.automaticBlocked)?`A operação precisa de ${deletion.retryable?'nova tentativa':'verificação administrativa'}. Referência: ${deletion.errorCode}`:'';
  const visibleError=[error,pollError,operationError].filter(Boolean).join(' ');
  useEffect(()=>{if(!visibleError){setDismissedError('');return;}setDismissedError('');const timer=setTimeout(()=>setDismissedError(visibleError),10000);return()=>clearTimeout(timer);},[visibleError,busy]);
  const showProgress=(loading||busy||following)&&!visibleError;
  const compactProgress=showProgress&&(busy||Boolean(deletion));
  return <section ref={panel} tabIndex={-1} className="aog-deletion-panel" aria-label="Confirmação de exclusão permanente" aria-busy={busy||loading}>
    {visibleError&&dismissedError!==visibleError&&<div role="alert" className="aog-deletion-error-toast"><span>{visibleError}</span><button type="button" aria-label="Fechar aviso de erro" onClick={()=>setDismissedError(visibleError)}>×</button></div>}
    {visibleError&&<p role="status">A conclusão não foi confirmada. Consulte a mesma exclusão para verificar o estado e as opções de recuperação.</p>}
    {showProgress&&<div className="aog-deletion-progress">
      <UniversalLoader size="page" accessibleLabel={loading?'Verificando exclusão':busy&&!deletion?'Enviando solicitação de exclusão':'Exclusão em andamento'}/>
    </div>}
    {preview&&!deletion&&!compactProgress&&<><p><strong>{preview.name}</strong> · organização #{organizationId}</p><p>Esta ação remove o cadastro e a pasta exclusiva da organização no Dropbox. Organizações com dados vinculados não podem ser excluídas por este fluxo. As contas de usuários e o histórico de auditoria são preservados.</p>
      <p>Não há opção de desfazer na aplicação. Histórico e backups do Dropbox continuam sujeitos à retenção do serviço.</p>
      {!preview.eligible&&<><p role="status">Exclusão bloqueada. Resolva as dependências antes de abrir uma nova confirmação.</p><ul className="aog-records">{preview.blockers.map((blocker,index)=><li key={`${blocker.code}:${index}`}>{blockerLabels[blocker.code]||'Dependência ou condição de segurança pendente'}{blocker.count>0?` (${blocker.count})`:''}<small>Referência: {blocker.code}</small></li>)}</ul></>}
      {!deletion&&preview.eligible&&<label className="aog-form">Digite EXCLUIR PERMANENTEMENTE<input autoComplete="off" spellCheck={false} value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} aria-describedby="organization-deletion-exact-help"/><small id="organization-deletion-exact-help">Use exatamente as letras maiúsculas e o espaço indicado, sem espaços extras.</small></label>}
    </>}
    {deletion&&!compactProgress&&<><p>Operação <code>{deletion.id}</code> · organização #{deletion.organizationId}</p><p role="status">{deletion.errorCode==='ORGANIZATION_DELETE_DRAINING'?`Aguardando ${deletion.notBefore?'até '+dateLabel(deletion.notBefore):'dois minutos'} para encerrar operações de armazenamento em andamento. A pasta ainda não foi removida. `:deletion.state==='storage_deleted'?'Pasta removida do Dropbox. Finalização no banco ainda pendente.':deletion.state==='completed'?'Exclusão concluída.':'Exclusão iniciada. A conclusão ainda não foi confirmada.'}</p></>}
    {automatic&&!compactProgress&&deletion?.state!=='completed'&&<p role="status">{deletion.automaticPaused?'Execução automática pausada pelo administrador. Consulte o andamento; não é necessário iniciar outra exclusão.':deletion.automaticBlocked?'A execução automática foi interrompida para verificação administrativa. Não inicie outra exclusão.':'Solicitação registrada para execução automática no servidor após a espera de segurança. Você pode fechar este painel; não é necessário iniciar outra exclusão. A conclusão ainda depende da confirmação do servidor.'}</p>}
    {(deletion||uncertain)&&!automatic&&!compactProgress&&<p>Fechar este painel não cancela etapas já enviadas. Guarde este endereço para consultar e retomar a mesma operação. Nenhuma nova etapa será enviada automaticamente ao reabrir.</p>}
    <div className="aog-danger-zone" hidden={compactProgress}>
      {!deletion&&!uncertain&&<button type="button" disabled={busy} onClick={onCancel}>Cancelar</button>}
      {(uncertain||(automatic&&!compactProgress))&&<button type="button" disabled={busy||loading} onClick={()=>void consult()}>Consultar exclusão</button>}
      {deletion?deletion.state!=='completed'&&!automatic&&(!deletion.errorCode||deletion.retryable)&&<button type="button" className="aog-destructive" disabled={busy||loading} onClick={()=>void run()}><StaticLoadingText pending={busy}>Retomar exclusão</StaticLoadingText></button>:preview?.eligible&&<button type="button" className="aog-destructive" disabled={busy||loading||confirmation!==CONFIRMATION} onClick={()=>void run()}><StaticLoadingText pending={busy}>{uncertain?'Retomar com a mesma confirmação':'Confirmar exclusão permanente'}</StaticLoadingText></button>}
    </div>
  </section>;
}
