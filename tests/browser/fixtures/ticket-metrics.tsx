import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import TicketMetricsPanel from '../../../src/pages/Projects/components/TicketMetricsPanel';
function Fixture() { const [org, setOrg] = useState(1); return <main><button onClick={() => setOrg(org === 1 ? 2 : 1)}>Trocar organização</button><TicketMetricsPanel organizationId={org} canManage={!new URLSearchParams(location.search).has('viewer')}/></main>; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
