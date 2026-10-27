import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { LoadingProvider } from '../../../../src/components/loading';
import TicketsSection from '../../../../src/pages/Projects/components/TicketsSection';
import '../../../../src/maono-design-tokens.css';
import '../../../../src/platform-density.css';
import '../../../../src/components/loading/Skeleton.css';
import '../../../../src/pages/Projects/projects.css';

const profile: unknown[]=[];
Object.assign(window,{__ticketProfile:profile});
createRoot(document.getElementById('root')!).render(<BrowserRouter><LoadingProvider>
  <main className="mm-projects-page" style={{padding:24}}><Profiler id="Central" onRender={(_id,phase,actualDuration,baseDuration,startTime,commitTime)=>{
    if(profile.length<10000)profile.push({phase,actualDuration,baseDuration,startTime,commitTime});
  }}><TicketsSection user={{id:1,role:'owner',activeOrganizationId:1,permissions:[],deniedPermissions:[]}} organizationId={1} organizationName="Synthetic" onHome={()=>{}} /></Profiler></main>
</LoadingProvider></BrowserRouter>);
