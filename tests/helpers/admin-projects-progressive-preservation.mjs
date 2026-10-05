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

// Exact inverse of the separately reviewed 80 ms structure / 260 ms content presentation.
// Applied in reverse edit order before the original pinned-baseline inverse.
const initialStageChanges = {
  "src/pages/Admin.tsx": [
    {
      "before": "import { AdminPageSkeleton, LoadingStatus, Skeleton }",
      "after": "import { StaticLoadingText, useInitialLoadingPresentation } from \"../components/loading\";\nimport { AdminPageSkeleton, LoadingStatus, Skeleton }"
    },
    {
      "before": "  const isRefreshing = Object.values(regions).some(region => region.pending);",
      "after": "  const isRefreshing = Object.values(regions).some(region => region.pending);\n  const { structurePending } = useInitialLoadingPresentation({\n    pending: isRefreshing, hasData: Object.values(regions).some(region => region.loaded),\n    scopeKey: \"admin-structure\", failed: Boolean(error) || Object.values(regions).some(region => Boolean(region.error)),\n  });\n  const projectPresentation = useInitialLoadingPresentation({ pending: regions.projects.pending, hasData: regions.projects.loaded, scopeKey: \"admin-projects\", failed: Boolean(error || regions.projects.error) });\n  const organizationPresentation = useInitialLoadingPresentation({ pending: regions.organizations.pending, hasData: regions.organizations.loaded, scopeKey: \"admin-organizations\", failed: Boolean(error || regions.organizations.error) });\n  const userPresentation = useInitialLoadingPresentation({ pending: regions.users.pending, hasData: regions.users.loaded, scopeKey: \"admin-users\", failed: Boolean(error || regions.users.error) });\n  const presentationPending = projectPresentation.contentPending || organizationPresentation.contentPending || userPresentation.contentPending;"
    },
    {
      "before": "          <AdminMetric label=\"Organizações\" value={activeOrganizations.length} state={regions.organizations} />",
      "after": "          <AdminMetric label=\"Organizações\" value={activeOrganizations.length} state={regions.organizations} structurePending={structurePending} contentPending={organizationPresentation.contentPending} />"
    },
    {
      "before": "          <AdminMetric label=\"Projetos\" value={activeProjects.length} state={regions.projects} />",
      "after": "          <AdminMetric label=\"Projetos\" value={activeProjects.length} state={regions.projects} structurePending={structurePending} contentPending={projectPresentation.contentPending} />"
    },
    {
      "before": "          <AdminMetric label=\"Usuários\" value={activeUsers.length} state={regions.users} />",
      "after": "          <AdminMetric label=\"Usuários\" value={activeUsers.length} state={regions.users} structurePending={structurePending} contentPending={userPresentation.contentPending} />"
    },
    {
      "before": "          <AdminMetric label=\"Arquivos\" value={totalFiles} state={regions.organizations} />",
      "after": "          <AdminMetric label=\"Arquivos\" value={totalFiles} state={regions.organizations} structurePending={structurePending} contentPending={organizationPresentation.contentPending} />"
    },
    {
      "before": "<Table state={regions.organizations}",
      "after": "<Table state={regions.organizations} structurePending={structurePending} contentPending={organizationPresentation.contentPending}"
    },
    {
      "before": "<Table state={regions.projects}",
      "after": "<Table state={regions.projects} structurePending={structurePending} contentPending={projectPresentation.contentPending}"
    },
    {
      "before": "        organizationsLoaded={regions.organizations.loaded}",
      "after": "        organizationsLoaded={regions.organizations.loaded}\n        structurePending={structurePending}\n        usersContentPending={userPresentation.contentPending}\n        organizationsContentPending={organizationPresentation.contentPending}"
    },
    {
      "before": "            <h2>Gestão de Organizações</h2>",
      "after": "            <h2><StaticLoadingText pending={structurePending}>Gestão de Organizações</StaticLoadingText></h2>"
    },
    {
      "before": "            <h2>Projetos e Mapas</h2>",
      "after": "            <h2><StaticLoadingText pending={structurePending}>Projetos e Mapas</StaticLoadingText></h2>"
    },
    {
      "before": "            <h2>Auditoria</h2>",
      "after": "            <h2><StaticLoadingText pending={structurePending}>Auditoria</StaticLoadingText></h2>"
    },
    {
      "before": "        <h2>Gestão de Organizações</h2>",
      "after": "        <h2><StaticLoadingText pending={structurePending}>Gestão de Organizações</StaticLoadingText></h2>"
    },
    {
      "before": "        <h2>Projetos e Mapas</h2>",
      "after": "        <h2><StaticLoadingText pending={structurePending}>Projetos e Mapas</StaticLoadingText></h2>"
    },
    {
      "before": "        <h2>Solicitações</h2>",
      "after": "        <h2><StaticLoadingText pending={structurePending}>Solicitações</StaticLoadingText></h2>"
    },
    {
      "before": "        <h2>Auditoria</h2>",
      "after": "        <h2><StaticLoadingText pending={structurePending}>Auditoria</StaticLoadingText></h2>"
    },
    {
      "before": "        <h2>Sistema</h2>",
      "after": "        <h2><StaticLoadingText pending={structurePending}>Sistema</StaticLoadingText></h2>"
    },
    {
      "before": "            <p>Organizações, documentos, projetos e limites.</p>",
      "after": "            <p><StaticLoadingText pending={structurePending}>Organizações, documentos, projetos e limites.</StaticLoadingText></p>"
    },
    {
      "before": "            <p>Mapas, vínculos, previews e configurações.</p>",
      "after": "            <p><StaticLoadingText pending={structurePending}>Mapas, vínculos, previews e configurações.</StaticLoadingText></p>"
    },
    {
      "before": "            <p>Eventos, bloqueios e ações administrativas.</p>",
      "after": "            <p><StaticLoadingText pending={structurePending}>Eventos, bloqueios e ações administrativas.</StaticLoadingText></p>"
    },
    {
      "before": "        <p>Arquivos e documentos por organização.</p>",
      "after": "        <p><StaticLoadingText pending={structurePending}>Arquivos e documentos por organização.</StaticLoadingText></p>"
    },
    {
      "before": "        <p>Mapas, configurações, previews e vínculos.</p>",
      "after": "        <p><StaticLoadingText pending={structurePending}>Mapas, configurações, previews e vínculos.</StaticLoadingText></p>"
    },
    {
      "before": "        <p>Criação, revisão e suporte.</p>",
      "after": "        <p><StaticLoadingText pending={structurePending}>Criação, revisão e suporte.</StaticLoadingText></p>"
    },
    {
      "before": "        <p>Eventos e ações administrativas.</p>",
      "after": "        <p><StaticLoadingText pending={structurePending}>Eventos e ações administrativas.</StaticLoadingText></p>"
    },
    {
      "before": "        <p>React, Vite, Cloudflare Pages Functions, D1 e Kepler.gl.</p>",
      "after": "        <p><StaticLoadingText pending={structurePending}>React, Vite, Cloudflare Pages Functions, D1 e Kepler.gl.</StaticLoadingText></p>"
    },
    {
      "before": "            <p>Acesso administrativo.</p>",
      "after": "            <p><StaticLoadingText pending={structurePending}>Acesso administrativo.</StaticLoadingText></p>"
    },
    {
      "before": "<strong>Maõno Admin</strong>",
      "after": "<strong><StaticLoadingText pending={structurePending}>Maõno Admin</StaticLoadingText></strong>"
    },
    {
      "before": "<span>{roleLabel(user?.role)}</span>",
      "after": "<span><StaticLoadingText pending={structurePending}>{roleLabel(user?.role)}</StaticLoadingText></span>"
    },
    {
      "before": "              {item.label}",
      "after": "              <StaticLoadingText pending={structurePending}>{item.label}</StaticLoadingText>"
    },
    {
      "before": "<p className=\"mm-eyebrow\">Administração Maõno</p>",
      "after": "<p className=\"mm-eyebrow\"><StaticLoadingText pending={structurePending}>Administração Maõno</StaticLoadingText></p>"
    },
    {
      "before": "<h1>{sectionTitle(section)}</h1>",
      "after": "<h1><StaticLoadingText pending={structurePending}>{sectionTitle(section)}</StaticLoadingText></h1>"
    },
    {
      "before": "<span className=\"mm-user-chip gold\">{roleLabel(user?.role)}</span>",
      "after": "<span className=\"mm-user-chip gold\"><StaticLoadingText pending={structurePending}>{roleLabel(user?.role)}</StaticLoadingText></span>"
    },
    {
      "before": "<LoadingStatus loading={isRefreshing}",
      "after": "<LoadingStatus loading={isRefreshing || presentationPending}"
    },
    {
      "before": "function AdminMetric({ label, value, state }: { label: string; value: number; state: AdminRegionState }) {\n  return <article className=\"mm-card metric\" aria-busy={state.pending}>\n    <span>{label}</span>\n    {state.loaded ? <strong>{value}</strong> : state.pending ? <Skeleton width={54} height={30} /> : <strong aria-label=\"Indisponível\">—</strong>}",
      "after": "function AdminMetric({ label, value, state, structurePending, contentPending }: { label: string; value: number; state: AdminRegionState; structurePending: boolean; contentPending: boolean }) {\n  return <article className=\"mm-card metric\" aria-busy={state.pending || contentPending}>\n    <span><StaticLoadingText pending={structurePending}>{label}</StaticLoadingText></span>\n    {contentPending ? <Skeleton width={54} height={30} /> : state.loaded ? <strong>{value}</strong> : <strong aria-label=\"Indisponível\">—</strong>}"
    },
    {
      "before": "function Table({ headers, rows, state }: { headers: string[]; rows: string[][]; state: AdminRegionState }) {",
      "after": "function Table({ headers, rows, state, structurePending, contentPending }: { headers: string[]; rows: string[][]; state: AdminRegionState; structurePending: boolean; contentPending: boolean }) {"
    },
    {
      "before": "<div className=\"mm-table-wrap\" aria-busy={state.pending}>",
      "after": "<div className=\"mm-table-wrap\" aria-busy={state.pending || contentPending}>"
    },
    {
      "before": "<th key={header} scope=\"col\">{header}</th>",
      "after": "<th key={header} scope=\"col\"><StaticLoadingText pending={structurePending}>{header}</StaticLoadingText></th>"
    },
    {
      "before": "{state.pending && !state.loaded ? Array.from",
      "after": "{contentPending ? Array.from"
    },
    {
      "before": ">Abrir organizações<",
      "after": "><StaticLoadingText pending={structurePending}>Abrir organizações</StaticLoadingText><"
    },
    {
      "before": ">Abrir projetos<",
      "after": "><StaticLoadingText pending={structurePending}>Abrir projetos</StaticLoadingText><"
    },
    {
      "before": ">Abrir auditoria<",
      "after": "><StaticLoadingText pending={structurePending}>Abrir auditoria</StaticLoadingText><"
    },
    {
      "before": ">Voltar para Projects<",
      "after": "><StaticLoadingText pending={structurePending}>Voltar para Projects</StaticLoadingText><"
    },
    {
      "before": ">Sair<",
      "after": "><StaticLoadingText pending={structurePending}>Sair</StaticLoadingText><"
    },
    {
      "before": "<span>Abertas</span><strong>0</strong>",
      "after": "<span><StaticLoadingText pending={structurePending}>Abertas</StaticLoadingText></span><strong><StaticLoadingText pending={structurePending}>0</StaticLoadingText></strong>"
    },
    {
      "before": "<span>Em análise</span><strong>0</strong>",
      "after": "<span><StaticLoadingText pending={structurePending}>Em análise</StaticLoadingText></span><strong><StaticLoadingText pending={structurePending}>0</StaticLoadingText></strong>"
    },
    {
      "before": "<span>Concluídas</span><strong>0</strong>",
      "after": "<span><StaticLoadingText pending={structurePending}>Concluídas</StaticLoadingText></span><strong><StaticLoadingText pending={structurePending}>0</StaticLoadingText></strong>"
    },
    {
      "before": "{isRefreshing ? \"Atualizando...\" : \"Atualizar\"}",
      "after": "<StaticLoadingText pending={structurePending}>{isRefreshing ? \"Atualizando...\" : \"Atualizar\"}</StaticLoadingText>"
    },
    {
      "before": ">admin.open<",
      "after": "><StaticLoadingText pending={structurePending}>admin.open</StaticLoadingText><"
    },
    {
      "before": ">admin.files.redirect<",
      "after": "><StaticLoadingText pending={structurePending}>admin.files.redirect</StaticLoadingText><"
    },
    {
      "before": ">projects.thumbnail<",
      "after": "><StaticLoadingText pending={structurePending}>projects.thumbnail</StaticLoadingText><"
    },
    {
      "before": ">/admin/files redireciona para Gestão de Organizações.<",
      "after": "><StaticLoadingText pending={structurePending}>/admin/files redireciona para Gestão de Organizações.</StaticLoadingText><"
    },
    {
      "before": ">Preview vinculado ao projeto.<",
      "after": "><StaticLoadingText pending={structurePending}>Preview vinculado ao projeto.</StaticLoadingText><"
    },
    {
      "before": "<span>Painel acessado por {roleLabel(user?.role)}.</span>",
      "after": "<span><StaticLoadingText pending={structurePending}>{`Painel acessado por ${roleLabel(user?.role)}.`}</StaticLoadingText></span>"
    },
    {
      "before": "/ = /projects<br />",
      "after": "<StaticLoadingText pending={structurePending}>/ = /projects</StaticLoadingText><br />"
    },
    {
      "before": "/admin = painel administrativo<br />",
      "after": "<StaticLoadingText pending={structurePending}>/admin = painel administrativo</StaticLoadingText><br />"
    },
    {
      "before": "/admin/files = /admin?section=organizations<br />",
      "after": "<StaticLoadingText pending={structurePending}>/admin/files = /admin?section=organizations</StaticLoadingText><br />"
    },
    {
      "before": "          /api/projects/:slug/thumbnail = preview do projeto",
      "after": "          <StaticLoadingText pending={structurePending}>/api/projects/:slug/thumbnail = preview do projeto</StaticLoadingText>"
    },
    {
      "before": "refreshing={Object.values(regions).some(region => region.loaded)}",
      "after": "refreshing={(regions.projects.pending && regions.projects.loaded && !projectPresentation.contentPending) || (regions.organizations.pending && regions.organizations.loaded && !organizationPresentation.contentPending) || (regions.users.pending && regions.users.loaded && !userPresentation.contentPending)}"
    }
  ],
  "src/pages/Admin/components/AdminUserManagerLegacy.tsx": [
    {
      "before": "import { Skeleton }",
      "after": "import { StaticLoadingText } from \"../../../components/loading\";\nimport { Skeleton }"
    },
    {
      "before": "  organizationsLoaded = true,",
      "after": "  organizationsLoaded = true,\n  structurePending = false,\n  usersContentPending = false,\n  organizationsContentPending = false,"
    },
    {
      "before": "  organizationsLoaded?: boolean;",
      "after": "  organizationsLoaded?: boolean;\n  structurePending?: boolean;\n  usersContentPending?: boolean;\n  organizationsContentPending?: boolean;"
    },
    {
      "before": ">Usuários e Permissões<",
      "after": "><StaticLoadingText pending={structurePending}>Usuários e Permissões</StaticLoadingText><"
    },
    {
      "before": "            Gerencie contas da plataforma, vínculos organizacionais e os limites\n            da delegação de acessos.",
      "after": "            <StaticLoadingText pending={structurePending}>Gerencie contas da plataforma, vínculos organizacionais e os limites da delegação de acessos.</StaticLoadingText>"
    },
    {
      "before": "<div className=\"admin-user-filters\" aria-label=\"Filtros de usuários\">\n        <label className=\"wide\">\n          Buscar\n          <input\n            type=\"search\"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder=\"Nome, e-mail, organização ou perfil\"\n          />\n        </label>\n        <label>\n          Organização\n          <MaonoSelect\n            value={organizationFilter}\n            disabled={!organizationsLoaded}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n            {organizations.map((organization) => (\n              <option key={organization.id} value={organization.id}>\n                {organization.name}\n              </option>\n            ))}\n          </MaonoSelect>\n        </label>\n        <label>\n          Perfil\n          <MaonoSelect\n            value={profileFilter}\n            onChange={(event) => setProfileFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"super_admin\">Super Admin</option>\n            <option value=\"admin\">Admin</option>\n            <option value=\"owner\">Owner</option>\n            <option value=\"editor\">Editor</option>\n            <option value=\"viewer\">Viewer</option>\n          </MaonoSelect>\n        </label>\n        <label>\n          Status\n          <MaonoSelect\n            value={statusFilter}\n            onChange={(event) => setStatusFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"active\">Ativos</option>\n            <option value=\"inactive\">Inativos</option>\n          </MaonoSelect>\n        </label>\n        ",
      "after": "<div className=\"admin-user-filters\" aria-label=\"Filtros de usuários\">\n        <label className=\"wide\">\n          <StaticLoadingText pending={structurePending}>Buscar</StaticLoadingText>\n          <input\n            type=\"search\"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder=\"Nome, e-mail, organização ou perfil\"\n          />\n        </label>\n        <label>\n          Organização\n          <MaonoSelect\n            value={organizationFilter}\n            disabled={!organizationsLoaded}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n            {organizations.map((organization) => (\n              <option key={organization.id} value={organization.id}>\n                {organization.name}\n              </option>\n            ))}\n          </MaonoSelect>\n        </label>\n        <label>\n          Perfil\n          <MaonoSelect\n            value={profileFilter}\n            onChange={(event) => setProfileFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"super_admin\">Super Admin</option>\n            <option value=\"admin\">Admin</option>\n            <option value=\"owner\">Owner</option>\n            <option value=\"editor\">Editor</option>\n            <option value=\"viewer\">Viewer</option>\n          </MaonoSelect>\n        </label>\n        <label>\n          Status\n          <MaonoSelect\n            value={statusFilter}\n            onChange={(event) => setStatusFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"active\">Ativos</option>\n            <option value=\"inactive\">Inativos</option>\n          </MaonoSelect>\n        </label>\n        "
    },
    {
      "before": "<div className=\"admin-user-filters\" aria-label=\"Filtros de usuários\">\n        <label className=\"wide\">\n          <StaticLoadingText pending={structurePending}>Buscar</StaticLoadingText>\n          <input\n            type=\"search\"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder=\"Nome, e-mail, organização ou perfil\"\n          />\n        </label>\n        <label>\n          Organização\n          <MaonoSelect\n            value={organizationFilter}\n            disabled={!organizationsLoaded}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n            {organizations.map((organization) => (\n              <option key={organization.id} value={organization.id}>\n                {organization.name}\n              </option>\n            ))}\n          </MaonoSelect>\n        </label>\n        <label>\n          Perfil\n          <MaonoSelect\n            value={profileFilter}\n            onChange={(event) => setProfileFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"super_admin\">Super Admin</option>\n            <option value=\"admin\">Admin</option>\n            <option value=\"owner\">Owner</option>\n            <option value=\"editor\">Editor</option>\n            <option value=\"viewer\">Viewer</option>\n          </MaonoSelect>\n        </label>\n        <label>\n          Status\n          <MaonoSelect\n            value={statusFilter}\n            onChange={(event) => setStatusFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"active\">Ativos</option>\n            <option value=\"inactive\">Inativos</option>\n          </MaonoSelect>\n        </label>\n        ",
      "after": "<div className=\"admin-user-filters\" aria-label=\"Filtros de usuários\">\n        <label className=\"wide\">\n          <StaticLoadingText pending={structurePending}>Buscar</StaticLoadingText>\n          <input\n            type=\"search\"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder=\"Nome, e-mail, organização ou perfil\"\n          />\n        </label>\n        <label>\n          <StaticLoadingText pending={structurePending}>Organização</StaticLoadingText>\n          <MaonoSelect\n            value={organizationFilter}\n            disabled={!organizationsLoaded}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n            {organizations.map((organization) => (\n              <option key={organization.id} value={organization.id}>\n                {organization.name}\n              </option>\n            ))}\n          </MaonoSelect>\n        </label>\n        <label>\n          Perfil\n          <MaonoSelect\n            value={profileFilter}\n            onChange={(event) => setProfileFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"super_admin\">Super Admin</option>\n            <option value=\"admin\">Admin</option>\n            <option value=\"owner\">Owner</option>\n            <option value=\"editor\">Editor</option>\n            <option value=\"viewer\">Viewer</option>\n          </MaonoSelect>\n        </label>\n        <label>\n          Status\n          <MaonoSelect\n            value={statusFilter}\n            onChange={(event) => setStatusFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"active\">Ativos</option>\n            <option value=\"inactive\">Inativos</option>\n          </MaonoSelect>\n        </label>\n        "
    },
    {
      "before": "<div className=\"admin-user-filters\" aria-label=\"Filtros de usuários\">\n        <label className=\"wide\">\n          <StaticLoadingText pending={structurePending}>Buscar</StaticLoadingText>\n          <input\n            type=\"search\"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder=\"Nome, e-mail, organização ou perfil\"\n          />\n        </label>\n        <label>\n          <StaticLoadingText pending={structurePending}>Organização</StaticLoadingText>\n          <MaonoSelect\n            value={organizationFilter}\n            disabled={!organizationsLoaded}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n            {organizations.map((organization) => (\n              <option key={organization.id} value={organization.id}>\n                {organization.name}\n              </option>\n            ))}\n          </MaonoSelect>\n        </label>\n        <label>\n          Perfil\n          <MaonoSelect\n            value={profileFilter}\n            onChange={(event) => setProfileFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"super_admin\">Super Admin</option>\n            <option value=\"admin\">Admin</option>\n            <option value=\"owner\">Owner</option>\n            <option value=\"editor\">Editor</option>\n            <option value=\"viewer\">Viewer</option>\n          </MaonoSelect>\n        </label>\n        <label>\n          Status\n          <MaonoSelect\n            value={statusFilter}\n            onChange={(event) => setStatusFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"active\">Ativos</option>\n            <option value=\"inactive\">Inativos</option>\n          </MaonoSelect>\n        </label>\n        ",
      "after": "<div className=\"admin-user-filters\" aria-label=\"Filtros de usuários\">\n        <label className=\"wide\">\n          <StaticLoadingText pending={structurePending}>Buscar</StaticLoadingText>\n          <input\n            type=\"search\"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder=\"Nome, e-mail, organização ou perfil\"\n          />\n        </label>\n        <label>\n          <StaticLoadingText pending={structurePending}>Organização</StaticLoadingText>\n          <MaonoSelect\n            value={organizationFilter}\n            disabled={!organizationsLoaded}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n            {organizations.map((organization) => (\n              <option key={organization.id} value={organization.id}>\n                {organization.name}\n              </option>\n            ))}\n          </MaonoSelect>\n        </label>\n        <label>\n          <StaticLoadingText pending={structurePending}>Perfil</StaticLoadingText>\n          <MaonoSelect\n            value={profileFilter}\n            onChange={(event) => setProfileFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"super_admin\">Super Admin</option>\n            <option value=\"admin\">Admin</option>\n            <option value=\"owner\">Owner</option>\n            <option value=\"editor\">Editor</option>\n            <option value=\"viewer\">Viewer</option>\n          </MaonoSelect>\n        </label>\n        <label>\n          Status\n          <MaonoSelect\n            value={statusFilter}\n            onChange={(event) => setStatusFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"active\">Ativos</option>\n            <option value=\"inactive\">Inativos</option>\n          </MaonoSelect>\n        </label>\n        "
    },
    {
      "before": "<div className=\"admin-user-filters\" aria-label=\"Filtros de usuários\">\n        <label className=\"wide\">\n          <StaticLoadingText pending={structurePending}>Buscar</StaticLoadingText>\n          <input\n            type=\"search\"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder=\"Nome, e-mail, organização ou perfil\"\n          />\n        </label>\n        <label>\n          <StaticLoadingText pending={structurePending}>Organização</StaticLoadingText>\n          <MaonoSelect\n            value={organizationFilter}\n            disabled={!organizationsLoaded}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n            {organizations.map((organization) => (\n              <option key={organization.id} value={organization.id}>\n                {organization.name}\n              </option>\n            ))}\n          </MaonoSelect>\n        </label>\n        <label>\n          <StaticLoadingText pending={structurePending}>Perfil</StaticLoadingText>\n          <MaonoSelect\n            value={profileFilter}\n            onChange={(event) => setProfileFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"super_admin\">Super Admin</option>\n            <option value=\"admin\">Admin</option>\n            <option value=\"owner\">Owner</option>\n            <option value=\"editor\">Editor</option>\n            <option value=\"viewer\">Viewer</option>\n          </MaonoSelect>\n        </label>\n        <label>\n          Status\n          <MaonoSelect\n            value={statusFilter}\n            onChange={(event) => setStatusFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"active\">Ativos</option>\n            <option value=\"inactive\">Inativos</option>\n          </MaonoSelect>\n        </label>\n        ",
      "after": "<div className=\"admin-user-filters\" aria-label=\"Filtros de usuários\">\n        <label className=\"wide\">\n          <StaticLoadingText pending={structurePending}>Buscar</StaticLoadingText>\n          <input\n            type=\"search\"\n            value={searchQuery}\n            onChange={(event) => setSearchQuery(event.target.value)}\n            placeholder=\"Nome, e-mail, organização ou perfil\"\n          />\n        </label>\n        <label>\n          <StaticLoadingText pending={structurePending}>Organização</StaticLoadingText>\n          <MaonoSelect\n            value={organizationFilter}\n            disabled={!organizationsLoaded}\n            onChange={(event) => setOrganizationFilter(event.target.value)}\n          >\n            <option value=\"all\">Todas</option>\n            {organizations.map((organization) => (\n              <option key={organization.id} value={organization.id}>\n                {organization.name}\n              </option>\n            ))}\n          </MaonoSelect>\n        </label>\n        <label>\n          <StaticLoadingText pending={structurePending}>Perfil</StaticLoadingText>\n          <MaonoSelect\n            value={profileFilter}\n            onChange={(event) => setProfileFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"super_admin\">Super Admin</option>\n            <option value=\"admin\">Admin</option>\n            <option value=\"owner\">Owner</option>\n            <option value=\"editor\">Editor</option>\n            <option value=\"viewer\">Viewer</option>\n          </MaonoSelect>\n        </label>\n        <label>\n          <StaticLoadingText pending={structurePending}>Status</StaticLoadingText>\n          <MaonoSelect\n            value={statusFilter}\n            onChange={(event) => setStatusFilter(event.target.value)}\n          >\n            <option value=\"all\">Todos</option>\n            <option value=\"active\">Ativos</option>\n            <option value=\"inactive\">Inativos</option>\n          </MaonoSelect>\n        </label>\n        "
    },
    {
      "before": "disabled={!organizationsLoaded}",
      "after": "disabled={!organizationsLoaded || organizationsContentPending}"
    },
    {
      "before": "{organizations.map((organization) => (",
      "after": "{(organizationsContentPending ? [] : organizations).map((organization) => ("
    },
    {
      "before": "{usersLoaded ? <>{filteredUsers.length} de {users.length} usuário(s)</> : loading ? \"Carregando usuários.\" : \"Contagem indisponível.\"}",
      "after": "{usersContentPending ? \"Carregando usuários.\" : usersLoaded ? <>{filteredUsers.length} de {users.length} usuário(s)</> : loading ? \"Carregando usuários.\" : \"Contagem indisponível.\"}"
    },
    {
      "before": "<div className=\"admin-users-table\" aria-busy={loading}>",
      "after": "<div className=\"admin-users-table\" aria-busy={loading || usersContentPending}>"
    },
    {
      "before": "<th scope=\"col\">Nome</th>",
      "after": "<th scope=\"col\"><StaticLoadingText pending={structurePending}>Nome</StaticLoadingText></th>"
    },
    {
      "before": "<th scope=\"col\">E-mail</th>",
      "after": "<th scope=\"col\"><StaticLoadingText pending={structurePending}>E-mail</StaticLoadingText></th>"
    },
    {
      "before": "<th scope=\"col\">Perfil</th>",
      "after": "<th scope=\"col\"><StaticLoadingText pending={structurePending}>Perfil</StaticLoadingText></th>"
    },
    {
      "before": "<th scope=\"col\">Projetos</th>",
      "after": "<th scope=\"col\"><StaticLoadingText pending={structurePending}>Projetos</StaticLoadingText></th>"
    },
    {
      "before": "<th scope=\"col\">Status</th>",
      "after": "<th scope=\"col\"><StaticLoadingText pending={structurePending}>Status</StaticLoadingText></th>"
    },
    {
      "before": "<th scope=\"col\">Ações</th>",
      "after": "<th scope=\"col\"><StaticLoadingText pending={structurePending}>Ações</StaticLoadingText></th>"
    },
    {
      "before": "{loading && !usersLoaded ? Array.from",
      "after": "{usersContentPending || loading && !usersLoaded ? Array.from"
    },
    {
      "before": "{usersLoaded && filteredUsers.map",
      "after": "{usersLoaded && !usersContentPending && filteredUsers.map"
    },
    {
      "before": "{usersLoaded && filteredUsers.length === 0",
      "after": "{usersLoaded && !usersContentPending && filteredUsers.length === 0"
    },
    {
      "before": "{!loading && !usersLoaded ? <tr>",
      "after": "{!loading && !usersContentPending && !usersLoaded ? <tr>"
    },
    {
      "before": "          ＋ Novo usuário\n",
      "after": "          <StaticLoadingText pending={structurePending}>＋ Novo usuário</StaticLoadingText>\n"
    }
  ],
  "src/pages/Projects.tsx": [
    {
      "before": "  useInitialBootReadiness,",
      "after": "  useInitialBootReadiness,\n  useInitialLoadingPresentation,"
    },
    {
      "before": "  const loginProjectsReady =",
      "after": "  const projectPresentation = useInitialLoadingPresentation({\n    pending: !loading && authenticated && Boolean(activeOrganizationId) && isProjectSection(sidebarSection) &&\n      (projectsLoading || (loadedProjectSection !== sidebarSection && !projectsError)),\n    hasData: projectContextIsCurrent && projectDataKey === JSON.stringify([activeOrganizationKey, sidebarSection]),\n    scopeKey: JSON.stringify([user?.id, activeOrganizationKey, sidebarSection]),\n    failed: Boolean(projectsError),\n    cancelled: !authenticated || !activeOrganizationId || !isProjectSection(sidebarSection),\n  });\n  const loginProjectsReady ="
    },
    {
      "before": "            section={sidebarSection}\n            canCreateMap={canCreateMap}",
      "after": "            section={sidebarSection}\n            structurePending={projectPresentation.structurePending}\n            canCreateMap={canCreateMap}"
    },
    {
      "before": "                error={projectsError}",
      "after": "                structurePending={projectPresentation.structurePending}\n                contentPending={projectPresentation.contentPending}\n                error={projectsError}"
    },
    {
      "before": "    failed: Boolean(projectsError),",
      "after": "    failed: projectContextIsCurrent && loadedProjectSection === sidebarSection && Boolean(projectsError),"
    },
    {
      "before": "          activeProjectsCount={activeProjectsCount}",
      "after": "          activeProjectsCount={activeProjectsCount}\n          projectsUnavailable={Boolean(projectsError)}"
    }
  ],
  "src/pages/Projects/components/ProjectsSection.tsx": [
    {
      "before": "  loaded?: boolean;",
      "after": "  loaded?: boolean;\n  structurePending?: boolean;\n  contentPending?: boolean;"
    },
    {
      "before": "  loaded = projects.length > 0 || !loading,",
      "after": "  loaded = projects.length > 0 || !loading,\n  structurePending = false,\n  contentPending = loading && !loaded,"
    },
    {
      "before": "      <ProjectPageFiltersForm\n        value={draftFilters}",
      "after": "      <ProjectPageFiltersForm\n        structurePending={structurePending}\n        value={draftFilters}"
    },
    {
      "before": "{loading && !loaded ? <ProjectGridSkeleton",
      "after": "{contentPending ? <ProjectGridSkeleton"
    },
    {
      "before": "        loading={loading}\n        refreshing={loaded}",
      "after": "        structurePending={structurePending}\n        loading={loading || contentPending}\n        refreshing={loaded && !contentPending}"
    },
    {
      "before": "        disabled={loading || Boolean(error)}",
      "after": "        disabled={loading || contentPending || Boolean(error)}"
    },
    {
      "before": "{contentPending ? <ProjectGridSkeleton pageSize={pageSize} announce={false} className=\"mm-project-pages__grid\" /> : !loaded && error ? null : filteredProjects.length === 0 ? <section className=\"mm-project-pages__empty\" aria-busy={loading}>",
      "after": "{contentPending ? <ProjectGridSkeleton pageSize={pageSize} announce={false} className=\"mm-project-pages__grid\" /> : null}\n      {/* Ready cards stay mounted so thumbnail requests never wait for presentation. */}\n      {contentPending && !loaded || !loaded && error ? null : filteredProjects.length === 0 ? <section className=\"mm-project-pages__empty\" aria-busy={loading || contentPending} style={contentPending ? { display: \"none\" } : undefined}>"
    },
    {
      "before": "        className=\"mm-project-grid mm-project-pages__grid\"\n        aria-busy={loading}",
      "after": "        className=\"mm-project-grid mm-project-pages__grid\"\n        style={contentPending ? { display: \"none\" } : undefined}\n        aria-busy={loading || contentPending}"
    },
    {
      "before": "            project={project}\n            canSave={canProjectSave(project)}",
      "after": "            project={project}\n            initialPresentationPending={contentPending}\n            canSave={canProjectSave(project)}"
    },
    {
      "before": "import { ProjectGridSkeleton } from \"../../../components/loading/Skeleton\";",
      "after": "import { ProjectGridSkeleton } from \"../../../components/loading/Skeleton\";\nimport { useSkeletonCount } from \"../../../components/loading/useSkeletonCount\";"
    },
    {
      "before": "  const [pageSize, setPageSize] = useState(10);",
      "after": "  const [pageSize, setPageSize] = useState(10);\n  const initialPreviewCount = useSkeletonCount({ layout: \"grid\", pageSize });"
    },
    {
      "before": "{visibleProjects.map((project) => (",
      "after": "{visibleProjects.map((project, index) => ("
    },
    {
      "before": "initialPresentationPending={contentPending}",
      "after": "initialPresentationPending={contentPending && index < initialPreviewCount}"
    }
  ],
  "src/pages/Projects/components/ProjectPagesUi.tsx": [
    {
      "before": "import { LoadingStatus }",
      "after": "import { StaticLoadingText } from \"../../../components/loading\";\nimport { LoadingStatus }"
    },
    {
      "before": "export function ProjectPagesHeader({ section, canCreateMap, onNewMap, onHome }: {",
      "after": "export function ProjectPagesHeader({ section, canCreateMap, onNewMap, onHome, structurePending = false }: {"
    },
    {
      "before": "  canCreateMap: boolean;",
      "after": "  canCreateMap: boolean;\n  structurePending?: boolean;"
    },
    {
      "before": "}>Início</Link>",
      "after": "}><StaticLoadingText pending={structurePending}>Início</StaticLoadingText></Link>"
    },
    {
      "before": "<span aria-current=\"page\">{copy.title}</span>",
      "after": "<span aria-current=\"page\"><StaticLoadingText pending={structurePending}>{copy.title}</StaticLoadingText></span>"
    },
    {
      "before": "<div><h1>{copy.title}</h1><p>{copy.description}</p></div>",
      "after": "<div><h1><StaticLoadingText pending={structurePending}>{copy.title}</StaticLoadingText></h1><p><StaticLoadingText pending={structurePending}>{copy.description}</StaticLoadingText></p></div>"
    },
    {
      "before": "export function ProjectPageFiltersForm({ value, disabled, onChange, onApply, onClear }: {",
      "after": "export function ProjectPageFiltersForm({ value, disabled, onChange, onApply, onClear, structurePending = false }: {"
    },
    {
      "before": "  value: ProjectPageFilters;",
      "after": "  value: ProjectPageFilters;\n  structurePending?: boolean;"
    },
    {
      "before": ">Buscar<",
      "after": "><StaticLoadingText pending={structurePending}>Buscar</StaticLoadingText><"
    },
    {
      "before": ">Status<",
      "after": "><StaticLoadingText pending={structurePending}>Status</StaticLoadingText><"
    },
    {
      "before": ">Ordenar por<",
      "after": "><StaticLoadingText pending={structurePending}>Ordenar por</StaticLoadingText><"
    },
    {
      "before": "export function ProjectPagePagination({ visibleCount, total, page, pageCount, pageSize, disabled, loading = false, refreshing = false, unavailable = false, onPage, onPageSize }: {",
      "after": "export function ProjectPagePagination({ visibleCount, total, page, pageCount, pageSize, disabled, loading = false, refreshing = false, unavailable = false, structurePending = false, onPage, onPageSize }: {"
    },
    {
      "before": "  loading?: boolean; refreshing?: boolean; unavailable?: boolean;",
      "after": "  loading?: boolean; refreshing?: boolean; unavailable?: boolean; structurePending?: boolean;"
    },
    {
      "before": "<label>Itens por página<MaonoSelect",
      "after": "<label><StaticLoadingText pending={structurePending}>Itens por página</StaticLoadingText><MaonoSelect"
    },
    {
      "before": " />Novo Projeto</",
      "after": " /><StaticLoadingText pending={structurePending}>Novo Projeto</StaticLoadingText></"
    },
    {
      "before": " />Aplicar</",
      "after": " /><StaticLoadingText pending={structurePending}>Aplicar</StaticLoadingText></"
    },
    {
      "before": " />Limpar filtros</",
      "after": " /><StaticLoadingText pending={structurePending}>Limpar filtros</StaticLoadingText></"
    }
  ],
  "src/pages/ProjectsSidebar.tsx": [
    {
      "before": "import { Link } from \"react-router\";",
      "after": "import { Link } from \"react-router\";\nimport { StaticLoadingText, useInitialLoadingPresentation } from \"../components/loading\";"
    },
    {
      "before": "function SectionTitle({\n  children,\n  expanded,",
      "after": "function SectionTitle({\n  children,\n  expanded,\n  structurePending,"
    },
    {
      "before": "  children: React.ReactNode;\n  expanded: boolean;",
      "after": "  children: string;\n  expanded: boolean;\n  structurePending: boolean;"
    },
    {
      "before": "<div className=\"mm-sidebar-title\">{children}</div>",
      "after": "<div className=\"mm-sidebar-title\"><StaticLoadingText pending={structurePending}>{children}</StaticLoadingText></div>"
    },
    {
      "before": "function ItemButton({\n  item,\n  active,\n  expanded,",
      "after": "function ItemButton({\n  item,\n  active,\n  expanded,\n  structurePending,\n  contentPending,"
    },
    {
      "before": "  active?: boolean;\n  expanded: boolean;",
      "after": "  active?: boolean;\n  expanded: boolean;\n  structurePending: boolean;\n  contentPending: boolean;"
    },
    {
      "before": "<span className=\"mm-sidebar-label\">{item.label}</span>",
      "after": "<span className=\"mm-sidebar-label\"><StaticLoadingText pending={structurePending}>{item.label}</StaticLoadingText></span>"
    },
    {
      "before": "<span className=\"mm-sidebar-count\">{item.count}</span>",
      "after": "<span className=\"mm-sidebar-count\"><StaticLoadingText pending={contentPending}>{item.count}</StaticLoadingText></span>"
    },
    {
      "before": "  const [expanded, setExpanded] = useState(true);",
      "after": "  const [expanded, setExpanded] = useState(true);\n  const { structurePending, contentPending } = useInitialLoadingPresentation({\n    pending: activeProjectsCount === null, hasData: activeProjectsCount !== null,\n    scopeKey: JSON.stringify([user?.id, activeOrganization?.id]),\n    cancelled: !user || !activeOrganization,\n  });"
    },
    {
      "before": "<strong title={userIdentity}>{userIdentity}</strong>",
      "after": "<strong title={userIdentity}><StaticLoadingText pending={structurePending}>{userIdentity}</StaticLoadingText></strong>"
    },
    {
      "before": "<span title={user?.email}>{user?.email}</span>",
      "after": "<span title={user?.email}><StaticLoadingText pending={structurePending}>{user?.email || \"\"}</StaticLoadingText></span>"
    },
    {
      "before": "<SectionTitle expanded={expanded}>",
      "after": "<SectionTitle expanded={expanded} structurePending={structurePending}>"
    },
    {
      "before": "                    item={item}\n                    expanded={expanded}",
      "after": "                    item={item}\n                    structurePending={structurePending}\n                    contentPending={contentPending}\n                    expanded={expanded}"
    },
    {
      "before": ">Maõno Maps<",
      "after": "><StaticLoadingText pending={structurePending}>Maõno Maps</StaticLoadingText><"
    },
    {
      "before": ">Sair<",
      "after": "><StaticLoadingText pending={structurePending}>Sair</StaticLoadingText><"
    },
    {
      "before": "  activeProjectsCount: number | null;",
      "after": "  activeProjectsCount: number | null;\n  projectsUnavailable?: boolean;"
    },
    {
      "before": "  activeProjectsCount,\n  searchQuery,",
      "after": "  activeProjectsCount,\n  projectsUnavailable = false,\n  searchQuery,"
    },
    {
      "before": "    cancelled: !user || !activeOrganization,",
      "after": "    cancelled: !user || !activeOrganization, failed: projectsUnavailable,"
    }
  ],
  "src/pages/Projects/components/ProjectCard.tsx": [
    {
      "before": "  opening?: boolean;",
      "after": "  opening?: boolean;\n  initialPresentationPending?: boolean;"
    },
    {
      "before": "  opening = false,",
      "after": "  opening = false,\n  initialPresentationPending = false,"
    },
    {
      "before": "loading={showGenerationSvg ? \"eager\" : \"lazy\"}",
      "after": "loading={initialPresentationPending || showGenerationSvg ? \"eager\" : \"lazy\"}"
    }
  ]
};

export function restoreAdminProjectsProgressiveLoading(path, source) {
  for (const { before, after } of [...(initialStageChanges[path] || [])].reverse()) {
    assert.equal(source.split(after).length - 1, 1, `exact approved initial-presentation edit: ${path}`);
    source = source.replace(after, before);
  }
  for (const { before, after } of changes[path] || []) {
    assert.equal(source.split(after).length - 1, 1, `exact approved progressive-loading edit: ${path}`);
    source = source.replace(after, before);
  }
  return source;
}
