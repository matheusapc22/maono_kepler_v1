import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import TicketNotifications from '../../../src/pages/Projects/components/TicketNotifications';
function Fixture(){
  const [selected,setSelected]=useState<number|null>(null);
  return <main><TicketNotifications organizationId={1} onOpen={setSelected} /><output aria-label="Chamado aberto">{selected}</output></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
