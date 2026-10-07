import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { LoadingProvider } from '../../../src/components/loading';
import ProjectsSection from '../../../src/pages/Projects/components/ProjectsSection';
import * as spool from '../../../src/pages/Kepler/thumbnail/preview-spool';
import * as contract from '../../../src/pages/Kepler/thumbnail/preview-contract';
import * as recovery from '../../../src/pages/Kepler/thumbnail/preview-recovery';
export { spool, contract, recovery };

export async function makeRecord(actorId='3', organizationId='7', operationId=crypto.randomUUID()) {
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
  const context=canvas.getContext('2d')!;context.fillStyle='#206050';context.fillRect(0,0,960,540);context.fillStyle='#fff';context.fillRect(45,30,95,80);
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!), 'image/png'));
  const manifest={operationId,saveOperationId:crypto.randomUUID(),organizationId,projectId:'19',revision:2,configChecksum:'a'.repeat(64),editorSessionId:'editor-session-0001',editGeneration:4,
    rendererVersion:'maono-png-v2',imageChecksum:await contract.hashPreviewBlob(blob),sizeBytes:blob.size,captureMethod:'canvas-composite'};
  const createdAt=Date.now();
  return { key:spool.previewSpoolKey(actorId,manifest),accountKey:spool.previewAccountKey(actorId,organizationId),actorId,organizationId,slug:'synthetic',manifest,blob,createdAt,
    expiresAt:createdAt+spool.PREVIEW_SPOOL_RETENTION_MS,attempts:0,nextAttemptAt:0,lastError:null,state:'LOCAL_READY' as const };
}
export function renderCards(projects:any[]) {
  function App(){
    const [section,setSection]=useState<'all'|'recent'|'favorites'>('all');const [items,setItems]=useState(projects);const [search,setSearch]=useState('');
    (window as any).updatePreviewFixture=(values:any[])=>setItems(values);
    return <><nav aria-label="Conjuntos de projetos">{[['all','Todos os Projetos'],['recent','Recentes'],['favorites','Favoritos']].map(([id,label])=><button key={id} onClick={()=>setSection(id as any)}>{label}</button>)}</nav>
      <ProjectsSection section={section} projects={items} searchQuery={search} onSearchQueryChange={setSearch} canProjectSave={()=>true} canProjectFavorite={()=>true} canProjectEdit={()=>true}
        onFavoriteToggle={()=>{}} onProjectUpdated={project=>setItems(current=>current.map(value=>value.id===project.id?project:value))}/></>;
  }
  createRoot(document.getElementById('root')!).render(<MemoryRouter><LoadingProvider><App/></LoadingProvider></MemoryRouter>);
}
