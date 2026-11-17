import {useEffect,useState} from 'react';
import {api,denied,errorText} from './organizations-api';

type Preview={organizationId:number;eligible:boolean;blockers:{code:string;count:number}[]};
type Readiness={key:string;checking:boolean;preview:Preview|null;error:string};
const blockerLabels:Record<string,string>={
  PAUSE_REQUIRED:'Pause a organização antes de excluir.',
  STORAGE_NOT_SETTLED:'O armazenamento ainda precisa ser estabilizado.',
  LINKED_DATA:'A organização possui dados vinculados que impedem a exclusão.',
  UNRESOLVED_OPERATION:'Há uma operação pendente de conclusão.',
  DELETION_IN_PROGRESS:'Já existe uma exclusão em andamento. Consulte a mesma operação.',
  MIXED_SCOPE_PERMISSION:'Permissões vinculadas a projetos precisam de revisão.',
  UNGUARDED_DEPENDENCY:'A estrutura de dados precisa de revisão antes da exclusão.',
  ORGANIZATION_DELETE_UNSAFE_PATH:'Não foi possível confirmar a segurança da pasta.',
  ORGANIZATION_DELETE_SHARED_PATH:'A pasta não pertence exclusivamente à organização.',
};
export function readinessBlocker(code:string){return blockerLabels[code]||'Há uma condição de segurança pendente antes da exclusão.';}

/** Read-only readiness, including reload recovery. A local timer never grants eligibility. */
export function useDeletionReadiness(organizationId:number|null,version:number|undefined,onDenied:()=>void){
  const key=organizationId===null?'':`${organizationId}:${version??''}`;
  const [attempt,setAttempt]=useState(0),[state,setState]=useState<Readiness>({key:'',checking:false,preview:null,error:''});
  useEffect(()=>{
    if(organizationId===null){setState({key:'',checking:false,preview:null,error:''});return;}
    const c=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    // This timeout only stops waiting; it never grants permission to delete.
    const deadline=setTimeout(()=>{c.abort();if(timer)clearTimeout(timer);setState({key,checking:false,preview:null,error:'A espera de segurança ainda não foi liberada pelo servidor. Consulte novamente.'});},300000);
    setState({key,checking:true,preview:null,error:''});
    async function check(){
      try{
        const preview=await api<Preview>(`/organizations/${organizationId}/deletion-preview`,{signal:c.signal,timeoutMs:15000});
        if(c.signal.aborted)return;
        if(preview.organizationId!==organizationId||typeof preview.eligible!=='boolean'||!Array.isArray(preview.blockers)||preview.blockers.some(b=>!b||typeof b.code!=='string')||preview.eligible!==(preview.blockers.length===0))throw new Error('Prévia de exclusão inválida.');
        const draining=preview.blockers.some(b=>b.code==='STORAGE_DRAIN_REQUIRED');
        if(!draining)clearTimeout(deadline);
        setState({key,checking:draining,preview,error:''});
        if(draining)timer=setTimeout(()=>void check(),5000);
      }catch(e){
        if(c.signal.aborted)return;
        clearTimeout(deadline);
        setState({key,checking:false,preview:null,error:'Não foi possível confirmar a liberação para exclusão. '+errorText(e)});
        if(denied(e))onDenied();
      }
    }
    void check();
    return()=>{c.abort();clearTimeout(deadline);if(timer)clearTimeout(timer);};
  },[organizationId,key,attempt,onDenied]);
  const current=key&&state.key===key?state:null;
  return {checking:Boolean(key)&&(!current||current.checking),preview:current?.preview??null,error:current?.error??'',refresh:()=>setAttempt(v=>v+1)};
}
