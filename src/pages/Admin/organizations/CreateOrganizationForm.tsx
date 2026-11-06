import {useEffect, useId, useRef, useState} from 'react';
import {MaonoSelect} from '../../../components/selection/MaonoSelect';
import {api} from './organizations-api';
import {PLAN_LABELS, type Plan} from './organizations-types';

type Candidate = {id:number; name:string; email:string};
type Lookup = 'idle'|'checking'|'available'|'duplicate'|'error';
export function CreateForm({onSubmit,busy}:{onSubmit:(value:Record<string,unknown>)=>void;busy:boolean}) {
  const [name,setName]=useState(''), [description,setDescription]=useState(''), [plan,setPlan]=useState<Plan>('free');
  const [email,setEmail]=useState(''), [confirmed,setConfirmed]=useState(false), [nameState,setNameState]=useState<Lookup>('idle');
  const [nameRetry,setNameRetry]=useState(0), [ownerRetry,setOwnerRetry]=useState(0), [users,setUsers]=useState<Candidate[]>([]);
  const [owner,setOwner]=useState<Candidate|null>(null), [ownerState,setOwnerState]=useState<Lookup>('idle');
  const [open,setOpen]=useState(false), [active,setActive]=useState(-1);
  const listId=useId(), nameHelp=useId(), ownerHelp=useId(), ownerQuery=useRef(0), nameQuery=useRef(0);
  useEffect(()=>{
    const c=new AbortController(), seq=++nameQuery.current;
    if(!name.trim())return()=>c.abort();
    const timer=setTimeout(()=>{
      api<{available:boolean}>(`/name-availability?name=${encodeURIComponent(name)}`,{signal:c.signal,timeoutMs:15000})
        .then(r=>{if(!c.signal.aborted&&seq===nameQuery.current)setNameState(r.available?'available':'duplicate');})
        .catch(()=>{if(!c.signal.aborted&&seq===nameQuery.current)setNameState('error');});
    },300);
    return()=>{clearTimeout(timer);c.abort();};
  },[name,nameRetry]);
  useEffect(()=>{
    const c=new AbortController(), seq=++ownerQuery.current;
    if(email.trim().length<2||owner)return()=>c.abort();
    const exact=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const timer=setTimeout(()=>{
      api<{users:Candidate[]}>(`/candidates?q=${encodeURIComponent(email.trim())}${exact?'&exact=1':''}`,{signal:c.signal,timeoutMs:15000})
        .then(r=>{
          if(c.signal.aborted||seq!==ownerQuery.current)return;
          setUsers(r.users);setOwnerState(r.users.length?'available':'duplicate');
          if(exact&&r.users.length===1&&r.users[0].email.toLowerCase()===email.trim().toLowerCase())setOwner(r.users[0]);
        }).catch(()=>{if(!c.signal.aborted&&seq===ownerQuery.current)setOwnerState('error');});
    },300);
    return()=>{clearTimeout(timer);c.abort();};
  },[email,owner,ownerRetry]);
  useEffect(()=>{if(open&&active>=0)document.getElementById(`${listId}-${active}`)?.scrollIntoView({block:'nearest'});},[open,active,listId]);
  function choose(user:Candidate){ownerQuery.current++;setOwner(user);setEmail(user.email);setOwnerState('available');setOpen(false);setActive(-1);}
  const valid=nameState==='available'&&Boolean(owner)&&confirmed&&!busy;
  return <form className="aog-form" onSubmit={e=>{e.preventDefault();if(valid)onSubmit({name,description,plan,ownerEmail:owner!.email});}}>
    <label>Nome<input required maxLength={160} value={name} disabled={busy} aria-describedby={nameHelp} onChange={e=>{nameQuery.current++;setName(e.target.value);setNameState(e.target.value.trim()?'checking':'idle');}}/></label>
    <small id={nameHelp} role="status">{{idle:'Informe o nome da organização.',checking:'Verificando nome…',available:'Nome disponível.',duplicate:'Nome já utilizado.',error:'Não foi possível verificar o nome.'}[nameState]}</small>
    {nameState==='error'&&<button type="button" disabled={busy} onClick={()=>{setNameState('checking');setNameRetry(n=>n+1);}}>Verificar nome novamente</button>}
    <label>Descrição<textarea maxLength={3000} value={description} disabled={busy} onChange={e=>setDescription(e.target.value)}/></label>
    <label>Plano<MaonoSelect value={plan} disabled={busy} onChange={e=>setPlan(e.target.value as Plan)}>{Object.entries(PLAN_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</MaonoSelect></label>
    <div className="aog-owner-combobox">
      <label>E-mail do responsável<input role="combobox" type="text" inputMode="email" autoComplete="off" required maxLength={254} value={email} disabled={busy}
        aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open&&active>=0?`${listId}-${active}`:undefined} aria-describedby={ownerHelp}
        onFocus={()=>setOpen(email.trim().length>=2)} onBlur={()=>setOpen(false)}
        onChange={e=>{ownerQuery.current++;setOwner(null);setEmail(e.target.value);setUsers([]);setActive(-1);setOpen(e.target.value.trim().length>=2);setOwnerState(e.target.value.trim().length>=2?'checking':'idle');}}
        onKeyDown={e=>{
          if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);}
          if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(i=>users.length?(i<0?(e.key==='ArrowDown'?0:users.length-1):(i+(e.key==='ArrowDown'?1:users.length-1))%users.length):-1);}
          if(e.key==='Enter'&&open){e.preventDefault();if(active>=0&&users[active])choose(users[active]);}
        }}/></label>
      {open&&<ul id={listId} role="listbox" aria-label="Usuários ativos" className="aog-candidates">{users.map((user,i)=><li key={user.id} id={`${listId}-${i}`} role="option" aria-selected={active===i} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(user)}><strong>{user.name}</strong><span>{user.email}</span></li>)}</ul>}
    </div>
    <small id={ownerHelp} role="status">{owner?'Usuário ativo confirmado.':({idle:'Busque por nome ou informe um e-mail completo.',checking:'Buscando usuários…',available:'Selecione o usuário responsável.',duplicate:'Nenhum usuário ativo encontrado.',error:'Não foi possível consultar os usuários.'}[ownerState])}</small>
    {ownerState==='error'&&<button type="button" disabled={busy} onClick={()=>{setOwnerState('checking');setOwnerRetry(n=>n+1);}}>Buscar usuários novamente</button>}
    <small>Receberá vínculo de proprietário, sem mudança de papel global.</small>
    <label className="aog-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo o cadastro e o vínculo de proprietário.</label>
    <button className="aog-primary" type="submit" disabled={!valid}>Criar organização</button>
  </form>;
}
