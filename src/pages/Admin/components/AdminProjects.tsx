import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { MaonoUser } from "../../../auth/session";
import { can } from "../../../access-control/can";
import { StaticLoadingText } from "../../../components/loading";
import { Skeleton } from "../../../components/loading/Skeleton";
import { MaonoSelect } from "../../../components/selection/MaonoSelect";
import {
  filterKeys, filterProjects, formatAdminProjectDate, lifecycleLabels, paginateProjects,
  projectLifecycle, projectUnavailableReason, readProjectQuery,
  type AdminProject, type ProjectFilters, type ProjectOrganization,
} from "./admin-projects-model";
import "./admin-projects.css";

type RegionState = { pending: boolean; loaded: boolean; error: string };
type Props = {
  projects: AdminProject[];
  organizations: ProjectOrganization[];
  state: RegionState;
  organizationsState: RegionState;
  user: MaonoUser | null;
  structurePending: boolean;
  contentPending: boolean;
};

function ProjectFiltersForm({ value, organizations, states, onApply, onClear }: {
  value: ProjectFilters;
  organizations: Array<{ id: string; name: string }>;
  states: string[];
  onApply: (value: ProjectFilters) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const changed = draft.search !== value.search || draft.organization !== value.organization || draft.lifecycle !== value.lifecycle;
  function submit(event: FormEvent) { event.preventDefault(); onApply(draft); }
  return <form className="admin-projects-filters" aria-label="Filtros de projetos" onSubmit={submit}>
    <label className="admin-projects-search">Buscar projeto
      <input type="search" value={draft.search} placeholder="Nome, slug ou descrição" onChange={event => setDraft({ ...draft, search: event.target.value })} />
    </label>
    <label>Organização
      <MaonoSelect value={draft.organization} onChange={event => setDraft({ ...draft, organization: event.target.value })}>
        <option value="all">Todas as recebidas</option>
        <option value="none">Sem organização</option>
        {organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </MaonoSelect>
    </label>
    <label>Estado do ciclo
      <MaonoSelect value={draft.lifecycle} onChange={event => setDraft({ ...draft, lifecycle: event.target.value })}>
        <option value="all">Todos os estados</option>
        {states.map(state => <option key={state} value={state}>{lifecycleLabels[state] || state}</option>)}
      </MaonoSelect>
    </label>
    <div className="admin-projects-filter-actions">
      <button type="submit" className="mm-btn primary">Aplicar filtros</button>
      <button type="button" className="mm-btn" onClick={() => setDraft(value)} disabled={!changed}>Cancelar</button>
      <button type="button" className="mm-btn" onClick={() => { setDraft({ search: "", organization: "all", lifecycle: "all" }); onClear(); }}>Limpar filtros</button>
    </div>
  </form>;
}

export default function AdminProjects({ projects, organizations, state, organizationsState, user, structurePending, contentPending }: Props) {
  const [params, setParams] = useSearchParams();
  const query = readProjectQuery(params);
  const filtered = filterProjects(projects, query);
  const page = paginateProjects(filtered, query.page, query.pageSize);
  const availableOrganizations = useMemo(() => {
    const names = new Map<string, string>();
    projects.forEach(project => {
      const id = project.organizationId ?? project.organization?.id;
      if (id) names.set(String(id), project.organization?.name || `Organização #${id}`);
    });
    // Keep a deep-linked unknown filter visible instead of silently widening it.
    if (!["all", "none"].includes(query.organization) && !names.has(query.organization)) names.set(query.organization, `Organização #${query.organization} (sem registros recebidos)`);
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [projects, query.organization]);
  const states = [...new Set([...Object.keys(lifecycleLabels), ...projects.map(projectLifecycle), ...(query.lifecycle === "all" ? [] : [query.lifecycle])])];
  const activeOrganizationId = user?.activeOrganizationId ?? user?.organizationId ?? user?.organization_id;
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key); });
    setParams(next);
  }
  const ready = state.loaded && !contentPending;
  return <section className="mm-card mm-section-card admin-projects" aria-labelledby="admin-projects-title">
    <h2 id="admin-projects-title"><StaticLoadingText pending={structurePending}>Projetos e Mapas</StaticLoadingText></h2>
    <p><StaticLoadingText pending={structurePending}>Consulte o estado dos projetos e abra os espaços de trabalho disponíveis.</StaticLoadingText></p>
    <ProjectFiltersForm key={JSON.stringify([query.search, query.organization, query.lifecycle])} value={query} organizations={availableOrganizations} states={states}
      onApply={value => update({ projectSearch: value.search.trim(), projectOrganization: value.organization === "all" ? "" : value.organization, projectLifecycle: value.lifecycle === "all" ? "" : value.lifecycle, projectPage: "" })}
      onClear={() => { const next = new URLSearchParams(params); filterKeys.forEach(key => next.delete(key)); setParams(next); }} />
    <p className="admin-projects-context">Consulta do inventário autorizado. A organização do filtro não altera a organização ativa da sessão. <Link to="/projects">Abrir Projetos</Link></p>
    {state.error && state.loaded && <p className="admin-projects-context">A consulta falhou. Os registros anteriores permanecem visíveis; os destinos aguardam uma leitura válida.</p>}
    <div className="mm-table-wrap admin-projects-table" role="region" aria-label="Lista de projetos" tabIndex={0} aria-busy={state.pending || contentPending}>
      <table>
        <caption className="admin-projects-sr-only">Projetos recebidos, organização, estado e destinos disponíveis</caption>
        <thead><tr>{["Projeto", "Organização", "Estado e disponibilidade", "Acessos", "Destinos"].map(header => <th key={header} scope="col"><StaticLoadingText pending={structurePending}>{header}</StaticLoadingText></th>)}</tr></thead>
        <tbody>{contentPending ? Array.from({ length: 4 }, (_, index) => <tr key={index} aria-hidden="true">{Array.from({ length: 5 }, (_, cell) => <td key={cell}><Skeleton width="75%" height={12} /></td>)}</tr>) : !state.loaded ? <tr><td colSpan={5}>Dados indisponíveis.</td></tr> : !filtered.length ? <tr><td colSpan={5}>{projects.length ? "Nenhum projeto corresponde aos filtros aplicados." : "Nenhum registro encontrado."}</td></tr> : page.items.map(project => {
          const lifecycle = projectLifecycle(project);
          const context = { project, projectId: project.id, organizationId: project.organizationId };
          const unavailable = projectUnavailableReason(project, activeOrganizationId, organizations, organizationsState.loaded && !organizationsState.error && !organizationsState.pending)
            || (state.error || state.pending ? "Aguardando confirmação dos dados." : null)
            || (!can(user, "project.view", context) ? "Sem permissão para abrir este projeto." : null);
          const destination = `/projects/${encodeURIComponent(project.slug)}`;
          return <tr key={`${project.organizationId ?? "none"}:${project.id}`}>
            <th scope="row"><strong>{project.name || "Nome não informado"}</strong><span className="admin-projects-secondary">{project.slug || "Slug não informado"}</span>
              <details className="admin-projects-details"><summary>Detalhes <span className="admin-projects-sr-only">de {project.name}</span></summary>
                <dl>
                  <dt>Descrição</dt><dd>{project.description || "Não informada"}</dd>
                  <dt>JSON principal</dt><dd>{project.defaultConfigFile || "Não informado"}</dd>
                  <dt>Pasta</dt><dd>{project.dropboxRootPath || "Não informada"}</dd>
                  <dt>Versão dos metadados</dt><dd>{project.metadataVersion ?? "Não informada"}</dd>
                  <dt>Versão do ciclo</dt><dd>{project.lifecycle?.version ?? "Não informada"}</dd>
                  <dt>Revisão da configuração</dt><dd>{project.lifecycle?.configRevision ?? "Não informada"}</dd>
                  <dt>Criado por</dt><dd>{project.createdBy?.name || "Não informado"}</dd>
                  <dt>Criação</dt><dd>{formatAdminProjectDate(project.createdAt)}</dd>
                  <dt>Atualizado por</dt><dd>{project.updatedBy?.name || "Não informado"}</dd>
                  <dt>Atualização</dt><dd>{formatAdminProjectDate(project.updatedAt)}</dd>
                </dl>
              </details>
            </th>
            <td>{project.organization?.name || (project.organizationId ? `Organização #${project.organizationId}` : "Não informada")}<span className="admin-projects-secondary">{project.organization?.slug || ""}</span></td>
            <td><span className="admin-projects-status">{lifecycleLabels[lifecycle] || lifecycle}</span><span className="admin-projects-secondary">Cadastro: {project.active === true ? "ativo" : project.active === false ? "inativo" : "não informado"}</span><span className="admin-projects-secondary">{unavailable || "Disponível na organização ativa"}</span></td>
            <td>{project.accessCount ?? "Não informado"}</td>
            <td>{unavailable ? <span className="admin-projects-secondary">Destinos indisponíveis</span> : <nav className="admin-projects-destinations" aria-label={`Destinos de ${project.name}`}>
              <Link to={`${destination}/manage`}>Gerenciar</Link>
              {can(user, "project.save", context) && <Link to={`${destination}/requests`}>Solicitações</Link>}
              <span className="admin-projects-secondary">Visualização direta indisponível: este perfil usa o modo Editor.</span>
            </nav>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="admin-projects-pagination">
      <p aria-live="polite" aria-atomic="true">{ready ? `Exibindo ${page.start}–${page.end} de ${filtered.length} registros filtrados (${projects.length} recebidos).` : state.pending || contentPending ? "Carregando projetos." : "Contagem indisponível."}</p>
      <label>Por página<MaonoSelect value={String(query.pageSize)} onChange={event => update({ projectPageSize: event.target.value, projectPage: "" })}>{[10, 25, 50].map(size => <option key={size} value={size}>{size}</option>)}</MaonoSelect></label>
      <nav aria-label="Paginação dos projetos">
        <button className="mm-btn" type="button" disabled={!ready || page.page <= 1} onClick={() => update({ projectPage: String(page.page - 1) })}>Anterior</button>
        <span>{ready ? `Página ${page.page} de ${page.pages}` : "Página —"}</span>
        <button className="mm-btn" type="button" disabled={!ready || page.page >= page.pages} onClick={() => update({ projectPage: String(page.page + 1) })}>Próxima</button>
      </nav>
    </div>
    <p className="admin-projects-context">As permissões são verificadas novamente ao abrir cada destino. Revisões individuais são abertas pela caixa de solicitações do projeto.</p>
  </section>;
}
