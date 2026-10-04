import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { MaonoSelect } from "../../../components/selection/MaonoSelect";
import { DocumentIcon } from "./DocumentsUi";
import DocumentsPagination from "./DocumentsPagination";
import { paginateRoadmapTasks, reconcileRoadmapPagination, roadmapPaginationKey, type RoadmapPaginationState } from "./roadmap-pagination";
import "./roadmap-workspace.css";
import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import { normalizeUserError } from "../../../lib/user-error-catalog";
import { createRoadmap, createRoadmapTask, createTaskComment, deleteRoadmapTask, getRoadmap, listRoadmaps, listTaskComments, updateRoadmapTask } from "./roadmap-api";
import { DEFAULT_ROADMAP_FILTERS, ROADMAP_PRIORITY_LABELS, ROADMAP_STATUS_LABELS, type RoadmapBundle, type RoadmapComment, type RoadmapFilters, type RoadmapScale, type RoadmapSummary, type RoadmapTask, type RoadmapTaskStatus, type RoadmapView } from "./roadmap-types";

type Props = { user?: AccessControlUser | null; organizationId?: number | string | null; organizationName?: string | null; onHome?: () => void };
const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const person = (task: RoadmapTask) => task.assigneeName || "Não atribuído";
const errorText = (error: unknown) => normalizeUserError(error).message || "Não foi possível concluir.";

function timelineDays(start: string, end: string) { return Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1); }
function position(value: string, start: string, total: number) { return Math.max(0, Math.min(100, (Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) / total) * 100)); }

function RoadmapMetrics({ bundle }: { bundle: RoadmapBundle }) {
  const items = [
    ["Progresso geral", `${bundle.metrics.progress}%`, "◔"],
    ["Em andamento", bundle.metrics.inProgress, "▶"],
    ["Atrasadas", bundle.metrics.overdue, "!"],
    ["Bloqueadas", bundle.metrics.blocked, "◆"],
    ["Próximo marco", bundle.metrics.nextMilestone ? formatDate(bundle.metrics.nextMilestone.startDate) : "—", "◇"],
  ];
  return <section className="roadmap-metrics" aria-label="Indicadores do roadmap">{items.map(([label, value, icon]) => <article key={label}><span aria-hidden="true">{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>)}</section>;
}

function GanttView({ bundle, tasks, onOpen, scale }: { bundle: RoadmapBundle; tasks: RoadmapTask[]; onOpen: (task: RoadmapTask) => void; scale: RoadmapScale }) {
  const start = bundle.roadmap.startDate; const end = bundle.roadmap.endDate; const total = timelineDays(start, end);
  const markerCount = scale === "day" ? 14 : scale === "week" ? 12 : 8;
  const markers = Array.from({ length: markerCount }, (_, index) => {
    const day = Math.round((total - 1) * index / Math.max(1, markerCount - 1));
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + day * DAY).toISOString().slice(0, 10);
    return { date, left: (day / total) * 100 };
  });
  const todayLeft = position(today(), start, total);
  return <div className="roadmap-gantt" role="table" aria-label="Cronograma Gantt">
    <div className="roadmap-gantt-head" role="row"><strong role="columnheader">Tarefa / responsável</strong><div role="columnheader">{markers.map((item) => <span key={item.date} title={formatDate(item.date)} style={{ left: `${item.left}%` }}>{scale === "month" ? new Date(`${item.date}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }) : new Date(`${item.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>)}</div></div>
    <div className="roadmap-gantt-body">
      <i className="roadmap-today-line" style={{ left: `calc(320px + (100% - 320px) * ${todayLeft / 100})` }}><span>Hoje</span></i>
      {tasks.map((task) => {
        const left = position(task.startDate, start, total); const right = position(task.endDate, start, total); const overdue = !["completed", "cancelled"].includes(task.status) && task.endDate < today();
        return <button type="button" role="row" key={task.id} className="roadmap-gantt-row" onClick={() => onOpen(task)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(task); }}>
          <span role="cell"><b>{task.title}</b><small>{task.phaseName} · {person(task)}</small></span>
          <span role="cell" className="roadmap-timeline-cell">
            {task.isMilestone ? <i className="roadmap-milestone" style={{ left: `${left}%` }} title={`Marco: ${task.title}`} /> : <i className={`roadmap-task-bar status-${task.status} ${overdue ? "is-overdue" : ""}`} style={{ left: `${left}%`, width: `${Math.max(1.5, right - left + 100 / total)}%` }} aria-label={`${task.title}, ${formatDate(task.startDate)} a ${formatDate(task.endDate)}, ${task.progress}% concluído`}><em style={{ width: `${task.progress}%` }} /></i>}
          </span>
        </button>;
      })}
    </div>
  </div>;
}

function ListView({ tasks, onOpen }: { tasks: RoadmapTask[]; onOpen: (task: RoadmapTask) => void }) {
  return <div className="roadmap-list"><table><thead><tr><th>Tarefa</th><th>Fase</th><th>Período</th><th>Status</th><th>Progresso</th><th>Responsável</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} tabIndex={0} onClick={() => onOpen(task)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(task); }}><td><strong>{task.title}</strong>{task.isMilestone ? <small>Marco</small> : null}</td><td>{task.phaseName}</td><td>{formatDate(task.startDate)} — {formatDate(task.endDate)}</td><td><span className={`roadmap-status status-${task.status}`}>{ROADMAP_STATUS_LABELS[task.status]}</span></td><td>{task.progress}%</td><td>{person(task)}</td></tr>)}</tbody></table></div>;
}

type TaskForm = { title: string; description: string; phaseId: string; startDate: string; endDate: string; status: RoadmapTaskStatus; progress: number; priority: "low" | "normal" | "high" | "critical"; assigneeId: string; isMilestone: boolean };
function TaskDrawer({ open, task, bundle, canManage, canComment, organizationId, onClose, onSaved }: { open: boolean; task: RoadmapTask | null; bundle: RoadmapBundle; canManage: boolean; canComment: boolean; organizationId: number | string; onClose: () => void; onSaved: () => void }) {
  const initial: TaskForm = task ? { title: task.title, description: task.description || "", phaseId: String(task.phaseId), startDate: task.startDate, endDate: task.endDate, status: task.status, progress: task.progress, priority: task.priority, assigneeId: String(task.assigneeId || ""), isMilestone: task.isMilestone } : { title: "", description: "", phaseId: String(bundle.phases[0]?.id || ""), startDate: today(), endDate: today(), status: "planned", progress: 0, priority: "normal", assigneeId: "", isMilestone: false };
  const [form, setForm] = useState<TaskForm>(initial); const [comments, setComments] = useState<RoadmapComment[]>([]); const [comment, setComment] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { setForm(initial); setError(null); if (task && open) void listTaskComments(organizationId, bundle.roadmap.id, task.id).then(setComments).catch(() => setComments([])); else setComments([]); }, [open, task?.id]);
  if (!open) return null;
  async function save(event: React.FormEvent) { event.preventDefault(); if (!canManage) return; setBusy(true); setError(null); try { const payload = { ...form, phaseId: Number(form.phaseId), assigneeId: form.assigneeId ? Number(form.assigneeId) : null, version: task?.version }; if (task) await updateRoadmapTask(organizationId, bundle.roadmap.id, task.id, payload); else await createRoadmapTask(organizationId, bundle.roadmap.id, payload); onSaved(); onClose(); } catch (value) { setError(errorText(value)); } finally { setBusy(false); } }
  async function sendComment(event: React.FormEvent) { event.preventDefault(); if (!task || !comment.trim()) return; setBusy(true); try { setComments(await createTaskComment(organizationId, bundle.roadmap.id, task.id, comment)); setComment(""); } catch (value) { setError(errorText(value)); } finally { setBusy(false); } }
  return <div className="roadmap-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className="roadmap-drawer" role="dialog" aria-modal="true" aria-label={task ? `Detalhes de ${task.title}` : "Nova tarefa"}><header><div><small>{task ? "Tarefa do roadmap" : "Planejamento operacional"}</small><h3>{task ? task.title : "Nova tarefa"}</h3></div><button type="button" onClick={onClose} aria-label="Fechar">×</button></header><form onSubmit={save}>
    <label className="wide">Título<input value={form.title} disabled={!canManage} required maxLength={180} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
    <label className="wide">Descrição<textarea value={form.description} disabled={!canManage} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
    <label>Fase<MaonoSelect value={form.phaseId} disabled={!canManage} onChange={(e) => setForm({ ...form, phaseId: e.target.value })}>{bundle.phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</MaonoSelect></label>
    <label>Responsável<MaonoSelect value={form.assigneeId} disabled={!canManage} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}><option value="">Não atribuído</option>{bundle.assignees.map((item) => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</MaonoSelect></label>
    <label>Início<input type="date" value={form.startDate} disabled={!canManage} required onChange={(e) => setForm({ ...form, startDate: e.target.value, ...(form.isMilestone ? { endDate: e.target.value } : {}) })} /></label>
    <label>Fim<input type="date" value={form.endDate} disabled={!canManage || form.isMilestone} required onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
    <label>Status<MaonoSelect value={form.status} disabled={!canManage} onChange={(e) => setForm({ ...form, status: e.target.value as RoadmapTaskStatus })}>{Object.entries(ROADMAP_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</MaonoSelect></label>
    <label>Prioridade<MaonoSelect value={form.priority} disabled={!canManage} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskForm["priority"] })}>{Object.entries(ROADMAP_PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</MaonoSelect></label>
    <label className="wide">Progresso: {form.progress}%<input type="range" min="0" max="100" step="5" value={form.progress} disabled={!canManage} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} /></label>
    <label className="roadmap-check wide"><input type="checkbox" checked={form.isMilestone} disabled={!canManage || Boolean(task)} onChange={(e) => setForm({ ...form, isMilestone: e.target.checked, endDate: e.target.checked ? form.startDate : form.endDate, progress: e.target.checked && form.progress !== 100 ? 0 : form.progress })} /> Esta entrega é um marco</label>
    {error ? <p className="mm-error-text wide">{error}</p> : null}
    {canManage ? <footer className="wide">{task ? <button type="button" className="danger" disabled={busy} onClick={() => { if (window.confirm("Arquivar esta tarefa?")) void deleteRoadmapTask(organizationId, bundle.roadmap.id, task.id).then(() => { onSaved(); onClose(); }).catch((value) => setError(errorText(value))); }}>Arquivar</button> : <span />}<button type="submit" className="mm-button" disabled={busy}>{busy ? "Salvando..." : "Salvar tarefa"}</button></footer> : null}
  </form>{task ? <section className="roadmap-comments"><h4>Comentários</h4>{comments.length ? comments.map((item) => <article key={item.id}><strong>{item.authorName || "Usuário"}</strong><time>{new Date(item.createdAt).toLocaleString("pt-BR")}</time><p>{item.content}</p></article>) : <p>Nenhum comentário.</p>}{canComment ? <form onSubmit={sendComment}><textarea value={comment} maxLength={2000} placeholder="Adicione um comentário..." onChange={(e) => setComment(e.target.value)} /><button className="mm-button" disabled={busy || !comment.trim()}>Comentar</button></form> : null}</section> : null}</aside></div>;
}

export default function RoadmapSection({ user, organizationId, organizationName, onHome }: Props) {
  const context = useMemo(() => ({ organizationId: organizationId || undefined, organization: organizationId ? { id: organizationId } : undefined }), [organizationId]);
  const canView = can(user, PERMISSION.ROADMAP_VIEW, context); const canManage = can(user, PERMISSION.ROADMAP_MANAGE, context) || can(user, PERMISSION.ROADMAP_TASK_MANAGE, context); const canComment = can(user, PERMISSION.ROADMAP_COMMENT_CREATE, context);
  const [roadmaps, setRoadmaps] = useState<RoadmapSummary[]>([]); const [roadmapId, setRoadmapId] = useState<number | null>(null); const [bundle, setBundle] = useState<RoadmapBundle | null>(null); const [filters, setFilters] = useState<RoadmapFilters>(DEFAULT_ROADMAP_FILTERS); const [view, setView] = useState<RoadmapView>(() => (window.innerWidth < 760 ? "list" : "gantt")); const [scale, setScale] = useState<RoadmapScale>("week"); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null); const [drawerOpen, setDrawerOpen] = useState(false); const [selected, setSelected] = useState<RoadmapTask | null>(null); const requestRef = useRef(0);
  const queryKey = roadmapPaginationKey(organizationId, roadmapId, filters);
  const [loadedBundleKey, setLoadedBundleKey] = useState<string | null>(null);
  const [pagination, setPagination] = useState<RoadmapPaginationState>({ queryKey: "", pageIndex: 0, pageSize: 10 });
  const totalTasks = bundle?.tasks.length ?? 0;
  const resolvedPagination = reconcileRoadmapPagination(pagination, queryKey, totalTasks);
  const page = paginateRoadmapTasks(bundle?.tasks ?? [], resolvedPagination.pageIndex, resolvedPagination.pageSize);
  const paginationPending = loading || loadedBundleKey !== queryKey;
  useEffect(() => { setPagination(current => reconcileRoadmapPagination(current, queryKey, totalTasks)); }, [queryKey, totalTasks]);
  function changePage(pageIndex: number, pageSize: number = page.pageSize) { setPagination({ queryKey, pageIndex, pageSize }); }
  async function loadIndex(signal?: AbortSignal) { if (!organizationId || !canView) return; setLoading(true); try { const items = await listRoadmaps(organizationId, signal); setRoadmaps(items); setRoadmapId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || null); } catch (value) { if (!(value instanceof DOMException && value.name === "AbortError")) setError(errorText(value)); } finally { setLoading(false); } }
  async function loadBundle(background = false) { if (!organizationId || !roadmapId) { setBundle(null); return; } const id = ++requestRef.current; if (!background) setLoading(true); try { const value = await getRoadmap(organizationId, roadmapId, filters); if (id === requestRef.current) { setBundle(value); setLoadedBundleKey(queryKey); setError(null); } } catch (value) { if (id === requestRef.current) setError(errorText(value)); } finally { if (id === requestRef.current) setLoading(false); } }
  useEffect(() => { const controller = new AbortController(); setRoadmaps([]); setBundle(null); setLoadedBundleKey(null); setFilters(DEFAULT_ROADMAP_FILTERS); void loadIndex(controller.signal); return () => controller.abort(); }, [organizationId, canView]);
  useEffect(() => { const adapt = () => { if (window.innerWidth < 760) setView("list"); }; adapt(); window.addEventListener("resize", adapt); return () => window.removeEventListener("resize", adapt); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadBundle(), filters.search ? 250 : 0); return () => window.clearTimeout(timer); }, [roadmapId, filters]);
  async function quickCreateRoadmap() { if (!organizationId) return; const name = window.prompt("Nome do roadmap", `Roadmap ${organizationName || "da organização"}`); if (!name) return; const startDate = today(); const endDate = new Date(Date.now() + 120 * DAY).toISOString().slice(0, 10); try { const item = await createRoadmap(organizationId, { name, startDate, endDate, description: "Plano de prestação de serviços" }); setRoadmaps((current) => [item, ...current]); setRoadmapId(item.id); } catch (value) { setError(errorText(value)); } }
  const hasFilters = Object.values(filters).some(Boolean);
  const openTask = (task: RoadmapTask | null) => { setSelected(task); setDrawerOpen(true); };
  return <section className="roadmap-shell roadmap-workspace">
    <nav className="roadmap-breadcrumb" aria-label="Caminho da página">
      <Link to="/projects" onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onHome?.(); }}>Início</Link>
      <DocumentIcon name="chevron" /><span aria-current="page">Roadmap</span>
    </nav>
    <header className="roadmap-header">
      <div className="roadmap-heading">
        <h1>Roadmap</h1>
        <span className="mm-sr-only">Organização ativa: {organizationName || organizationId || "Nenhuma"}</span>
      </div>
      {organizationId && canView ? <div className="roadmap-header-actions">
        {roadmaps.length ? <MaonoSelect aria-label="Roadmap ativo" value={roadmapId || ""} onChange={event => setRoadmapId(Number(event.target.value))}>
          {roadmaps.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </MaonoSelect> : null}
        {canManage ? <button className="mm-button roadmap-primary-action" type="button" onClick={() => bundle ? openTask(null) : void quickCreateRoadmap()}>
          <DocumentIcon name="plus" />{bundle ? "Nova tarefa" : "Criar roadmap"}
        </button> : null}
      </div> : null}
    </header>
    {!organizationId ? <div className="roadmap-empty"><p>Selecione uma organização.</p></div> : !canView ? <div className="roadmap-empty"><p>Você não possui permissão para visualizar este roadmap.</p></div> : <>
      {error ? <div className="roadmap-error" role="alert"><span>{error}</span><button type="button" onClick={() => void (roadmapId ? loadBundle() : loadIndex())}>Tentar novamente</button></div> : null}
      {loading && !bundle ? <div className="roadmap-skeleton" role="status" aria-label="Carregando roadmap">{Array.from({ length: 8 }).map((_, index) => <span key={index} />)}</div> : bundle ? <>
        <section className="roadmap-tools" aria-label="Filtros do roadmap">
          <header className="roadmap-filter-header">
            <strong><DocumentIcon name="filter" />Filtros</strong>
            <button type="button" className="roadmap-clear" disabled={!hasFilters} onClick={() => setFilters(DEFAULT_ROADMAP_FILTERS)}><DocumentIcon name="restore" />Limpar filtros</button>
          </header>
          <div className="roadmap-filters">
            <label><span>Buscar tarefa</span><span className="roadmap-search"><DocumentIcon name="search" /><input type="search" placeholder="Título da tarefa" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /></span></label>
            <label><span>Status</span><MaonoSelect value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value as RoadmapFilters["status"] })}>
              <option value="">Todos os status</option>{Object.entries(ROADMAP_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </MaonoSelect></label>
            <label><span>Fase</span><MaonoSelect value={filters.phaseId} onChange={event => setFilters({ ...filters, phaseId: event.target.value })}>
              <option value="">Todas as fases</option>{bundle.phases.map(phase => <option key={phase.id} value={phase.id}>{phase.name}</option>)}
            </MaonoSelect></label>
            <label><span>Responsável</span><MaonoSelect value={filters.assigneeId} onChange={event => setFilters({ ...filters, assigneeId: event.target.value })}>
              <option value="">Todos os responsáveis</option>{bundle.assignees.map(item => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}
            </MaonoSelect></label>
          </div>
        </section>
        <RoadmapMetrics bundle={bundle} />
        <section className="roadmap-content" aria-label="Tarefas do roadmap" aria-busy={paginationPending}>
          <header className="roadmap-content-header">
            <h2>{view === "gantt" ? "Cronograma" : "Tarefas"}</h2>
            <div className="roadmap-view-tools">
              <MaonoSelect aria-label="Escala do cronograma" value={scale} onChange={event => setScale(event.target.value as RoadmapScale)} disabled={view === "list"}>
                <option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option>
              </MaonoSelect>
              <div className="roadmap-view-switch" role="group" aria-label="Visualização do roadmap">
                <button type="button" aria-pressed={view === "gantt"} className={view === "gantt" ? "active" : ""} onClick={() => setView("gantt")}>Gantt</button>
                <button type="button" aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}><DocumentIcon name="list" />Lista</button>
              </div>
            </div>
          </header>
          <div key={`${view}:${queryKey}:${page.pageIndex}:${page.pageSize}`} className="roadmap-scroll" tabIndex={0} role="region" aria-label={view === "gantt" ? "Rolagem do cronograma" : "Rolagem das tarefas"}>
            {bundle.tasks.length ? view === "gantt" ? <GanttView bundle={bundle} tasks={page.tasks} scale={scale} onOpen={openTask} /> : <ListView tasks={page.tasks} onOpen={openTask} /> : <div className="roadmap-empty"><strong>Nenhuma tarefa no período</strong><p>Ajuste os filtros ou registre a primeira entrega.</p>{canManage ? <button className="mm-button" type="button" onClick={() => openTask(null)}>Nova tarefa</button> : null}</div>}
          </div>
          <footer className="roadmap-pagination" aria-label="Paginação das tarefas">
            <DocumentsPagination
              status={paginationPending ? error && !loading ? "Não foi possível atualizar tarefas." : "Atualizando tarefas." : `Exibindo ${page.tasks.length}/${page.total}.`}
              page={page.pageIndex + 1} pageSize={page.pageSize}
              canGoPrevious={page.canGoPrevious} canGoNext={page.canGoNext}
              disabled={paginationPending} disablePageSize={paginationPending}
              onPageSize={size => changePage(0, size)}
              onPrevious={() => changePage(page.pageIndex - 1)} onNext={() => changePage(page.pageIndex + 1)}
            />
          </footer>
        </section>
        <TaskDrawer open={drawerOpen} task={selected} bundle={bundle} canManage={canManage} canComment={canComment} organizationId={organizationId} onClose={() => setDrawerOpen(false)} onSaved={() => void loadBundle(true)} />
      </> : !error ? <div className="roadmap-empty"><strong>Nenhum roadmap ativo</strong><p>Crie um plano para organizar fases, tarefas e marcos.</p>{canManage ? <button className="mm-button" type="button" onClick={() => void quickCreateRoadmap()}>Criar roadmap</button> : null}</div> : null}
    </>}
  </section>;
}
