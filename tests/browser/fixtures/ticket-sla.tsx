import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {TicketSlaPanel} from '../../../src/pages/Projects/components/TicketSlaPanel';
function Fixture(){const [org,setOrg]=useState(1);return <main><button onClick={()=>setOrg(org===1?2:1)}>Trocar organização</button><TicketSlaPanel key={org} organizationId={org} ticketId={1} canManage={!new URLSearchParams(location.search).has('viewer')}/></main>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture/></React.StrictMode>);
