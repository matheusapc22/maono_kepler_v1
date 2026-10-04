import assert from 'node:assert/strict';

// Exact inverse of only the reviewed progressive-loading changes. Independently
// pinned pre-change hashes below do not accept arbitrary selector/API changes.
export const progressiveBaselines = {
  "src/pages/Admin/components/AdminUserManagerLegacy.tsx": "2f22e9ed1bf80eaf501f8bf7d6f7554896369ac0c77028786cea92e03a59c4b9",
  "src/pages/Projects/components/ProjectPagesUi.tsx": "3c0988648d51bae64495710758f3b7ec29cdf4d28ad89a42db81a116670bb0d9",
  "src/pages/Projects.tsx": "0b0c72e874c69da3c0b33be54af11d1108b90cae880324799dba65bcb2b0ca13",
  "src/pages/Projects/components/ProjectsSection.tsx": "050c9def25565a1a734f66bbe5f3d7782c9862c72fb038db1f42b9af02ac3c67",
  "src/pages/Projects/components/ProjectCard.tsx": "ecc3bab2390caa27826d8475bd5ac3c37884894118788c8b2f92de519a2270eb",
  "src/pages/ProjectsSidebar.tsx": "7693f4946859773bb32d7b049e8daf733bf2e2e5e91cc2c4ebd9d14e21626fdc"
};
const changes = {
  "src/pages/Admin/components/AdminUserManagerLegacy.tsx": [
    {
      "before": "import { MaonoSelect } from \"../../../components/selection/MaonoSelect\";\nimport { useEffect, useMemo, useState, type FormEvent } from \"react\";\n\n",
      "after": "import { Skeleton } from \"../../../components/loading/Skeleton\";\nimport { useSkeletonCount } from \"../../../components/loading/useSkeletonCount\";\nimport { MaonoSelect } from \"../../../components/selection/MaonoSelect\";\nimport { useEffect, useMemo, useState, type FormEvent } from \"react\";\n\n"
    },
    {
      "before": "export default function AdminUserManager({\n  users,\n  organizations,\n  initialOrganizationId,\n  currentUserId,\n  isSuperAdmin,\n",
      "after": "export default function AdminUserManager({\n  users,\n  organizations,\n  loading = false,\n  usersLoaded = true,\n  organizationsLoaded = true,\n  initialOrganizationId,\n  currentUserId,\n  isSuperAdmin,\n"
    },
    {
      "before": "}: {\n  users: User[];\n  organizations: Organization[];\n  initialOrganizationId?: number | string | null;\n  currentUserId?: number;\n  isSuperAdmin: boolean;\n  onRefresh: () => Promise<void>;\n  onMessage: (kind: \"error\" | \"success\", text: string) => void;\n}) {\n  const [selected, setSelected] = useState<User | null>(null);\n  const [selectedView, setSelectedView] =\n    useState<UserManagementView>(\"profile\");\n",
      "after": "}: {\n  users: User[];\n  organizations: Organization[];\n  loading?: boolean;\n  usersLoaded?: boolean;\n  organizationsLoaded?: boolean;\n  initialOrganizationId?: number | string | null;\n  currentUserId?: number | string;\n  isSuperAdmin: boolean;\n  onRefresh: () => Promise<void>;\n  onMessage: (kind: \"error\" | \"success\", text: string) => void;\n}) {\n  const skeletonRows = useSkeletonCount({ layout: \"table\", itemHeight: 54, reservedHeight: 320, maxCount: 10 });\n  const [selected, setSelected] = useState<User | null>(null);\n  const [selectedView, setSelectedView] =\n    useState<UserManagementView>(\"profile\");\n"
    },
    {
      "before": "          Organização\n          <MaonoSelect\n            value={organizationFilter}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n",
      "after": "          Organização\n          <MaonoSelect\n            value={organizationFilter}\n            disabled={!organizationsLoaded}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n"
    },
    {
      "before": "          </MaonoSelect>\n        </label>\n        <span className=\"admin-user-filter-count\">\n          {filteredUsers.length} de {users.length} usuário(s)\n        </span>\n      </div>\n\n      <div className=\"admin-users-table\">\n        <table>\n          <thead>\n            <tr>\n              <th>Nome</th>\n              <th>E-mail</th>\n              <th>Perfil</th>\n              <th>Projetos</th>\n              <th>Status</th>\n              <th>Ações</th>\n            </tr>\n          </thead>\n          <tbody>\n            {filteredUsers.map((user) => (\n              <tr key={user.id}>\n                <td>{user.name || \"—\"}</td>\n                <td>{user.email}</td>\n",
      "after": "          </MaonoSelect>\n        </label>\n        <span className=\"admin-user-filter-count\">\n          {usersLoaded ? <>{filteredUsers.length} de {users.length} usuário(s)</> : loading ? \"Carregando usuários.\" : \"Contagem indisponível.\"}\n        </span>\n      </div>\n\n      <div className=\"admin-users-table\" aria-busy={loading}>\n        <table>\n          <thead>\n            <tr>\n              <th scope=\"col\">Nome</th>\n              <th scope=\"col\">E-mail</th>\n              <th scope=\"col\">Perfil</th>\n              <th scope=\"col\">Projetos</th>\n              <th scope=\"col\">Status</th>\n              <th scope=\"col\">Ações</th>\n            </tr>\n          </thead>\n          <tbody>\n            {loading && !usersLoaded ? Array.from({ length: skeletonRows }, (_, rowIndex) => (\n              <tr key={`pending-${rowIndex}`} aria-hidden=\"true\">{Array.from({ length: 6 }, (_, columnIndex) => <td key={columnIndex}><Skeleton width={`${55 + ((rowIndex + columnIndex) % 4) * 10}%`} height={12} /></td>)}</tr>\n            )) : null}\n            {usersLoaded && filteredUsers.map((user) => (\n              <tr key={user.id}>\n                <td>{user.name || \"—\"}</td>\n                <td>{user.email}</td>\n"
    },
    {
      "before": "                </td>\n              </tr>\n            ))}\n            {filteredUsers.length === 0 && (\n              <tr>\n                <td colSpan={6} className=\"admin-users-empty\">\n                  Nenhum usuário corresponde aos filtros selecionados.\n",
      "after": "                </td>\n              </tr>\n            ))}\n            {!loading && !usersLoaded ? <tr><td colSpan={6} className=\"admin-users-empty\">Dados de usuários indisponíveis.</td></tr> : null}\n            {usersLoaded && filteredUsers.length === 0 && (\n              <tr>\n                <td colSpan={6} className=\"admin-users-empty\">\n                  Nenhum usuário corresponde aos filtros selecionados.\n"
    }
  ],
  "src/pages/Projects/components/ProjectPagesUi.tsx": [
    {
      "before": "import { MaonoSelect } from \"../../../components/selection/MaonoSelect\";\nimport type { MouseEvent } from \"react\";\nimport { Link } from \"react-router\";\n",
      "after": "import { LoadingStatus } from \"../../../components/loading/Skeleton\";\nimport { MaonoSelect } from \"../../../components/selection/MaonoSelect\";\nimport type { MouseEvent } from \"react\";\nimport { Link } from \"react-router\";\n"
    },
    {
      "before": "  </form>;\n}\n\nexport function ProjectPagePagination({ visibleCount, total, page, pageCount, pageSize, disabled, onPage, onPageSize }: {\n  visibleCount: number; total: number; page: number; pageCount: number; pageSize: number;\n  disabled: boolean; onPage: (page: number) => void; onPageSize: (size: number) => void;\n}) {\n  return <footer className=\"mm-project-pages__footer\">\n    <p role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">Exibindo {visibleCount}/{total}.</p>\n    <nav className=\"mm-project-pages__pagination\" aria-label=\"Paginação dos projetos\">\n      <label>Itens por página<MaonoSelect value={pageSize} onChange={event => onPageSize(Number(event.target.value))} disabled={disabled}>\n        <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>\n      </MaonoSelect></label>\n      <button type=\"button\" className=\"mm-project-pages__button\" aria-label=\"Página anterior\" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}><ProjectPageIcon name=\"previous\" /></button>\n      <span className=\"mm-project-pages__current\" aria-current=\"page\" aria-label={`Página ${page} de ${pageCount}`}>{page}</span>\n      <button type=\"button\" className=\"mm-project-pages__button\" aria-label=\"Próxima página\" disabled={disabled || page >= pageCount} onClick={() => onPage(page + 1)}><ProjectPageIcon name=\"next\" /></button>\n    </nav>\n  </footer>;\n",
      "after": "  </form>;\n}\n\nexport function ProjectPagePagination({ visibleCount, total, page, pageCount, pageSize, disabled, loading = false, refreshing = false, unavailable = false, onPage, onPageSize }: {\n  visibleCount: number; total: number; page: number; pageCount: number; pageSize: number;\n  loading?: boolean; refreshing?: boolean; unavailable?: boolean;\n  disabled: boolean; onPage: (page: number) => void; onPageSize: (size: number) => void;\n}) {\n  return <footer className=\"mm-project-pages__footer\">\n    {loading ? <><p>{refreshing ? `Exibindo ${visibleCount}/${total}. Atualizando projetos.` : \"Carregando projetos.\"}</p><LoadingStatus loading={loading} refreshing={refreshing} label=\"Carregando projetos.\" refreshingLabel=\"Atualizando projetos.\" /></> : unavailable ? <p role=\"status\" aria-live=\"polite\">Contagem de projetos indisponível.</p> : <p role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">Exibindo {visibleCount}/{total}.</p>}\n    <nav className=\"mm-project-pages__pagination\" aria-label=\"Paginação dos projetos\">\n      <label>Itens por página<MaonoSelect value={pageSize} onChange={event => onPageSize(Number(event.target.value))} disabled={disabled}>\n        <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>\n      </MaonoSelect></label>\n      <button type=\"button\" className=\"mm-project-pages__button\" aria-label=\"Página anterior\" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}><ProjectPageIcon name=\"previous\" /></button>\n      <span className=\"mm-project-pages__current\" aria-current=\"page\" aria-label={loading && !refreshing || unavailable ? \"Paginação indisponível\" : `Página ${page} de ${pageCount}`}>{loading && !refreshing || unavailable ? \"—\" : page}</span>\n      <button type=\"button\" className=\"mm-project-pages__button\" aria-label=\"Próxima página\" disabled={disabled || page >= pageCount} onClick={() => onPage(page + 1)}><ProjectPageIcon name=\"next\" /></button>\n    </nav>\n  </footer>;\n"
    }
  ],
  "src/pages/Projects.tsx": [
    {
      "before": "import React, { useCallback, useEffect, useMemo, useRef, useState } from \"react\";\nimport { useNavigate } from \"react-router\";\n\nimport {\n",
      "after": "import React, { useCallback, useEffect, useMemo, useRef, useState } from \"react\";\nimport { isRegionAccessDenied } from \"../components/loading/region-loading-policy\";\nimport { useNavigate } from \"react-router\";\n\nimport {\n"
    },
    {
      "before": "  const [sidebarSection, setSidebarSection] =\n    useState<ProjectSidebarSection>(\"all\");\n  const [allProjects, setAllProjects] = useState<ProjectListItem[]>([]);\n  const [projectItems, setProjectItems] = useState<ProjectListItem[]>([]);\n  const [loadedProjectSection, setLoadedProjectSection] = useState<ProjectSectionKey | null>(null);\n  const [projectActionError, setProjectActionError] = useState<string | null>(null);\n  const currentSidebarSectionRef = useRef(sidebarSection);\n  currentSidebarSectionRef.current = sidebarSection;\n",
      "after": "  const [sidebarSection, setSidebarSection] =\n    useState<ProjectSidebarSection>(\"all\");\n  const [allProjects, setAllProjects] = useState<ProjectListItem[]>([]);\n  const [allProjectsReadState, setAllProjectsReadState] = useState<{ organizationKey: string; status: \"ready\" | \"denied\" } | null>(null);\n  const [projectItems, setProjectItems] = useState<ProjectListItem[]>([]);\n  const [loadedProjectSection, setLoadedProjectSection] = useState<ProjectSectionKey | null>(null);\n  const [projectDataKey, setProjectDataKey] = useState<string | null>(null);\n  const projectDataKeyRef = useRef(projectDataKey);\n  projectDataKeyRef.current = projectDataKey;\n  const [projectActionError, setProjectActionError] = useState<string | null>(null);\n  const currentSidebarSectionRef = useRef(sidebarSection);\n  currentSidebarSectionRef.current = sidebarSection;\n"
    },
    {
      "before": "    async (section: ProjectSectionKey) => {\n      if (!activeOrganizationId) {\n        setAllProjects([]);\n        setProjectItems([]);\n        setProjectsContextKey(null);\n        setProjectsLoading(false);\n        return;\n      }\n",
      "after": "    async (section: ProjectSectionKey) => {\n      if (!activeOrganizationId) {\n        setAllProjects([]);\n        setAllProjectsReadState(null);\n        setProjectItems([]);\n        setProjectsContextKey(null);\n        setProjectDataKey(null);\n        setProjectsLoading(false);\n        return;\n      }\n"
    },
    {
      "before": "      projectsRequestSequenceRef.current += 1;\n      const requestSequence = projectsRequestSequenceRef.current;\n      const requestOrganizationKey = String(activeOrganizationId);\n      projectsRequestControllerRef.current?.abort();\n      const controller = new AbortController();\n      projectsRequestControllerRef.current = controller;\n",
      "after": "      projectsRequestSequenceRef.current += 1;\n      const requestSequence = projectsRequestSequenceRef.current;\n      const requestOrganizationKey = String(activeOrganizationId);\n      const requestDataKey = JSON.stringify([requestOrganizationKey, section]);\n      projectsRequestControllerRef.current?.abort();\n      const controller = new AbortController();\n      projectsRequestControllerRef.current = controller;\n"
    },
    {
      "before": "        }\n        if (section === \"all\") {\n          setAllProjects(reconciled);\n        }\n        setProjectItems(reconciled);\n        setLoadedProjectSection(section);\n      } catch (requestFailure) {\n        if (\n",
      "after": "        }\n        if (section === \"all\") {\n          setAllProjects(reconciled);\n          setAllProjectsReadState({ organizationKey: requestOrganizationKey, status: \"ready\" });\n        }\n        setProjectItems(reconciled);\n        setProjectDataKey(requestDataKey);\n        setLoadedProjectSection(section);\n      } catch (requestFailure) {\n        if (\n"
    },
    {
      "before": "          return;\n        }\n\n        setProjectItems([]);\n        setLoadedProjectSection(section);\n        setProjectsError(normalizeUserError(requestFailure).message);\n      } finally {\n",
      "after": "          return;\n        }\n\n        const failure = requestFailure as { status?: number; category?: string; code?: string };\n        const status = Number(failure?.status || 0);\n        const accessDenied = isRegionAccessDenied(requestFailure);\n        const transient = !accessDenied && (status === 0 || status >= 500 || [408, 425, 429].includes(status));\n        const retainCurrentData = transient && projectDataKeyRef.current === requestDataKey;\n        if (!retainCurrentData) {\n          setProjectItems([]);\n          setProjectDataKey(null);\n          if (section === \"all\" || accessDenied) {\n            setAllProjects([]);\n            setAllProjectsReadState(accessDenied ? { organizationKey: requestOrganizationKey, status: \"denied\" } : null);\n          }\n        }\n        setLoadedProjectSection(section);\n        setProjectsError(normalizeUserError(requestFailure).message);\n      } finally {\n"
    },
    {
      "before": "    switchingOrganization || organizationTransitionPending || ticketLinkRestoring;\n  const visibleProjectItems = projectContextIsCurrent && loadedProjectSection === sidebarSection ? projectItems : [];\n\n  const activeProjects = useMemo(() => {\n    const source =\n      projectContextIsCurrent && allProjects.length > 0\n        ? allProjects\n        : sessionProjects;\n\n    return source.filter((project) => project.active !== false);\n  }, [allProjects, projectContextIsCurrent, sessionProjects]);\n\n  useEffect(() => {\n    if (!loading && !authenticated) {\n",
      "after": "    switchingOrganization || organizationTransitionPending || ticketLinkRestoring;\n  const visibleProjectItems = projectContextIsCurrent && loadedProjectSection === sidebarSection ? projectItems : [];\n\n  const currentAllProjectsRead = allProjectsReadState?.organizationKey === activeOrganizationKey ? allProjectsReadState.status : null;\n  const activeProjects = useMemo(() => {\n    const source = currentAllProjectsRead === \"denied\" ? []\n      : projectContextIsCurrent && currentAllProjectsRead === \"ready\"\n        ? allProjects\n        : sessionProjects;\n\n    return source.filter((project) => project.active !== false);\n  }, [allProjects, currentAllProjectsRead, projectContextIsCurrent, sessionProjects]);\n  // An empty normalized session may also mean unavailable list metadata. Only\n  // a completed all-projects read proves zero; nonempty authorized cache is usable.\n  const activeProjectsCount = currentAllProjectsRead === \"denied\" ? null\n    : currentAllProjectsRead === \"ready\" || sessionProjects.length > 0 ? activeProjects.length : null;\n\n  useEffect(() => {\n    if (!loading && !authenticated) {\n"
    },
    {
      "before": "    setSearchQuery(\"\");\n    setSidebarSection(\"all\");\n    setAllProjects([]);\n    setProjectItems([]);\n    setProjectsContextKey(null);\n    setProjectsError(null);\n    setProjectsLoading(false);\n    setFavoriteBusySlugs({});\n",
      "after": "    setSearchQuery(\"\");\n    setSidebarSection(\"all\");\n    setAllProjects([]);\n    setAllProjectsReadState(null);\n    setProjectItems([]);\n    setProjectsContextKey(null);\n    setProjectDataKey(null);\n    setProjectsError(null);\n    setProjectsLoading(false);\n    setFavoriteBusySlugs({});\n"
    },
    {
      "before": "          organizations={organizations}\n          switchingOrganization={organizationTransitionActive}\n          organizationSwitchError={organizationSwitchError}\n          activeProjectsCount={activeProjects.length}\n          searchQuery={searchQuery}\n          sidebarSection={sidebarSection}\n          onSearchQueryChange={setSearchQuery}\n",
      "after": "          organizations={organizations}\n          switchingOrganization={organizationTransitionActive}\n          organizationSwitchError={organizationSwitchError}\n          activeProjectsCount={activeProjectsCount}\n          searchQuery={searchQuery}\n          sidebarSection={sidebarSection}\n          onSearchQueryChange={setSearchQuery}\n"
    },
    {
      "before": "                actionError={projectActionError}\n                onDismissActionError={() => setProjectActionError(null)}\n                loading={projectsLoading || (loadedProjectSection !== sidebarSection && !projectsError)}\n                error={projectsError}\n                favoriteBusySlugs={favoriteBusySlugs}\n                canProjectSave={(project) =>\n",
      "after": "                actionError={projectActionError}\n                onDismissActionError={() => setProjectActionError(null)}\n                loading={projectsLoading || (loadedProjectSection !== sidebarSection && !projectsError)}\n                loaded={projectContextIsCurrent && projectDataKey === JSON.stringify([activeOrganizationKey, sidebarSection])}\n                error={projectsError}\n                favoriteBusySlugs={favoriteBusySlugs}\n                canProjectSave={(project) =>\n"
    }
  ],
  "src/pages/Projects/components/ProjectsSection.tsx": [
    {
      "before": "  actionError?: string | null;\n  onDismissActionError?: () => void;\n  loading?: boolean;\n  error?: string | null;\n  favoriteBusySlugs?: Record<string, true>;\n  canProjectSave: (project: ProjectListItem) => boolean;\n",
      "after": "  actionError?: string | null;\n  onDismissActionError?: () => void;\n  loading?: boolean;\n  loaded?: boolean;\n  error?: string | null;\n  favoriteBusySlugs?: Record<string, true>;\n  canProjectSave: (project: ProjectListItem) => boolean;\n"
    },
    {
      "before": "  actionError = null,\n  onDismissActionError,\n  loading = false,\n  error = null,\n  favoriteBusySlugs = {},\n  canProjectSave,\n",
      "after": "  actionError = null,\n  onDismissActionError,\n  loading = false,\n  loaded = projects.length > 0 || !loading,\n  error = null,\n  favoriteBusySlugs = {},\n  canProjectSave,\n"
    },
    {
      "before": "    <div className=\"mm-project-pages__workspace\">\n      <ProjectPageFiltersForm\n        value={draftFilters}\n        disabled={loading && projects.length === 0}\n        onChange={setDraftFilters}\n        onApply={() => {\n          setAppliedFilters({ ...draftFilters });\n",
      "after": "    <div className=\"mm-project-pages__workspace\">\n      <ProjectPageFiltersForm\n        value={draftFilters}\n        disabled={false}\n        onChange={setDraftFilters}\n        onApply={() => {\n          setAppliedFilters({ ...draftFilters });\n"
    },
    {
      "before": "      {error ? <section className=\"mm-project-pages__empty\" role=\"alert\">\n        <h2>Não foi possível carregar os projetos</h2><p>{error}</p>\n        {onRetry ? <button type=\"button\" className=\"mm-project-pages__button\" onClick={onRetry}>Tentar novamente</button> : null}\n      </section> : loading && projects.length === 0 ? <ProjectGridSkeleton /> : filteredProjects.length === 0 ? <section className=\"mm-project-pages__empty\">\n        <ProjectPageIcon name={copy.icon} /><h2>{copy.empty}</h2>\n        {hasAppliedFilters ? <p>Tente outra busca ou limpe os filtros.</p> : null}\n      </section> : (\n",
      "after": "      {error ? <section className=\"mm-project-pages__empty\" role=\"alert\">\n        <h2>Não foi possível carregar os projetos</h2><p>{error}</p>\n        {onRetry ? <button type=\"button\" className=\"mm-project-pages__button\" onClick={onRetry}>Tentar novamente</button> : null}\n      </section> : null}\n      {loading && !loaded ? <ProjectGridSkeleton pageSize={pageSize} announce={false} className=\"mm-project-pages__grid\" /> : !loaded && error ? null : filteredProjects.length === 0 ? <section className=\"mm-project-pages__empty\" aria-busy={loading}>\n        <ProjectPageIcon name={copy.icon} /><h2>{copy.empty}</h2>\n        {hasAppliedFilters ? <p>Tente outra busca ou limpe os filtros.</p> : null}\n      </section> : (\n"
    },
    {
      "before": "          />\n        ))}\n\n        {loading ? (\n          <span className=\"mm-sr-only\" role=\"status\" aria-live=\"polite\">\n            Atualizando projetos.\n          </span>\n        ) : null}\n      </section>\n      )}\n      <ProjectPagePagination\n        visibleCount={error ? 0 : visibleProjects.length}\n        total={error ? 0 : pagination.total}\n        page={pagination.page}\n        pageCount={pagination.pageCount}\n        pageSize={pageSize}\n",
      "after": "          />\n        ))}\n\n      </section>\n      )}\n      <ProjectPagePagination\n        loading={loading}\n        refreshing={loaded}\n        unavailable={!loaded && Boolean(error)}\n        visibleCount={visibleProjects.length}\n        total={pagination.total}\n        page={pagination.page}\n        pageCount={pagination.pageCount}\n        pageSize={pageSize}\n"
    }
  ],
  "src/pages/Projects/components/ProjectCard.tsx": [
    {
      "before": "import React from \"react\";\nimport { useHref, useNavigate } from \"react-router\";\n\nimport \"./project-card-interactions.css\";\n",
      "after": "import React from \"react\";\nimport { LoadingStatus, Skeleton } from \"../../../components/loading/Skeleton\";\nimport { useHref, useNavigate } from \"react-router\";\n\nimport \"./project-card-interactions.css\";\n"
    },
    {
      "before": "  return (\n    <div\n      className={`mm-project-card__preview-fallback is-${presentation}`}\n      role={presentation === \"loading-neutral\" ? \"status\" : \"img\"}\n      aria-label={`${copy.title} do projeto ${projectName}. ${copy.description}`}\n      data-preview-state={presentation}\n    >\n      <span aria-hidden=\"true\">{copy.icon}</span>\n      <strong>{copy.title}</strong>\n      <small>{copy.description}</small>\n",
      "after": "  return (\n    <div\n      className={`mm-project-card__preview-fallback is-${presentation}`}\n      role=\"img\"\n      aria-label={`${copy.title} do projeto ${projectName}. ${copy.description}`}\n      data-preview-state={presentation}\n    >\n      {presentation === \"loading-neutral\" ? <Skeleton className=\"mm-skeleton-fill\" radius={0} /> : null}\n      <span aria-hidden=\"true\">{copy.icon}</span>\n      <strong>{copy.title}</strong>\n      <small>{copy.description}</small>\n"
    },
    {
      "before": "    (previewState.decodedUrl === displayImageUrl ||\n      isProjectThumbnailDecoded(project, displayImageUrl));\n  displayedSourceRef.current = displayImageUrl;\n  const showGenerationSvg =\n    previewPresentation === \"generation-svg\";\n  const neutralPresentation:\n",
      "after": "    (previewState.decodedUrl === displayImageUrl ||\n      isProjectThumbnailDecoded(project, displayImageUrl));\n  displayedSourceRef.current = displayImageUrl;\n  React.useEffect(() => {\n    displayedSourceRef.current = displayImageUrl;\n    return () => { displayedSourceRef.current = null; };\n  }, [displayImageUrl]);\n  const showGenerationSvg =\n    previewPresentation === \"generation-svg\";\n  const neutralPresentation:\n"
    },
    {
      "before": "    thumbnailStatus === \"PENDING\" ||\n    (PROJECT_PREVIEW_TRANSITION_V2_ENABLED &&\n      thumbnailStatus === \"READY\" &&\n      showGenerationSvg);\n\n  const markDisplayedImageFailed = React.useCallback(\n    (failedUrl: string) => {\n      logPreviewTransition(\n        \"image-error\",\n        project.slug,\n",
      "after": "    thumbnailStatus === \"PENDING\" ||\n    (PROJECT_PREVIEW_TRANSITION_V2_ENABLED &&\n      thumbnailStatus === \"READY\" &&\n      showGenerationSvg) || neutralPresentation === \"loading-neutral\";\n\n  const markDisplayedImageFailed = React.useCallback(\n    (failedUrl: string) => {\n      if (displayedSourceRef.current !== failedUrl) return;\n      logPreviewTransition(\n        \"image-error\",\n        project.slug,\n"
    },
    {
      "before": "      role=\"link\"\n      tabIndex={opening ? -1 : 0}\n      aria-label={`Abrir projeto ${project.name}`}\n      aria-busy={previewBusy}\n      aria-disabled={opening}\n      onClick={handleCardClick}\n      onAuxClick={(event) => {\n",
      "after": "      role=\"link\"\n      tabIndex={opening ? -1 : 0}\n      aria-label={`Abrir projeto ${project.name}`}\n      aria-disabled={opening}\n      onClick={handleCardClick}\n      onAuxClick={(event) => {\n"
    },
    {
      "before": "      }}\n      onKeyDown={handleCardKeyDown}\n    >\n      <div\n        className=\"mm-project-card__preview\"\n        data-preview-presentation={previewPresentation}\n      >\n        {showGenerationSvg ? (\n",
      "after": "      }}\n      onKeyDown={handleCardKeyDown}\n    >\n      <div className=\"mm-project-card__media-region\">\n      <div\n        className=\"mm-project-card__preview\"\n        aria-busy={previewBusy}\n        data-preview-presentation={previewPresentation}\n      >\n        {showGenerationSvg ? (\n"
    },
    {
      "before": "        ) : null}\n      </div>\n\n      <div className=\"mm-project-card__content\">\n        <header className=\"mm-project-card__header\">\n          <h2 title={project.name}>{project.name}</h2>\n",
      "after": "        ) : null}\n      </div>\n\n      <LoadingStatus loading={previewBusy} label={`Carregando prévia do projeto ${project.name}.`} prolongedLabel={`A prévia do projeto ${project.name} continua em preparação.`} />\n      </div>\n      <div className=\"mm-project-card__content\">\n        <header className=\"mm-project-card__header\">\n          <h2 title={project.name}>{project.name}</h2>\n"
    }
  ],
  "src/pages/ProjectsSidebar.tsx": [
    {
      "before": "  organizations: MaonoOrganization[];\n  switchingOrganization: boolean;\n  organizationSwitchError: string | null;\n  activeProjectsCount: number;\n  searchQuery: string;\n  sidebarSection: ProjectSidebarSection;\n  onSearchQueryChange: (value: string) => void;\n",
      "after": "  organizations: MaonoOrganization[];\n  switchingOrganization: boolean;\n  organizationSwitchError: string | null;\n  activeProjectsCount: number | null;\n  searchQuery: string;\n  sidebarSection: ProjectSidebarSection;\n  onSearchQueryChange: (value: string) => void;\n"
    },
    {
      "before": "  key?: ProjectSidebarSection;\n  label: string;\n  icon: React.ReactNode;\n  count?: number;\n  href?: string;\n  permission?: Permission;\n};\n",
      "after": "  key?: ProjectSidebarSection;\n  label: string;\n  icon: React.ReactNode;\n  count?: number | null;\n  href?: string;\n  permission?: Permission;\n};\n"
    },
    {
      "before": "  return can(user as AccessControlUser, item.permission, context);\n}\n\nfunction createSidebarGroups(activeProjectsCount: number): SidebarGroup[] {\n  return [\n    {\n      title: \"Projetos\",\n",
      "after": "  return can(user as AccessControlUser, item.permission, context);\n}\n\nfunction createSidebarGroups(activeProjectsCount: number | null): SidebarGroup[] {\n  return [\n    {\n      title: \"Projetos\",\n"
    },
    {
      "before": "\n      {typeof item.count === \"number\" ? (\n        <span className=\"mm-sidebar-count\">{item.count}</span>\n      ) : null}\n    </>\n  );\n",
      "after": "\n      {typeof item.count === \"number\" ? (\n        <span className=\"mm-sidebar-count\">{item.count}</span>\n      ) : item.count === null ? (\n        <span className=\"mm-sidebar-count\" aria-label=\"Contagem de projetos indisponível\">—</span>\n      ) : null}\n    </>\n  );\n"
    }
  ]
};

export function restoreAdminProjectsProgressiveLoading(path, source) {
  for (const { before, after } of changes[path] || []) {
    assert.equal(source.split(after).length - 1, 1, `exact approved progressive-loading edit: ${path}`);
    source = source.replace(after, before);
  }
  return source;
}
