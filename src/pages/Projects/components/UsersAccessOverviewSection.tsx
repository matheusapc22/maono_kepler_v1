import { useInitialLoadingPresentation } from "../../../components/loading/useInitialLoadingPresentation";
import { isRegionAccessDenied, isRegionAuthenticationError } from "../../../components/loading/region-loading-policy";
import { MaonoSelect } from "../../../components/selection/MaonoSelect";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Link } from "react-router";
import { UsersTableSkeletonRows } from "./ProjectSectionSkeletons";
import { LoadingStatus, Skeleton, StaticLoadingText } from "../../../components/loading/Skeleton";
import DocumentsPagination from "./DocumentsPagination";
import { DocumentActionMenu, DocumentIcon } from "./DocumentsUi";
import { paginateUsers, reconcileUsersPagination, type UsersPaginationState } from "./users-access-pagination";
import "./users-access-workspace.css";

import {
  getOrganizationLimits,
  listOrganizationUsers,
  type OrganizationLimits,
  type OrganizationUser,
} from "../../../lib/api";
import { normalizeUserError } from "../../../lib/user-error-catalog";
import OrganizationPermissionManager, {
  loadAccessGovernance,
  type AccessGovernanceCapabilities,
} from "../../../components/access/OrganizationPermissionManager";
import ProjectMapAccessManager from "../../../components/access/ProjectMapAccessManager";
import {
  accessFromCode,
  profileFromTechnical,
} from "./user-access-commercial";

type ApiId = number | string;

type MaonoUser = {
  id?: ApiId;
  role?: string | null;
  permissions?: string[];
  activeOrganizationId?: ApiId | null;
  organizationId?: ApiId | null;
  organization_id?: ApiId | null;
  [key: string]: unknown;
};

function roleOf(user: MaonoUser | null): string {
  return String(user?.role || "viewer").trim().toLowerCase();
}

function userPermissions(user: MaonoUser | null): string[] {
  return Array.isArray(user?.permissions)
    ? user.permissions.filter((item): item is string => typeof item === "string")
    : [];
}

function hasPermission(user: MaonoUser | null, permission: string): boolean {
  const role = roleOf(user);
  if (role === "super_admin") return true;
  if ((role === "owner" || role === "client") && ["users.view", "limits.view"].includes(permission)) return true;
  return userPermissions(user).includes(permission);
}

function canViewTeam(user: MaonoUser | null): boolean {
  const role = roleOf(user);
  return ["super_admin", "admin", "owner", "client"].includes(role) || hasPermission(user, "users.view");
}

function fallbackOrganizationId(user: MaonoUser | null): ApiId | null {
  const value = user?.activeOrganizationId ?? user?.organizationId ?? user?.organization_id;
  return typeof value === "number" || (typeof value === "string" && value) ? value : null;
}

function profileLabel(person: OrganizationUser): string {
  return profileFromTechnical(person.role, person.accessLevel)?.shortName ?? "Perfil personalizado";
}

function targetLevel(person: OrganizationUser): string {
  return String(person.accessLevel || "").trim().toLowerCase();
}

function sameId(left?: ApiId, right?: ApiId): boolean {
  return left !== undefined && right !== undefined && String(left) === String(right);
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("pt-BR").format(date);
}

type Props = {
  user: MaonoUser | null;
  organizationId?: ApiId | null;
  onHome?: () => void;
};

export default function UsersAccessOverviewSection({ user, organizationId: organizationIdProp, onHome }: Props) {
  const organizationId = organizationIdProp ?? fallbackOrganizationId(user);
  // A new authorization context remounts the workspace before rendering any old
  // rows, popovers or management targets, including an in-flight prior response.
  const contextKey = JSON.stringify([organizationId, user?.id, roleOf(user), userPermissions(user)]);
  return <UsersAccessWorkspace key={contextKey} user={user} organizationId={organizationId} onHome={onHome} />;
}

function UsersAccessWorkspace({ user, organizationId, onHome }: Props) {
  const [people, setPeople] = useState<OrganizationUser[]>([]);
  const [limits, setLimits] = useState<OrganizationLimits | null>(null);
  const [governance, setGovernance] = useState<AccessGovernanceCapabilities | null>(null);
  const [managementTargetUserId, setManagementTargetUserId] = useState<ApiId | null>(null);
  const [mapAccessTargetUserId, setMapAccessTargetUserId] = useState<ApiId | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [loading, setLoading] = useState(Boolean(organizationId && canViewTeam(user)));
  const [loaded, setLoaded] = useState(false);
  const [limitsLoading, setLimitsLoading] = useState(Boolean(organizationId && canViewTeam(user) && hasPermission(user, "limits.view")));
  const [governanceLoading, setGovernanceLoading] = useState(Boolean(organizationId && canViewTeam(user)));
  const requestRef = useRef(0);
  const workspaceRef = useRef<HTMLElement>(null);
  const focusReturnFrameRef = useRef<number | null>(null);
  const [pagination, setPagination] = useState<UsersPaginationState>({ queryKey: "", pageIndex: 0, pageSize: 10 });
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // Resolve the current row after React removes the dialog. A saved DOM node
  // can be detached by onSaved/load, pagination or a change of organization.
  function restorePersonActionFocus(targetId: ApiId | null) {
    if (focusReturnFrameRef.current !== null) window.cancelAnimationFrame(focusReturnFrameRef.current);
    if (targetId === null) return;
    const workspace = workspaceRef.current;
    const focusedAtClose = document.activeElement;
    focusReturnFrameRef.current = window.requestAnimationFrame(() => {
      focusReturnFrameRef.current = null;
      if (!workspace?.isConnected || workspaceRef.current !== workspace) return;
      // Never steal focus from a newer dialog or an intervening user action.
      if (workspace.querySelector('[role="dialog"]')) return;
      const focusedNow = document.activeElement;
      if (focusedNow !== document.body && focusedNow !== focusedAtClose && focusedNow?.isConnected) return;
      const row = Array.from(workspace.querySelectorAll<HTMLElement>('tr[data-user-id]'))
        .find(item => item.dataset.userId === String(targetId));
      const trigger = row?.querySelector<HTMLButtonElement>('button.mm-docs-menu-trigger');
      if (trigger?.isConnected && !trigger.disabled && trigger.getClientRects().length > 0) {
        trigger.focus({ preventScroll: true });
      }
    });
  }

  useEffect(() => () => {
    if (focusReturnFrameRef.current !== null) window.cancelAnimationFrame(focusReturnFrameRef.current);
  }, []);

  const canView = canViewTeam(user);
  const isSuperAdmin = roleOf(user) === "super_admin";

  const presentationScope = String(organizationId);
  const presentationCancelled = !organizationId || !canView;
  const peoplePresentation = useInitialLoadingPresentation({ pending: loading, hasData: loaded, scopeKey: presentationScope, failed: !loading && !loaded && message?.kind === "error", cancelled: presentationCancelled });
  const limitsPresentation = useInitialLoadingPresentation({ pending: limitsLoading, hasData: Boolean(limits), scopeKey: presentationScope, failed: !limitsLoading && !limits && message?.kind === "error", cancelled: presentationCancelled || !hasPermission(user, "limits.view") });
  const governancePresentation = useInitialLoadingPresentation({ pending: governanceLoading, hasData: Boolean(governance), scopeKey: presentationScope, failed: !governanceLoading && !governance && message?.kind === "error", cancelled: presentationCancelled });
  const structurePending = peoplePresentation.structurePending && message?.kind !== "error";
  const peoplePending = peoplePresentation.contentPending;
  const limitsPending = limitsPresentation.contentPending;
  const governancePending = governancePresentation.contentPending;
  const visiblePeople = loaded && !peoplePending;
  const visibleLimits = Boolean(limits) && !limitsPending;
  const presentationLoading = loading || limitsLoading || governanceLoading || peoplePending || limitsPending || governancePending;

  const load = useCallback(async () => {
    if (!organizationId || !canView) return;
    const readRevision = ++requestRef.current;
    const current = () => readRevision === requestRef.current;
    const reportReadError = (text: string) => {
      if (!current()) return;
      setMessage(previous => ({ kind: "error", text: previous?.kind === "error" ? `${previous.text} ${text}` : text }));
    };
    const clearDeniedContext = (error: unknown) => {
      if (!current()) return;
      reportReadError(normalizeUserError(error).message);
      requestRef.current += 1;
      setPeople([]); setLoaded(false); setLimits(null); setGovernance(null);
      setLoading(false); setLimitsLoading(false); setGovernanceLoading(false);
      setManagementTargetUserId(null); setMapAccessTargetUserId(null);
    };
    setLoading(true);
    setLimitsLoading(hasPermission(user, "limits.view"));
    setGovernanceLoading(true);
    setMessage(null);
    // Requests start together; each region commits as soon as its own data is ready.
    await Promise.all([
      listOrganizationUsers(organizationId).then(peopleResult => {
        if (!current()) return;
        setPeople(peopleResult.users ?? []);
        setLoaded(true);
      }).catch(error => {
        if (isRegionAccessDenied(error)) clearDeniedContext(error);
        else reportReadError(normalizeUserError(error).message);
      })
        .finally(() => { if (current()) setLoading(false); }),
      hasPermission(user, "limits.view")
        ? getOrganizationLimits(organizationId).then(limitResult => {
          if (current()) setLimits(limitResult?.limits ?? null);
        }).catch(error => {
          if (isRegionAuthenticationError(error)) { clearDeniedContext(error); return; }
          if (current() && isRegionAccessDenied(error)) setLimits(null);
          reportReadError("Os limites não puderam ser atualizados. A equipe continua disponível para consulta.");
        })
          .finally(() => { if (current()) setLimitsLoading(false); })
        : Promise.resolve(null),
      loadAccessGovernance(organizationId).then(governanceResult => {
        if (current()) setGovernance(governanceResult);
      }).catch(error => {
        if (!current()) return;
        if (isRegionAuthenticationError(error)) { clearDeniedContext(error); return; }
        setGovernance(null);
        reportReadError("A equipe continua disponível para consulta, mas as configurações de acesso não puderam ser carregadas. Tente novamente.");
      }).finally(() => { if (current()) setGovernanceLoading(false); }),
    ]);
  }, [canView, organizationId, user]);

  useEffect(() => {
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const delegatedAlternative = Boolean(
    governance?.mode === "organization" && governance.canManageAdditionalAccesses,
  );

  const canManagePerson = useCallback(
    (person: OrganizationUser) =>
      delegatedAlternative &&
      person.active !== false &&
      !sameId(person.id, user?.id) &&
      Boolean(governance?.allowedTargetLevels.includes(targetLevel(person))),
    [delegatedAlternative, governance, user?.id],
  );

  const canManageMapPerson = useCallback(
    (person: OrganizationUser) =>
      (isSuperAdmin || delegatedAlternative) &&
      person.active !== false &&
      !sameId(person.id, user?.id) &&
      (isSuperAdmin || Boolean(governance?.allowedTargetLevels.includes(targetLevel(person)))),
    [delegatedAlternative, governance, isSuperAdmin, user?.id],
  );

  const active = people.filter((item) => item.active !== false).length;
  const suspended = people.length - active;
  const limit = limits?.users.limit ?? Math.max(active, people.length);
  const available = Math.max(0, limit - active);
  const percent = limit > 0 ? Math.min(100, Math.round((active / limit) * 100)) : 0;

  const filtered = useMemo(
    () => people.filter((person) => {
      const text = (
        (person.name || "") + " " +
        (person.email || "") + " " +
        profileLabel(person) + " " +
        (person.permissions ?? []).map((code) => accessFromCode(code).name).join(" ")
      ).toLowerCase();
      if (query && !text.includes(query.toLowerCase())) return false;
      if (status === "active" && person.active === false) return false;
      if (status === "suspended" && person.active !== false) return false;
      if (profileFilter !== "all" && profileLabel(person) !== profileFilter) return false;
      return true;
    }),
    [people, profileFilter, query, status],
  );

  const queryKey = JSON.stringify([organizationId, query, status, profileFilter]);
  const resolvedPagination = reconcileUsersPagination(pagination, queryKey, filtered.length);
  const page = paginateUsers(filtered, resolvedPagination.pageIndex, resolvedPagination.pageSize);
  const hasFilters = Boolean(query || status !== "all" || profileFilter !== "all");
  useEffect(() => { setPagination(current => reconcileUsersPagination(current, queryKey, filtered.length)); }, [queryKey, filtered.length]);
  function changePage(pageIndex: number, pageSize: number = page.pageSize) { setPagination({ queryKey, pageIndex, pageSize }); }

  return (
    <section ref={workspaceRef} className="people-access-section users-access-workspace">
      <nav className="people-breadcrumb" aria-label="Caminho da página">
        <Link to="/projects" onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onHome?.(); }}><StaticLoadingText pending={structurePending}>Início</StaticLoadingText></Link>
        <DocumentIcon name="chevron" /><span aria-current="page"><StaticLoadingText pending={structurePending}>Usuários e Acessos</StaticLoadingText></span>
      </nav>
      <header className="people-access-header">
        <h1><StaticLoadingText pending={structurePending}>Usuários e Acessos</StaticLoadingText></h1>
        {organizationId && canView && isSuperAdmin && (
          <a className="mm-btn primary people-admin-action" href={"/admin?section=users&organization=" + encodeURIComponent(String(organizationId))}>
            <StaticLoadingText pending={structurePending}>Gerenciar no Painel Admin</StaticLoadingText>
          </a>
        )}
      </header>

      {!organizationId ? <div className="people-empty"><p>Não foi possível identificar a organização ativa.</p></div> : !canView ? <div className="people-empty"><p>Você não possui acesso para consultar a equipe.</p></div> : <>
        {message && <div className={"people-notice " + message.kind} role={message.kind === "error" ? "alert" : "status"}>
          <span>{message.text}</span>
          {message.kind === "error" && <button type="button" disabled={loading} onClick={() => void load()}>Tentar novamente</button>}
        </div>}

        <section className="people-tools" aria-label="Filtros de usuários">
          <header className="people-filter-header">
            <strong><DocumentIcon name="filter" /><StaticLoadingText pending={structurePending}>Filtros</StaticLoadingText></strong>
            <button type="button" className="people-clear" disabled={!hasFilters} onClick={() => { setQuery(""); setStatus("all"); setProfileFilter("all"); }}><DocumentIcon name="restore" /><StaticLoadingText pending={structurePending}>Limpar filtros</StaticLoadingText></button>
          </header>
          <div className="people-toolbar">
            <label><span><StaticLoadingText pending={structurePending}>Buscar</StaticLoadingText></span><span className="people-search"><DocumentIcon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, e-mail ou acesso" /></span></label>
            <label><span><StaticLoadingText pending={structurePending}>Situação</StaticLoadingText></span><MaonoSelect value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todas</option><option value="active">Ativo</option><option value="suspended">Suspenso</option></MaonoSelect></label>
            <label><span><StaticLoadingText pending={structurePending}>Perfil</StaticLoadingText></span><MaonoSelect value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)}><option value="all">Todos os perfis</option>{visiblePeople && Array.from(new Set(people.map(profileLabel))).map((label) => <option key={label}>{label}</option>)}</MaonoSelect></label>
          </div>
        </section>

        <section className="people-capacity-grid" aria-label="Indicadores da equipe">
          <article aria-busy={loading || peoplePending}><span><StaticLoadingText pending={structurePending}>Pessoas com acesso</StaticLoadingText></span><strong>{peoplePending ? <Skeleton width={54} height={29} /> : loaded ? active : "—"}</strong></article>
          <article aria-busy={limitsLoading || limitsPending}><span><StaticLoadingText pending={structurePending}>Limite da organização</StaticLoadingText></span><strong>{limitsPending ? <Skeleton width={54} height={29} /> : limits ? limit : "—"}</strong></article>
          <article aria-busy={loading || limitsLoading || peoplePending || limitsPending}><span><StaticLoadingText pending={structurePending}>Vagas disponíveis</StaticLoadingText></span><strong>{peoplePending || limitsPending ? <Skeleton width={54} height={29} /> : loaded && limits ? available : "—"}</strong></article>
          <article aria-busy={loading || peoplePending}><span><StaticLoadingText pending={structurePending}>Acessos suspensos</StaticLoadingText></span><strong>{peoplePending ? <Skeleton width={54} height={29} /> : loaded ? suspended : "—"}</strong></article>
        </section>

        <section className="people-content" aria-label="Pessoas da organização">
          <header className="people-content-header">
            <div><h2><StaticLoadingText pending={structurePending}>Equipe</StaticLoadingText></h2><p>{governancePending && !isSuperAdmin ? <Skeleton width="80%" height={16} /> : <StaticLoadingText pending={structurePending}>{delegatedAlternative ? "Delegação limitada ativa: use Mapa e Gerenciar nas ações de cada pessoa." : isSuperAdmin ? "Use Mapa nas ações de cada pessoa para gerenciar as rotas de projeto." : "Consulta operacional: alterações de acesso exigem delegação."}</StaticLoadingText>}</p></div>
            {visiblePeople && visibleLimits && <div className="people-capacity-progress"><span>{active} de {limit} acessos utilizados · {percent}%</span><progress aria-label="Capacidade de acessos utilizada" max="100" value={percent}>{percent}%</progress></div>}
          </header>
          <div key={`${queryKey}:${page.pageIndex}:${page.pageSize}`} className="people-table-wrap" tabIndex={0} role="region" aria-label="Lista de pessoas" aria-busy={loading || peoplePending}>
            <table aria-label="Usuários e acessos da organização">
              <thead><tr><th scope="col"><StaticLoadingText pending={structurePending}>Pessoa</StaticLoadingText></th><th scope="col"><StaticLoadingText pending={structurePending}>Situação</StaticLoadingText></th><th scope="col"><StaticLoadingText pending={structurePending}>Perfil</StaticLoadingText></th><th scope="col"><StaticLoadingText pending={structurePending}>Acessos adicionais</StaticLoadingText></th><th scope="col"><StaticLoadingText pending={structurePending}>Atualizado em</StaticLoadingText></th><th scope="col"><StaticLoadingText pending={structurePending}>Ações</StaticLoadingText></th></tr></thead>
              <tbody>
                {peoplePending ? <UsersTableSkeletonRows rows={page.pageSize} /> : null}
                {!loading && !peoplePending && !loaded && <tr><td colSpan={6} className="people-table-state">Não foi possível carregar a equipe. Tente novamente.</td></tr>}
                {visiblePeople && filtered.length === 0 && <tr><td colSpan={6} className="people-table-state">Nenhuma pessoa encontrada.</td></tr>}
                {visiblePeople && page.people.map((person) => {
                  const manageAdditional = canManagePerson(person);
                  const manageMap = canManageMapPerson(person);
                  return (
                    <tr key={String(person.id)} data-user-id={String(person.id)}>
                      <td><strong>{person.name || "Pessoa sem nome"}</strong><small>{person.email}</small></td>
                      <td><span className={"people-status " + (person.active === false ? "suspended" : "active")}>{person.active === false ? "Suspenso" : "Ativo"}</span></td>
                      <td>{profileLabel(person)}</td>
                      <td>{(person.permissions ?? []).length ? String(person.permissions?.length) + " acesso" + (person.permissions?.length === 1 ? "" : "s") : "Nenhum adicional"}</td>
                      <td>{formatDate(person.updatedAt ?? person.createdAt)}</td>
                      <td aria-busy={governanceLoading || governancePending}>{governancePending && !isSuperAdmin ? <Skeleton width={28} height={28} /> : manageMap || manageAdditional ? (
                        <DocumentActionMenu label={`Ações de ${person.name || person.email || "Pessoa sem nome"}`} actions={[
                          ...(manageMap ? [{ label: "Mapa", onSelect: () => setMapAccessTargetUserId(person.id) }] : []),
                          ...(manageAdditional ? [{ label: "Gerenciar", onSelect: () => setManagementTargetUserId(person.id) }] : []),
                        ]} />
                      ) : <button className="mm-docs-button mm-docs-menu-trigger" type="button" disabled aria-label={`Nenhuma ação disponível para ${person.name || person.email || "Pessoa sem nome"}`} title="Nenhuma ação disponível"><DocumentIcon name="more" /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="people-pagination" aria-label="Paginação de usuários">
            <DocumentsPagination
              structurePending={structurePending}
              status={presentationLoading ? <LoadingStatus announce={false} visuallyHidden={false} loading refreshing={visiblePeople} label="Carregando pessoas com acesso..." refreshingLabel={loading ? "Atualizando usuários." : limitsLoading ? "Carregando limites da organização." : "Carregando configurações de acesso."} /> : loaded ? `Exibindo ${page.people.length}/${page.total}.` : "Não foi possível atualizar usuários."}
              page={page.pageIndex + 1} pageSize={page.pageSize}
              canGoPrevious={page.canGoPrevious} canGoNext={page.canGoNext}
              disabled={loading || !visiblePeople} disablePageSize={loading || !visiblePeople}
              onPageSize={size => changePage(0, size)}
              onPrevious={() => changePage(page.pageIndex - 1)} onNext={() => changePage(page.pageIndex + 1)}
            />
          </footer>
        </section>

      {managementTargetUserId !== null && delegatedAlternative && (
        <OrganizationPermissionManager
          organizationId={organizationId}
          actorUserId={user?.id}
          initialTargetUserId={managementTargetUserId}
          mode="delegated"
          onClose={() => { setManagementTargetUserId(null); restorePersonActionFocus(managementTargetUserId); }}
          onSaved={load}
        />
      )}

      {mapAccessTargetUserId !== null && (isSuperAdmin || delegatedAlternative) && (
        <ProjectMapAccessManager
          organizationId={organizationId}
          userId={mapAccessTargetUserId}
          onClose={() => { setMapAccessTargetUserId(null); restorePersonActionFocus(mapAccessTargetUserId); }}
          onSaved={load}
        />
      )}
      </>}
    </section>
  );
}