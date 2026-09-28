// Local only: production components, fictional HTTP fixtures.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import TicketsSection from '../../src/pages/Projects/components/TicketsSection';
import '../../src/pages/Projects/projects.css';
function Harness() {
 const [org,setOrg]=useState(1);
 return <BrowserRouter><main style={{padding:20,background:'#111',color:'#eee',minHeight:'100vh'}}>
 <h1>CC-09 · fixture local</h1><button onClick={()=>setOrg(org===1?2:1)}>Trocar organização QA</button>
 <TicketsSection organizationId={org} organizationName={`QA ${org}`} user={{id:1,role:'owner',activeOrganizationId:org,organizations:[{id:1},{id:2}]}}/>
 </main></BrowserRouter>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
