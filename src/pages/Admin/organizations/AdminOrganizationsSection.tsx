import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Link,useLocation,useNavigate,useSearchParams} from 'react-router';
import {useSession} from '../../../auth/session.ts';
import {MaonoSelect} from '../../../components/selection/MaonoSelect';
import AdminIcon from '../components/AdminIcon';
import {api,denied,download,errorText,dateLabel,safeCell,storageLabel} from './organizations-api';
import {OrganizationDeletionPanel} from './OrganizationDeletionPanel';
import {CreateForm} from './CreateOrganizationForm';
import {UniversalLoader} from '../../../components/loading/UniversalLoader';
import {Dialog,Notice,OperationStatus,OrganizationEditor,RequestList} from './OrganizationDialogs';
import {PLAN_LABELS,type Detail,type Operation,type OperationInput,type Organization,type Query,type Workspace} from './organizations-types';
import './admin-organizations.css';

// Ephemeral, single-use proof; editable history state alone cannot fabricate success.
let completedDeletionReceipt:{nonce:string;actorId:string|number}|null=null;
const dialogTitles:Record<string,string>={create:'Nova organização',requests:'Solicitações de plano e limites',bulk:'Ações em lote',operations:'Minhas operações',operation:'Resultado da operação'};
const initial=(p:URLSearchParams):Query=>({q:p.get('org_q')||'',status:p.get('org_status')||'all',plan:p.get('org_plan')||'all',sort:p.get('org_sort')||'newest',page:Number(p.get('org_page'))||1,size:Number(p.get('org_size'))||10});
export default function AdminOrganizationsSection(){
  const [params,setParams]=useSearchParams(),navigate=useNavigate(),location=useLocation(),{switchOrganization,refreshSession,user,health,authenticated}=useSession();
  const queryKey=JSON.stringify(initial(params)),query=useMemo<Query>(()=>JSON.parse(queryKey),[queryKey]);
  const [draft,setDraft]=useState(query),[workspace,setWorkspace]=useState<Workspace|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[blocked,setBlocked]=useState(false),[revision,setRevision]=useState(0),[selected,setSelected]=useState<Set<number>>(()=>new Set());
  const [header,setHeader]=useState<HTMLElement|null>(null),[detail,setDetail]=useState<Detail|null>(null),[detailError,setDetailError]=useState(''),[detailLoading,setDetailLoading]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [operation,setOperation]=useState<Operation|null>(null),[operationError,setOperationError]=useState(''),[busy,setBusy]=useState(false),[history,setHistory]=useState<{id:string;kind:string;createdAt:string}[]>([]);
  const [bulkKind,setBulkKind]=useState<'pause'|'resume'>('pause'),[reason,setReason]=useState('');
  const [creationPending,setCreationPending]=useState(false),[success,setSuccess]=useState('');
  // A completed server response survives the session refresh without a URL success flag.
  useEffect(()=>{const receipt=location.state?.organizationDeletionReceipt;if(!receipt)return;
    const verified=completedDeletionReceipt;completedDeletionReceipt=null;
    if(authenticated&&verified&&receipt===verified.nonce&&user?.role==='super_admin'&&verified.actorId===user.id)setSuccess('Organização excluída permanentemente. Exclusão confirmada no banco e no Dropbox.'+(health==='healthy'?'':' A sessão ainda precisa ser atualizada. Recarregue a página antes de continuar.'));
    const state={...location.state};delete state.organizationDeletionReceipt;
    void navigate(location.pathname+location.search,{replace:true,state});
  },[location,navigate,user,health,authenticated]);
  const createAttempt=useRef<{input:OperationInput;key:string}|null>(null),submitting=useRef(false),createButton=useRef<HTMLButtonElement|null>(null);
  const mounted=useRef(true),sequence=useRef(0),detailSequence=useRef(0),action=useRef<AbortController|null>(null),detailReload=useRef<AbortController|null>(null),keys=useRef(new Map<string,string>());
  const id=params.get('org_id'),tab=params.get('org_tab')||'general',mode=params.get('org_mode')==='import'?'':params.get('org_mode')||'',operationId=params.get('org_operation');
  useEffect(()=>{mounted.current=true;setHeader(document.getElementById('admin-organizations-actions'));return()=>{mounted.current=false;action.current?.abort();detailReload.current?.abort();};},[]);
  const invalidate=useCallback(()=>{sequence.current++;detailSequence.current++;setLoading(false);setDetailLoading(false);detailReload.current?.abort();setBlocked(true);setWorkspace(null);setDetail(null);setOperation(null);setHistory([]);setSelected(new Set());keys.current.clear();action.current?.abort();},[]);
  useEffect(()=>{setDraft(query);setSelected(new Set());},[query]);
  useEffect(()=>{const n=++sequence.current,controller=new AbortController();setLoading(true);setError('');
    api<Workspace>(`/organizations?${new URLSearchParams(Object.entries(query).map(([k,v])=>[k,String(v)]))}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted&&n===sequence.current){setWorkspace(data);setBlocked(false);}}).catch(e=>{if(!controller.signal.aborted&&n===sequence.current){if(denied(e))invalidate();setError(errorText(e));}}).finally(()=>{if(!controller.signal.aborted&&n===sequence.current)setLoading(false);});
    return()=>{controller.abort();};
  },[query,revision,invalidate]);
  useEffect(()=>{detailReload.current?.abort();const n=++detailSequence.current,c=new AbortController();setDetail(null);setDetailError('');setDetailLoading(false);if(!id||mode==='delete')return()=>c.abort();setDetailLoading(true);
    api<Detail>(`/organizations/${encodeURIComponent(id)}`,{signal:c.signal}).then(d=>{if(!c.signal.aborted&&n===detailSequence.current)setDetail(d);}).catch(e=>{if(!c.signal.aborted&&n===detailSequence.current){if(denied(e))invalidate();setDetailError(errorText(e));}}).finally(()=>{if(!c.signal.aborted&&n===detailSequence.current)setDetailLoading(false);});return()=>{c.abort();};
  },[id,mode,invalidate]);
  useEffect(()=>{if(!operationId||operation?.id===operationId)return;const c=new AbortController();api<Operation>(`/operations/${encodeURIComponent(operationId)}`,{signal:c.signal}).then(value=>{if(!c.signal.aborted&&mounted.current)setOperation(value);}).catch(e=>{if(!c.signal.aborted){if(denied(e))invalidate();setOperationError(errorText(e));}});return()=>c.abort();},[operationId,operation?.id,invalidate]);
  useEffect(()=>{if(mode!=='operations')return;const c=new AbortController();setHistory([]);api<{operations:{id:string;kind:string;createdAt:string}[]}>('/operations',{signal:c.signal}).then(r=>{if(!c.signal.aborted&&mounted.current)setHistory(r.operations);}).catch(e=>{if(!c.signal.aborted){if(denied(e))invalidate();setOperationError(errorText(e));}});return()=>c.abort();},[mode,invalidate]);
  function url(changes:Record<string,string|null>,replace=false){const next=new URLSearchParams(params);for(const [key,value]of Object.entries(changes)){if(value===null)next.delete(key);else next.set(key,value);}setParams(next,{replace});}
  function apply(q:Query){url(Object.fromEntries(Object.entries(q).map(([k,v])=>[`org_${k}`,String(v)])));}
  function openMode(next:string){createAttempt.current=null;setCreationPending(false);setSuccess('');setOperation(null);setOperationError('');setConfirmed(false);url({org_mode:next,org_id:null,org_tab:null,org_operation:null});}
  function openOrg(row:Organization,next='general'){setOperation(null);setOperationError('');url({org_id:String(row.id),org_tab:next,org_mode:null,org_operation:null});}
  function close(){createAttempt.current=null;setCreationPending(false);url({org_id:null,org_tab:null,org_mode:null,org_operation:null,org_deletion:null,org_delete_key:null});setOperation(null);setOperationError('');setReason('');setConfirmed(false);}
  async function execute(op:Operation,retry=false,signal?:AbortSignal){if(op.kind==='import')return op;let result=op;for(let i=0;i<100;i++){
    if(!mounted.current||signal?.aborted)break;
    if(i>0&&!result.items.some(item=>item.state==='pending'))break;
    const next=await api<Operation>(`/operations/${op.id}/step`,{body:{retry:i===0&&retry},signal});
    if(!mounted.current||signal?.aborted)break;
    setOperation(next);const unchanged=JSON.stringify(result.items)===JSON.stringify(next.items);result=next;if(unchanged||result.done)break;
  }return result;}
  async function finishCreation(op:Operation,signal?:AbortSignal){
    const item=op.items[0];
    if(item?.state!=='succeeded'){
      setOperationError(item?.result?.id?'Organização cadastrada, mas a preparação ainda não foi concluída. Tente retomar.':item?.state==='failed'?(item.error||'Não foi possível criar a organização. Revise os dados.'):'A criação ainda está em andamento. Aguarde e tente retomar.');
      return;
    }
    const result=await api<Detail>(`/organizations/${item.result?.id}`,{signal,timeoutMs:15000});
    const org=result.organization;
    if(!result.creationConfirmed||result.creationOperationId!==op.id||!org.active||!org.owner||!['READY','ACTIVE','CONFIGURED'].includes(org.storageStatus)){
      setOperationError('Organização cadastrada, mas a preparação ainda não foi concluída. Tente retomar.');return;
    }
    close();setSuccess('Organização criada com sucesso.');setRevision(v=>v+1);setSelected(new Set());
    setTimeout(()=>createButton.current?.focus(),0);
  }
  async function runCreation(op:Operation,signal?:AbortSignal){
    let latest=op;
    if(!op.done||op.items.some(item=>item.retryable))latest=await api<Operation>(`/operations/${op.id}/step`,{body:{retry:op.done},signal,timeoutMs:20000});
    if(signal?.aborted||!mounted.current)return;
    setOperation(latest);await finishCreation(latest,signal);
  }
  async function recoverCreation(signal?:AbortSignal){
    // A timeout says nothing about persistence. Observe before another write.
    let found=operation;
    if(found)found=await api<Operation>(`/operations/${found.id}`,{signal,timeoutMs:15000});
    else if(operationId)found=await api<Operation>(`/operations/${encodeURIComponent(operationId)}`,{signal,timeoutMs:15000});
    else if(createAttempt.current){
      const attempt=createAttempt.current;
      found=(await api<{operation:Operation|null}>(`/operations/by-key?key=${encodeURIComponent(attempt.key)}`,{signal,timeoutMs:15000})).operation;
      if(!found)found=await api<Operation>('/operations',{body:attempt.input,key:attempt.key,signal,timeoutMs:20000});
    }
    if(!found)return;
    setOperation(found);url({org_operation:found.id},true);await runCreation(found,signal);
  }
  async function submit(input:OperationInput){
    if(submitting.current||busy||(input.kind==='create'&&(creationPending||operationId)))return;
    submitting.current=true;const controller=new AbortController();action.current?.abort();action.current=controller;setBusy(true);setOperationError('');
    const hash=JSON.stringify(input);let key=keys.current.get(hash);if(!key){key=crypto.randomUUID();keys.current.set(hash,key);}
    if(input.kind==='create'){createAttempt.current={input,key};setCreationPending(true);}
    try{
      const op=await api<Operation>('/operations',{body:input,key,signal:controller.signal,...(input.kind==='create'?{timeoutMs:20000}:{})});
      if(!mounted.current)return;setOperation(op);url({org_operation:op.id},true);
      if(input.kind==='create')await runCreation(op,controller.signal);
      else {await execute(op,false,controller.signal);if(mounted.current){setRevision(v=>v+1);setSelected(new Set());}}
    }catch(e){if(!controller.signal.aborted&&mounted.current){if(denied(e))invalidate();setOperationError(input.kind==='create'?'Não foi possível confirmar a conclusão. Tente retomar para consultar a mesma criação.':errorText(e));}}
    finally{submitting.current=false;if(mounted.current)setBusy(false);}
  }
  async function continueOperation(retry=false){
    if(busy||submitting.current)return;submitting.current=true;
    const c=new AbortController();action.current?.abort();action.current=c;setBusy(true);setOperationError('');
    try{
      if(mode==='create'){await recoverCreation(c.signal);}
      else if(operation){await execute(operation,retry,c.signal);if(mounted.current){setRevision(v=>v+1);setSelected(new Set());}}
    }catch(e){if(!c.signal.aborted&&mounted.current){if(denied(e))invalidate();setOperationError(mode==='create'?'A conclusão ainda não foi confirmada. Aguarde e tente retomar.':errorText(e));}}
    finally{submitting.current=false;if(mounted.current)setBusy(false);}
  }
  function reviseCreation(){
    if(operation?.items[0]?.state!=='failed'||operation.items[0].result?.id)return;
    if(createAttempt.current)keys.current.delete(JSON.stringify(createAttempt.current.input));
    createAttempt.current=null;setCreationPending(false);setOperation(null);setOperationError('');url({org_operation:null},true);
  }
  const rows=workspace?.organizations||[],selectedRows=rows.filter(r=>selected.has(r.id));
  function exportSelected(){download('organizacoes-selecionadas.csv','\uFEFF'+[['id','nome','slug','plano','status','projetos','usuarios','arquivos'],...selectedRows.map(r=>[r.id,r.name,r.slug,PLAN_LABELS[r.plan],r.active?'Ativa':'Pausada',r.projectCount,r.userCount,r.fileCount])].map(row=>row.map(safeCell).join(',')).join('\r\n'));}
  function peopleLink(){if(!detail)return;const next=new URLSearchParams(params);next.set('section','users');next.set('organization',String(detail.organization.id));next.set('org_return','organizations');next.delete('org_operation');navigate(`/admin?${next}`);}
  async function projectDocuments(){if(!detail||!window.confirm(`Alterar a organização ativa para ${detail.organization.name} e abrir Projetos? Em seguida, use Arquivos e Documentos.`))return;setBusy(true);try{await switchOrganization(detail.organization.id);navigate('/projects');}catch(e){if(mounted.current)setOperationError(errorText(e));}finally{if(mounted.current)setBusy(false);}}
  function reloadDetail(){
    if(!id)return;if(!window.confirm('Substituir o formulário pela versão atual? Copie antes as alterações que deseja preservar.'))return;
    const n=++detailSequence.current,c=new AbortController();detailReload.current?.abort();detailReload.current=c;
    setDetail(null);setDetailError('');setDetailLoading(true);
    api<Detail>(`/organizations/${encodeURIComponent(id)}`,{signal:c.signal}).then(d=>{if(mounted.current&&!c.signal.aborted&&detailSequence.current===n)setDetail(d);})
      .catch(e=>{if(mounted.current&&!c.signal.aborted&&detailSequence.current===n){if(denied(e))invalidate();setDetailError(errorText(e));}})
      .finally(()=>{if(mounted.current&&!c.signal.aborted&&detailSequence.current===n)setDetailLoading(false);});
  }
  const summary=workspace?.summary;
  if(blocked)return <section className="admin-organizations-workspace"><Notice message={error||'Contexto indisponível. Nenhum dado anterior é exibido.'}/><Link to="/login">Entrar novamente</Link></section>;
  return <section className="admin-organizations-workspace" aria-label="Gestão operacional de organizações">
    {header&&createPortal(<div className="aog-header-actions"><button type="button" onClick={()=>openMode('requests')}>Solicitações {summary&&<span className="aog-count">{summary.requests}</span>}</button><button ref={createButton} type="button" className="aog-primary" disabled={!workspace?.capabilities.projectQuotaEnforced} onClick={()=>openMode('create')}>＋ Nova organização</button></div>,header)}
    <div className="aog-metrics" aria-label="Totais globais da plataforma">{[
      {label:'Organizações',value:summary?.organizations,icon:'building' as const,help:'Todas as organizações, inclusive pausadas.'},
      {label:'Ativas',value:summary?.active,icon:'building' as const,help:summary?.organizations?`${Math.round(summary.active/summary.organizations*100)}% do total`:'Percentual não disponível.'},
      {label:'Usuários totais',value:summary?.users,icon:'users' as const,help:'Pessoas únicas e ativas vinculadas a organizações ativas.'},
      {label:'Arquivos',value:summary?.files,icon:'file' as const,help:'Arquivos ativos; exclui lixeira e expurgados.'},
    ].map(item=><article key={item.label} className="aog-metric" title={item.help}><span className="aog-metric-icon"><AdminIcon name={item.icon}/></span><div><span>{item.label}</span><strong>{item.value??'—'}</strong><small>{item.help}</small></div></article>)}</div>
    <form className="aog-filters" onSubmit={e=>{e.preventDefault();apply({...draft,page:1});}}><label>Buscar<input value={draft.q} maxLength={160} placeholder="Nome ou identificador…" onChange={e=>setDraft(v=>({...v,q:e.target.value}))}/></label><label>Status<MaonoSelect value={draft.status} onChange={e=>setDraft(v=>({...v,status:e.target.value}))}><option value="all">Todos os status</option><option value="active">Ativas</option><option value="paused">Pausadas</option></MaonoSelect></label><label>Plano<MaonoSelect value={draft.plan} onChange={e=>setDraft(v=>({...v,plan:e.target.value}))}><option value="all">Todos os planos</option>{Object.entries(PLAN_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</MaonoSelect></label><label>Ordenar por<MaonoSelect value={draft.sort} onChange={e=>setDraft(v=>({...v,sort:e.target.value}))}><option value="newest">Mais recentes</option><option value="name">Nome A–Z</option><option value="updated">Cadastro atualizado</option></MaonoSelect></label><button type="submit" className="aog-primary">Aplicar</button><button type="button" onClick={()=>apply({q:'',status:'all',plan:'all',sort:'newest',page:1,size:10})}>Limpar filtros</button></form>
    <p role="status" className="aog-status">{success}</p><Notice message={error}/>{error&&<button type="button" onClick={()=>setRevision(v=>v+1)}>Tentar novamente</button>}{loading&&<p className="aog-status" role="status">{workspace?'Consultando organizações…':'Carregando organizações…'}</p>}
    <div className="aog-table-card"><div className="aog-selection"><label className="aog-check"><input type="checkbox" aria-label="Selecionar a página atual" disabled={loading} checked={rows.length>0&&rows.every(r=>selected.has(r.id))} onChange={e=>setSelected(e.target.checked?new Set(rows.map(r=>r.id)):new Set())}/>{selected.size} selecionados nesta página</label><button type="button" disabled={!selected.size||loading} onClick={()=>{setBulkKind('pause');setConfirmed(false);setOperation(null);setOperationError('');url({org_mode:'bulk',org_operation:null});}}>Ações em lote</button><button type="button" disabled={!selected.size||loading} onClick={exportSelected}>Exportar seleção</button><button type="button" onClick={()=>openMode('operations')}>Minhas operações</button></div>
      <div className="aog-table-scroll"><table aria-busy={loading}><caption className="aog-sr-only">Organizações filtradas. Os indicadores acima são globais.</caption><thead><tr><th aria-label="Selecionar"/><th>Organização</th><th>Plano</th><th>Responsável principal</th><th>Projetos</th><th>Usuários</th><th>Arquivos</th><th>Status</th><th>Última atividade</th><th>Ações</th></tr></thead><tbody>
      {!workspace&&loading?Array.from({length:5},(_,i)=><tr key={i} aria-hidden="true"><td colSpan={10}><span className="aog-skeleton"/></td></tr>):!rows.length?<tr><td colSpan={10}>{workspace?'Nenhuma organização encontrada.':'Dados indisponíveis.'}</td></tr>:rows.map(row=><tr key={row.id}>
        <td><input type="checkbox" aria-label={`Selecionar ${row.name}`} disabled={loading} checked={selected.has(row.id)} onChange={e=>setSelected(previous=>{const next=new Set(previous);if(e.target.checked)next.add(row.id);else next.delete(row.id);return next;})}/></td>
        <td><button type="button" className="aog-name" onClick={()=>openOrg(row)}>{row.name}</button><small>{row.slug}</small></td><td><span className={`aog-plan plan-${row.plan}`}>{PLAN_LABELS[row.plan]}</span></td><td>{row.owner?<><strong>{row.owner.name}</strong><small>{row.owner.email}</small></>:'Não definido'}</td><td>{row.projectCount}</td><td>{row.userCount}</td><td>{row.fileCount}</td><td><span className={`aog-state ${row.active?'is-active':'is-paused'}`}>{row.active?'Ativa':'Pausada'}</span><small title="Estado técnico independente do estado administrativo">{storageLabel(row.storageStatus)}</small></td><td><small>{dateLabel(row.lastActivityAt)}</small></td><td><div className="aog-actions">{[['people','Pessoas','users'],['documents','Documentos','file'],['policy','Plano e limites','settings'],['general','Editar e outras ações','settings']].map(([key,label,icon],index)=><button type="button" key={key} aria-label={`${label}: ${row.name}`} title={label} onClick={()=>openOrg(row,key)}>{index===3?'⋮':<AdminIcon name={icon as 'users'|'file'|'settings'}/>}</button>)}</div></td>
      </tr>)}</tbody></table></div></div>
    <footer className="aog-pagination"><span>{workspace?`${workspace.pagination.total} organizações encontradas · página ${workspace.pagination.page}/${workspace.pagination.pages}`:'Consulta não concluída'}</span><label>Itens por página<MaonoSelect value={query.size} onChange={e=>apply({...query,size:Number(e.target.value),page:1})}>{[10,20,50].map(n=><option value={n} key={n}>{n}</option>)}</MaonoSelect></label><button type="button" disabled={!workspace||workspace.pagination.page===1||loading} onClick={()=>apply({...query,page:(workspace?.pagination.page||1)-1})} aria-label="Página anterior">‹</button><span>{workspace?.pagination.page||1}</span><button type="button" disabled={!workspace||workspace.pagination.page>=workspace.pagination.pages||loading} onClick={()=>apply({...query,page:(workspace?.pagination.page||1)+1})} aria-label="Próxima página">›</button></footer>
    {(id||mode)&&<Dialog title={mode==='delete'?'Excluir permanentemente organização':id?(detail?.organization.name||'Organização'):(dialogTitles[mode]||'Operação')} onClose={close} busy={busy} loadingOnly={mode==='create'&&busy} dirty={mode==='create'||Boolean(id&&mode!=='delete'&&['general','people','policy'].includes(tab))} wide={mode==='requests'}>
      <Notice message={mode==='create'&&busy?'':operationError}/>{detailLoading&&<p role="status">Carregando organização…</p>}<Notice message={detailError}/>
      {id&&detail&&mode!=='delete'&&<><OrganizationEditor key={`${detail.organization.id}:${detail.organization.version}`} detail={detail} tab={tab} onTab={value=>url({org_tab:value})} onSubmit={input=>void submit(input)} onPeople={peopleLink} onDocuments={()=>void projectDocuments()} busy={busy} onDenied={invalidate}/><div className="aog-danger-zone"><button type="button" disabled={busy} onClick={()=>{if(window.confirm(`${detail.organization.active?'Pausar':'Reativar'} ${detail.organization.name}? Pausar preserva pessoas, arquivos e projetos. Reativar verifica o armazenamento.`))void submit({kind:detail.organization.active?'pause':'resume',items:[{id:detail.organization.id,version:detail.organization.version,reason:detail.organization.active?'Pausa confirmada no painel':'Reativação confirmada no painel'}]});}}>{detail.organization.active?'Pausar organização':'Reativar / verificar armazenamento'}</button>{detail.organization.active&&!['READY','ACTIVE','CONFIGURED'].includes(detail.organization.storageStatus)&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm('Verificar o armazenamento desta organização?'))void submit({kind:'resume',items:[{id:detail.organization.id,version:detail.organization.version,reason:'Verificação de armazenamento confirmada'}]});}}>Verificar armazenamento</button>}<button type="button" disabled={busy} onClick={reloadDetail}>Consultar versão atual</button>{user?.role==='super_admin'&&workspace?.capabilities.permanentDelete===true&&<button type="button" className="aog-destructive" disabled={busy} onClick={()=>{setOperation(null);setOperationError('');url({org_mode:'delete',org_operation:null,org_deletion:null,org_delete_key:null});}}>Excluir permanentemente organização</button>}</div></>}
      {id&&mode==='delete'&&(user?.role==='super_admin'&&workspace?.capabilities.permanentDelete===true?<OrganizationDeletionPanel key={id} organizationId={Number(id)} onCancel={close} onBusy={setBusy} onDenied={invalidate} onComplete={()=>{sequence.current++;detailSequence.current++;setWorkspace(null);setDetail(null);close();setSelected(new Set());setRevision(v=>v+1);void refreshSession().then(()=>{const next=new URLSearchParams(params);for(const name of ['org_id','org_tab','org_mode','org_operation','org_deletion','org_delete_key'])next.delete(name);const search=next.toString();const target=location.pathname+(search?'?'+search:'');if(window.location.pathname+window.location.search!==target)return;const nonce=crypto.randomUUID();completedDeletionReceipt={nonce,actorId:user.id};void navigate(target,{replace:true,state:{organizationDeletionReceipt:nonce}});}).catch(()=>setError('A exclusão foi concluída, mas a sessão ainda precisa ser atualizada. Recarregue a página antes de continuar.'));}}/>:<p role="status">Exclusão permanente indisponível neste contexto.</p>)}
      {mode==='create'&&<>
        <div hidden={busy}><CreateForm onSubmit={input=>void submit({kind:'create',items:[input]})} busy={busy||creationPending||Boolean(operationId)}/></div>
        {busy&&<div className="aog-create-loading"><UniversalLoader accessibleLabel="Criando e validando organização"/></div>}
        {!busy&&(creationPending||operationId)&&<button type="button" onClick={()=>void continueOperation(true)}>Retomar criação</button>}
        {!busy&&operation?.items[0]?.state==='failed'&&!operation.items[0].result?.id&&<button type="button" onClick={reviseCreation}>Revisar dados</button>}
      </>}
      {mode==='bulk'&&<><p>A ação afeta somente os {selectedRows.length} registros selecionados nesta página. Não exclui dados.</p><ul className="aog-records">{selectedRows.map(r=><li key={r.id}>{r.name} · #{r.id}</li>)}</ul><div className="aog-form"><label>Ação<MaonoSelect value={bulkKind} onChange={e=>setBulkKind(e.target.value as 'pause'|'resume')} disabled={busy}><option value="pause">Pausar</option><option value="resume">Reativar</option></MaonoSelect></label><label>Justificativa<input value={reason} minLength={5} maxLength={500} onChange={e=>setReason(e.target.value)} disabled={busy}/></label><label className="aog-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo a ação sobre as organizações listadas.</label><button type="button" className="aog-primary" disabled={busy||!selectedRows.length||reason.trim().length<5||!confirmed} onClick={()=>void submit({kind:bulkKind,items:selectedRows.map(r=>({id:r.id,version:r.version,reason}))})}>Executar lote</button></div></>}
      {mode==='requests'&&<RequestList onSubmit={input=>void submit(input)} busy={busy} onDenied={invalidate}/>}
      {mode==='operations'&&<><p>As últimas 20 operações da sua conta. Importações anteriores permanecem disponíveis somente para consulta.</p><ul className="aog-records">{history.map(op=><li key={op.id}><button type="button" onClick={()=>{setOperation(null);url({org_mode:'operation',org_operation:op.id});}}>{op.kind} · {dateLabel(op.createdAt)}</button></li>)}</ul>{!history.length&&<p>Nenhuma operação encontrada.</p>}</>}
      {operation&&mode!=='create'&&mode!=='delete'&&<OperationStatus operation={operation} onContinue={()=>void continueOperation()} onRetry={()=>void continueOperation(true)} busy={busy} error=""/>}
    </Dialog>}
  </section>;
}
