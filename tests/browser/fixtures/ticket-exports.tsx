import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import TicketExportsPanel from '../../../src/pages/Projects/components/TicketExportsPanel';
function Fixture(){const [org,setOrg]=useState(1);return <main><button onClick={()=>setOrg(org===1?2:1)}>Trocar organização</button><TicketExportsPanel organizationId={org} canCreate={!location.search.includes('viewer')} canDownload={true}/></main>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture/></React.StrictMode>);
