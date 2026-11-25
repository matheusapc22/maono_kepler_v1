import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router';
import {api,denied,errorText,dateLabel,ManagementApiError} from './organizations-api';
import {DELETION_CONFIRMATION,isDeletionPreview,type DeletionPreview,type DeletionBlockerAction} from './organization-deletion-contract';
import {OrganizationBlockerResolver} from './OrganizationBlockerResolver';

const CONFIRMATION=DELETION_CONFIRMATION;
type Deletion={id:string;organizationId:number;state:'pending'|'storage_deleted'|'completed';retryable:boolean;errorCode:string|null;notBefore?:string;automatic?:boolean;automaticPaused?:boolean;automaticBlocked?:boolean};
type Presentation={preview:DeletionPreview|null;deletion:Deletion|null;uncertain:boolean;error:string;previewStale:boolean};
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
export function OrganizationDeletionPanel({organizationId,initialPreview,onBusy,onLoading,onError,onDenied,onComplete,onCancel,cleanReports=false,onAudit,onResolverAction}:{organizationId:number;initialPreview?:DeletionPreview;onBusy:(value:boolean)=>void;onLoading?:(value:boolean,label:string)=>void;onError?:(message:string)=>void;onDenied:()=>void;onComplete:()=>void;onCancel:()=>void;cleanReports?:boolean;onAudit?:(operationId:string)=>void;onResolverAction?:(action:DeletionBlockerAction)=>void}){
  const [params,setParams]=useSearchParams();
  const operationId=params.get('org_deletion'),requestKey=params.get('org_delete_key');
  const prepared = !operationId && !requestKey && isDeletionPreview(initialPreview,organizationId) ? initialPreview : null;
  const [preview,setPreview]=useState<DeletionPreview|null>(prepared),[deletion,setDeletion]=useState<Deletion|null>(null);
  const [confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(!prepared),[uncertain,setUncertain]=useState(Boolean(operationId||requestKey));
  const [previewStale,setPreviewStale]=useState(false);
  const [resolverOpen,setResolverOpen]=useState(false);
  const [dismissedError,setDismissedError]=useState('');
  const [pollError,setPollError]=useState(''),[pollRevision,setPollRevision]=useState(0);
  const controller=useRef<AbortController|null>(null),mounted=useRef(true),submitting=useRef(false),complete=useRef(false);
  const callbacks=useRef({onBusy,onLoading,onError,onDenied,onComplete});callbacks.current={onBusy,onLoading,onError,onDenied,onComplete};
  // Snapshot recovery coordinates for this mounted organization; URL changes caused by this panel do not restart requests.
  const initial=useRef({operationId,requestKey,preview:prepared});
  const knownId=useRef(operationId),key=useRef(requestKey);
  const settledPresentation=useRef<Presentation>({preview:prepared,deletion:null,uncertain:Boolean(operationId||requestKey),error:'',previewStale:false});
  useEffect(()=>{
    mounted.current=true;
    return()=>{
      mounted.current=false;
      controller.current?.abort();
      callbacks.current.onBusy(false);
      callbacks.current.onError?.('');
    };
  },[]);
  // Clear the old dialog activity before a replacement panel's layout effects.
  useLayoutEffect(()=>()=>callbacks.current.onLoading?.(false,''),[]);
  function remember(id:string|null,nextKey:string|null){
    if(id)knownId.current=id;if(nextKey)key.current=nextKey;
    setParams(previous=>{const next=new URLSearchParams(previous);if(id)next.set('org_deletion',id);if(nextKey)next.set('org_delete_key',nextKey);return next;},{replace:true});
  }
  const observe=useCallback((value:Deletion)=>{
    if(!value || value.organizationId!==organizationId || typeof value.id!=='string' || !value.id || !['pending','storage_deleted','completed'].includes(value.state))throw new Error('A operação retornada não corresponde à organização.');
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
        if(initial.current.preview)return;
        if(initial.current.operationId||initial.current.requestKey){
          const existing=await readExisting(c.signal);
          if(c.signal.aborted||!mounted.current)return;
          if(existing){observe(existing);return;}
          // A missing response is not proof that an in-flight start never persisted.
          setUncertain(true);
        }
        const result=await api<unknown>(`/organizations/${organizationId}/deletion-preview`,{signal:c.signal,timeoutMs:15000});
        if(!c.signal.aborted&&mounted.current){if(!isDeletionPreview(result,organizationId))throw new Error('Prévia de exclusão inválida.');setPreview(result);}
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
    if(!knownId.current&&(previewStale||!preview?.eligible||confirmation!==CONFIRMATION))return;
    submitting.current=true;setBusy(true);callbacks.current.onBusy(true);setError('');setPollError('');
    const c=new AbortController();controller.current?.abort();controller.current=c;
    try{
      // Always observe after a timeout/reload before attempting another mutation.
      let value=await readExisting(c.signal);
      if(!value){
        if(knownId.current)throw new Error('A operação registrada não pôde ser consultada. Consulte novamente a mesma exclusão.');
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
    }catch(e){
      if(!c.signal.aborted&&mounted.current){
        if(denied(e))callbacks.current.onDenied();
        // These server rejections happen before creating a deletion. Refresh only
        // the preview; an uncertain network result must retain its recovery key.
        const stale = !knownId.current && e instanceof ManagementApiError
          && ['ORGANIZATION_VERSION_CONFLICT','ORGANIZATION_DELETE_BLOCKED'].includes(e.code||'');
        setPreviewStale(stale);
        setUncertain(!stale);
        setError(stale ? errorText(e) : 'Não foi possível confirmar a conclusão. Consulte e retome a mesma exclusão antes de iniciar outra. '+errorText(e));
      }
    }
    finally{submitting.current=false;if(mounted.current){setBusy(false);callbacks.current.onBusy(false);}}
  }
  async function consult(){
    if(submitting.current)return;submitting.current=true;setBusy(true);callbacks.current.onBusy(true);setError('');setPollError('');
    const c=new AbortController();controller.current?.abort();controller.current=c;
    try{const value=await readExisting(c.signal);if(!c.signal.aborted&&mounted.current){if(value){remember(value.id,key.current);observe(value);}else setError('Ainda não há confirmação da operação. Revise a prévia e use a mesma confirmação para tentar novamente com a mesma chave.');}}
    catch(e){if(!c.signal.aborted&&mounted.current){if(denied(e))callbacks.current.onDenied();setError(errorText(e));}}
    finally{submitting.current=false;if(mounted.current){setBusy(false);callbacks.current.onBusy(false);setPollRevision(v=>v+1);}}
  }
  async function refreshPreview(){
    if(submitting.current||loading)return;
    const rejectedBeforeStart=previewStale;
    submitting.current=true;setBusy(true);callbacks.current.onBusy(true);setError('');
    const c=new AbortController();controller.current?.abort();controller.current=c;
    try{
      // Never read the deleted entity when the same key already has an operation.
      const existing=await readExisting(c.signal);
      if(c.signal.aborted||!mounted.current)return;
      if(existing){remember(existing.id,key.current);observe(existing);return;}
      const result=await api<unknown>(`/organizations/${organizationId}/deletion-preview`,{signal:c.signal,timeoutMs:15000});
      if(c.signal.aborted||!mounted.current)return;
      if(!isDeletionPreview(result,organizationId))throw new Error('Prévia de exclusão inválida.');
      setPreview(result);setPreviewStale(false);setUncertain(Boolean(key.current)&&!rejectedBeforeStart);
    }catch(e){if(!c.signal.aborted&&mounted.current){if(denied(e))callbacks.current.onDenied();setError(errorText(e));}}
    finally{submitting.current=false;if(mounted.current){setBusy(false);callbacks.current.onBusy(false);}}
  }
  // A spinner represents observed active work, never a paused, blocked or unobservable operation.
  const operationError=deletion?.errorCode&&deletion.errorCode!=='ORGANIZATION_DELETE_DRAINING'&&(!automatic||deletion.automaticBlocked)
    ?cleanReports?'Não foi possível confirmar a conclusão da exclusão. Consulte o resultado e as opções disponíveis na Auditoria.'
      :`A operação precisa de ${deletion.retryable?'nova tentativa':'verificação administrativa'}. Referência: ${deletion.errorCode}`:'';
  const visibleError=[error,pollError,operationError].filter(Boolean).join(' ');
  const activeError = busy || loading ? '' : visibleError;
  useEffect(()=>{callbacks.current.onError?.(activeError);},[activeError]);
  useEffect(()=>{if(onError||!activeError){setDismissedError('');return;}setDismissedError('');const timer=setTimeout(()=>setDismissedError(activeError),10000);return()=>clearTimeout(timer);},[activeError,onError]);
  const showProgress=loading||busy||(following&&!visibleError);
  const loadingLabel=loading?'Verificando exclusão':busy&&!deletion?'Enviando solicitação de exclusão':'Exclusão em andamento';
  useLayoutEffect(()=>{callbacks.current.onLoading?.(showProgress,loadingLabel);},[showProgress,loadingLabel]);
  // Operation data may advance several times while the original form stays put.
  // Also retain that form after completed while the parent prepares its destination.
  const preservePresentation=showProgress||complete.current;
  const presentation=preservePresentation?settledPresentation.current:{preview,deletion,uncertain,error:visibleError,previewStale};
  useLayoutEffect(()=>{
    if(!preservePresentation)settledPresentation.current={preview,deletion,uncertain,error:visibleError,previewStale};
  },[preservePresentation,preview,deletion,uncertain,visibleError,previewStale]);
  const shownPreview=presentation.preview,shownDeletion=presentation.deletion;
  const shownAutomatic=shownDeletion?.automatic===true;
  const controlsBusy=showProgress||complete.current;
  return <section className="aog-deletion-panel" aria-label="Confirmação de exclusão permanente" aria-busy={showProgress}>
    {!onError&&activeError&&dismissedError!==activeError&&<div role="alert" className="aog-deletion-error-toast"><span>{activeError}</span><button type="button" aria-label="Fechar aviso de erro" onClick={()=>setDismissedError(activeError)}>×</button></div>}
    {!cleanReports&&presentation.error&&<p role="status">{presentation.previewStale?'Revise a prévia atual antes de confirmar novamente.':'A conclusão não foi confirmada. Consulte a mesma exclusão para verificar o estado e as opções de recuperação.'}</p>}
    {shownPreview&&<><p><strong>{shownPreview.name}</strong>{!cleanReports&&` · organização #${organizationId}`}</p><p>Esta ação remove o cadastro e a pasta exclusiva da organização no Dropbox. Organizações com dados vinculados não podem ser excluídas por este fluxo. As contas de usuários e o histórico de auditoria são preservados.</p>
      <p>Não há opção de desfazer na aplicação. Histórico e backups do Dropbox continuam sujeitos à retenção do serviço.</p>
      {cleanReports&&!shownPreview.eligible&&<button type="button" disabled={controlsBusy} onClick={()=>setResolverOpen(true)}>Resolver impedimentos ({shownPreview.blockers.length})</button>}
      {!cleanReports&&!shownPreview.eligible&&<><p role="status">Exclusão bloqueada. Resolva as dependências antes de abrir uma nova confirmação.</p><ul className="aog-records">{shownPreview.blockers.map((blocker,index)=><li key={`${blocker.code}:${index}`}>{blockerLabels[blocker.code]||'Dependência ou condição de segurança pendente'}{blocker.count>0?` (${blocker.count})`:''}<small>Referência: {blocker.code}</small></li>)}</ul></>}
      {shownPreview.eligible&&<label className="aog-form">Digite EXCLUIR PERMANENTEMENTE<input autoComplete="off" spellCheck={false} value={confirmation} disabled={controlsBusy||Boolean(deletion)} onChange={e=>setConfirmation(e.target.value)} aria-describedby="organization-deletion-exact-help"/><small id="organization-deletion-exact-help">Use exatamente as letras maiúsculas e o espaço indicado, sem espaços extras.</small></label>}
    </>}
    {!cleanReports&&shownDeletion&&<><p>Operação <code>{shownDeletion.id}</code> · organização #{shownDeletion.organizationId}</p><p role="status">{shownDeletion.errorCode==='ORGANIZATION_DELETE_DRAINING'?`Aguardando ${shownDeletion.notBefore?'até '+dateLabel(shownDeletion.notBefore):'dois minutos'} para encerrar operações de armazenamento em andamento. A pasta ainda não foi removida. `:shownDeletion.state==='storage_deleted'?'Pasta removida do Dropbox. Finalização no banco ainda pendente.':shownDeletion.state==='completed'?'Exclusão concluída.':'Exclusão iniciada. A conclusão ainda não foi confirmada.'}</p></>}
    {!cleanReports&&shownAutomatic&&shownDeletion?.state!=='completed'&&<p role="status">{shownDeletion?.automaticPaused?'Execução automática pausada pelo administrador. Consulte o andamento; não é necessário iniciar outra exclusão.':shownDeletion?.automaticBlocked?'A execução automática foi interrompida para verificação administrativa. Não inicie outra exclusão.':'Solicitação registrada para execução automática no servidor após a espera de segurança. Você pode fechar este painel; não é necessário iniciar outra exclusão. A conclusão ainda depende da confirmação do servidor.'}</p>}
    {!cleanReports&&(shownDeletion||presentation.uncertain)&&!shownAutomatic&&<p>Fechar este painel não cancela etapas já enviadas. Guarde este endereço para consultar e retomar a mesma operação. Nenhuma nova etapa será enviada automaticamente ao reabrir.</p>}
    {cleanReports&&shownDeletion&&onAudit&&<button type="button" disabled={controlsBusy} onClick={()=>onAudit(shownDeletion.id)}>Ver detalhes na Auditoria</button>}
    {cleanReports&&resolverOpen&&<OrganizationBlockerResolver embedded preview={shownPreview} name={shownPreview?.name||'Organização'} busy={controlsBusy} onClose={()=>setResolverOpen(false)} onRefresh={()=>void refreshPreview()} onAction={selectedAction=>{
      if(!selectedAction.enabled)return;
      if(selectedAction.deletionId){remember(selectedAction.deletionId,null);setResolverOpen(false);void consult();}
      else if(selectedAction.operationId||selectedAction.kind==='pause'){onResolverAction?.(selectedAction);}
      else if(selectedAction.kind==='query'||selectedAction.kind==='follow')void refreshPreview();
    }}/>}
    <div className="aog-danger-zone">
      {!shownDeletion&&!presentation.uncertain&&<button type="button" disabled={controlsBusy} onClick={onCancel}>Cancelar</button>}
      {(presentation.uncertain||shownAutomatic)&&<button type="button" disabled={controlsBusy} onClick={()=>void consult()}>Consultar exclusão</button>}
      {!shownDeletion&&(presentation.previewStale||(!shownPreview&&presentation.error))&&<button type="button" disabled={controlsBusy} onClick={()=>void refreshPreview()}>Consultar prévia atual</button>}
      {shownDeletion?shownDeletion.state!=='completed'&&!shownAutomatic&&(!shownDeletion.errorCode||shownDeletion.retryable)&&<button type="button" className="aog-destructive" disabled={controlsBusy} onClick={()=>void run()}>Retomar exclusão</button>:shownPreview?.eligible&&<button type="button" className="aog-destructive" disabled={controlsBusy||previewStale||Boolean(deletion)||confirmation!==CONFIRMATION} onClick={()=>void run()}>{presentation.uncertain?'Retomar com a mesma confirmação':'Confirmar exclusão permanente'}</button>}
    </div>
  </section>;
}
