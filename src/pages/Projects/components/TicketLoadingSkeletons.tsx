import { Skeleton, StaticLoadingText } from "../../../components/loading/Skeleton";
import { useSkeletonCount } from "../../../components/loading/useSkeletonCount";
import "./TicketLoadingSkeletons.css";

/** Pending cells occupy the actual table's columns, without a second header. */
export function LoadingTableRows({ columns, count, kind = "document" }: { columns: number; count: number; kind?: "document" | "ticket" }) {
  return <>{Array.from({ length: count }, (_, row) => <tr key={row} aria-hidden="true" className={`mm-loading-table-row is-${kind}`}>
    {Array.from({ length: columns }, (_, column) => <td key={column}>{column === 0 && kind === "document" ? <div className="mm-loading-file-identity"><Skeleton width={34} height={40} /><div><Skeleton width={`${64 + row % 3 * 10}%`} height={12} /><Skeleton width="40%" height={10} /></div></div> : <Skeleton width={`${52 + (row + column) % 4 * 11}%`} height={12} />}</td>)}
  </tr>)}</>;
}

export function DocumentGridSkeleton({ count, structurePending = false }: { count: number; structurePending?: boolean }) {
  return <>{Array.from({ length: count }, (_, index) => <article className="mm-docs-file-card mm-loading-document-card" aria-hidden="true" key={index}>
    <div className="mm-loading-file-identity"><Skeleton width={34} height={40} /><div><Skeleton width={`${65 + index % 3 * 10}%`} height={12} /><Skeleton width="44%" height={10} /></div></div>
    <div className="mm-docs-file-card-meta">{["Tipo", "Tamanho", "Atualizado em"].map(label => <span key={label}><small><StaticLoadingText pending={structurePending}>{label}</StaticLoadingText></small><Skeleton width="74%" height={12} /></span>)}</div>
    <div className="mm-docs-row-actions"><Skeleton width={32} height={32} /></div>
  </article>)}</>;
}

export function DocumentFolderSkeleton() {
  const count = useSkeletonCount({ layout: "grid", itemHeight: 80, reservedHeight: 600, maxCount: 4 });
  return <>{Array.from({ length: count }, (_, index) => <article className="mm-docs-folder-card mm-loading-folder-card" aria-hidden="true" key={index}>
    <Skeleton width={30} height={28} /><div className="mm-skeleton-stack mm-skeleton-grow"><Skeleton width={`${60 + index % 3 * 10}%`} height={13} /><Skeleton width="42%" height={10} /></div>
  </article>)}</>;
}

export function TicketCardSkeleton({ count, structurePending = false }: { count: number; structurePending?: boolean }) {
  return <>{Array.from({ length: count }, (_, index) => <article className="ticket-kanban-card mm-loading-ticket-card" aria-hidden="true" key={index}>
    <div className="ticket-kanban-card-topline"><Skeleton width={72} height={12} /><Skeleton width={54} height={20} radius={999} /></div>
    <div className="mm-skeleton-stack"><Skeleton width={`${76 + index % 3 * 7}%`} height={14} /><Skeleton width="58%" height={14} /></div>
    <dl>{["Próxima ação", "Idade na fila", "Solicitante", "Atendente", "Prazo"].map(label => <div key={label}><dt><StaticLoadingText pending={structurePending}>{label}</StaticLoadingText></dt><dd><Skeleton width="75%" height={11} /></dd></div>)}</dl>
    <footer><Skeleton width={80} height={11} /><Skeleton width={80} height={28} /></footer>
  </article>)}</>;
}

export function TicketDetailSkeleton({ triageEnabled = false, structurePending = false }: { triageEnabled?: boolean; structurePending?: boolean }) {
  return <div className="ticket-detail-content mm-loading-ticket-detail" aria-busy="true">
    <section className="ticket-detail-summary">
      <div><Skeleton width={94} height={24} radius={999} /><Skeleton width={72} height={22} radius={999} /></div>
      <div className="mm-skeleton-stack mm-loading-detail-description"><Skeleton height={14} /><Skeleton width="92%" height={14} /><Skeleton width="64%" height={14} /></div>
      <dl>{["Solicitante", "Atendente", "Criado em", "Atualizado em", "Prazo", triageEnabled ? "Domínio afetado" : "Categoria"].map(label => <div key={label}><dt><StaticLoadingText pending={structurePending}>{label}</StaticLoadingText></dt><dd><Skeleton width="74%" height={14} /></dd></div>)}</dl>
    </section>
  </div>;
}
