import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import NoticeBoard from '../../../src/components/notices/NoticeBoard';
import {resetNoticeSession,publishNoticeSession} from '../../../src/components/notices/notice-events';
export default function Fixture(){const [user,setUser]=useState(1),[org,setOrg]=useState(1);return <main style={{padding:30}}>
  <div style={{overflow:'hidden',height:48,display:'flex',gap:10,alignItems:'center'}}><span>Perfil</span><NoticeBoard userId={user} organizationId={org}/><button>Menu do perfil</button></div>
  <button onClick={()=>{resetNoticeSession();setUser(2);publishNoticeSession(2,org);}}>Trocar usuário</button>
  <button onClick={()=>{resetNoticeSession();setOrg(2);publishNoticeSession(user,2);}}>Trocar organização</button>
  <button onClick={()=>resetNoticeSession()}>Encerrar sessão</button>
  <button onClick={()=>window.dispatchEvent(new Event('maono:notices-changed'))}>Refetch</button>
  </main>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Fixture/></BrowserRouter></React.StrictMode>);
