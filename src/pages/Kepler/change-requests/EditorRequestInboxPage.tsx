import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { useSession } from "../../../auth/session";
import "./editor-request-inbox.css";

type InboxItem = {
  id: string; status: string; reason: string; baseRevision: number;
  submittedAt: string; operationCount: number; requesterName: string | null;
  ticket: { id: number; code: string; subject: string } | null;
  reviewUrl: string;
};
type InboxResponse = {
  project: { name: string; slug: string };
  items: InboxItem[];
  pagination: { page: number; limit: number; hasMore: boolean };
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Pendentes", all: "Todas", submitted: "Enviada", under_review: "Em revisão",
  approved: "Aprovada", applying: "Em aplicação", applied: "Aplicada",
  rejected: "Rejeitada", conflict: "Conflito", superseded: "Substituída",
};

function Inbox({ projectSlug }: { projectSlug: string }) {
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<InboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setResult(null);
    setError(null);
    const query = new URLSearchParams({ status, page: String(page), limit: "25" });
    void fetch(`/api/projects/${encodeURIComponent(projectSlug)}/change-requests/inbox?${query}`, {
      credentials: "include", cache: "no-store", signal: controller.signal,
    }).then(async response => {
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(
        payload?.error?.message || "Não foi possível carregar as solicitações.",
      );
      if (!controller.signal.aborted) setResult(payload);
    }).catch((nextError: unknown) => {
      if (!controller.signal.aborted) setError(nextError instanceof Error
        ? nextError.message : "Não foi possível carregar as solicitações.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [projectSlug, status, page, refresh]);

  return <main className="maono-editor-inbox">
    <header>
      <div><small>{result?.project.name || "Projeto"}</small><h1>Solicitações de alteração</h1></div>
      <nav aria-label="Navegação"><Link to="/projects">Projetos</Link>
        <Link to={`/projects/${encodeURIComponent(projectSlug)}/edit`}>Abrir Editor</Link></nav>
    </header>
    <p>Encontre o chamado e abra o Review para analisar as alterações solicitadas.</p>
    <div className="maono-editor-inbox__filters">
      <label>Situação <select value={status} onChange={event => {
        setStatus(event.target.value); setPage(1);
      }}>{Object.entries(STATUS_LABELS).map(([value, label]) =>
        <option key={value} value={value}>{label}</option>)}</select></label>
      <button disabled={loading} onClick={() => setRefresh(value => value + 1)}>Atualizar</button>
    </div>
    {loading ? <p role="status">Carregando solicitações…</p> : error ?
      <div role="alert"><p>{error}</p><button onClick={() => setRefresh(value => value + 1)}>Tentar novamente</button></div> :
      result?.items.length === 0 ? <p role="status">Nenhuma solicitação encontrada para esta situação.</p> :
      <ul className="maono-editor-inbox__list">{result?.items.map(item => <li key={item.id}>
        <div><small>{item.ticket?.code || "Sem chamado vinculado"} · {STATUS_LABELS[item.status] || item.status}</small>
          <h2>{item.ticket?.subject || "Solicitação de alteração"}</h2>
          <p>{item.reason}</p>
          <small>{item.requesterName || "Solicitante"} · {item.operationCount} alteração(ões) · Revisão {item.baseRevision}
            {item.submittedAt ? ` · ${item.submittedAt}` : ""}</small>
        </div><Link to={item.reviewUrl}>Abrir Review</Link>
      </li>)}</ul>}
    <nav className="maono-editor-inbox__pagination" aria-label="Paginação">
      <button disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
      <span>Página {page}</span>
      <button disabled={loading || !result?.pagination.hasMore} onClick={() => setPage(value => value + 1)}>Próxima</button>
    </nav>
  </main>;
}

export default function EditorRequestInboxPage() {
  const { projectSlug = "" } = useParams();
  const location = useLocation();
  const { authenticated, loading, user, activeOrganization } = useSession();
  if (loading) return <p role="status">Carregando sessão…</p>;
  if (!authenticated) return <Navigate replace to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} />;
  return <Inbox key={`${user?.id}:${activeOrganization?.id}:${projectSlug}`} projectSlug={projectSlug} />;
}
