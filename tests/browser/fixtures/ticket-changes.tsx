import React from 'react';
import {createRoot} from 'react-dom/client';
import {TicketChanges} from '../../../src/pages/Projects/components/TicketChanges';
createRoot(document.getElementById('root')!).render(<React.StrictMode><main><TicketChanges organizationId={1} ticketId={1} canManage={true}/></main></React.StrictMode>);
