import { Dialog } from './OrganizationDialogs';
import { readinessBlocker, type ReadinessPreview } from './useDeletionReadiness';
import { dateLabel } from './organizations-api';
import type { DeletionBlockerAction } from './organization-deletion-contract';
import type { ReactNode } from 'react';

export function OrganizationBlockerResolver({ preview, name, busy, onClose, onRefresh, onAction, onPrepareDeletion, notifications, embedded=false }: {
  preview: ReadinessPreview | null; name: string; busy: boolean; onClose: () => void;
  onRefresh: () => void; onAction: (action: DeletionBlockerAction) => void; onPrepareDeletion?: () => void;
  notifications?: ReactNode; embedded?: boolean;
}) {
  const actions = { pause: 'Pausar organização', query: 'Consultar operação', follow: 'Consultar andamento', review: 'Revisão administrativa' };
  const content=<section className="aog-blocker-resolver" aria-label={`Impedimentos de ${name}`}>
      <p><strong>{name}</strong></p>
      {preview?.blockers.length ? <ul className="aog-records">{preview.blockers.map((blocker, index) => <li key={blocker.key || `${blocker.code}:${index}`}>
        <strong>{blocker.description || readinessBlocker(blocker.code)}</strong>
        {blocker.count > 1 && <span>{blocker.count} registros relacionados</span>}
        {blocker.code === 'STORAGE_DRAIN_REQUIRED' && preview.waitUntil && <p>Nova consulta após {dateLabel(preview.waitUntil)} (Brasília). A liberação depende da confirmação do servidor.</p>}
        {blocker.action ? <>
          <button type="button" disabled={busy || !blocker.action.enabled} onClick={() => onAction(blocker.action!)}>{embedded&&blocker.action.kind==='pause'?'Abrir gestão para pausar':actions[blocker.action.kind]}</button>
          {blocker.action.reason && <p>{blocker.action.reason}</p>}
        </> : <p>Consulte novamente as condições. Se este impedimento permanecer, a revisão administrativa ainda será necessária.</p>}
      </li>)}</ul> : preview?.eligible ? <div className="aog-form"><p>A confirmação de exclusão pode ser aberta para esta organização.</p>{onPrepareDeletion && <button type="button" className="aog-destructive" disabled={busy} onClick={onPrepareDeletion}>Preparar exclusão permanente</button>}</div> : <p>Consulte as condições atuais para continuar.</p>}
      <footer><button type="button" disabled={busy} onClick={onRefresh}>Consultar liberação para exclusão</button><button type="button" disabled={busy} onClick={onClose}>Voltar à organização</button></footer>
    </section>;
  return embedded?content:<Dialog title="Resolver impedimentos" onClose={onClose} busy={busy} loading={busy} loadingLabel="Consultando condições da organização" notifications={notifications} viewKey="blocker-resolver">{content}</Dialog>;
}
