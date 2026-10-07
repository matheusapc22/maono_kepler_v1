import assert from 'node:assert/strict';

// Exact inverse of the separately authorized thumbnail reliability fix. The
// original Project Pages hashes remain pinned; unrelated changes still fail.
const changes = {
  'src/pages/Projects/components/project-preview-presentation.mjs': [{
    before: '  if (normalizedStatus === "UNKNOWN") {\n    if (imageError || !hasCurrentImage) {\n      return "missing-neutral";',
    after: '  if (normalizedStatus === "UNKNOWN") {\n    if (imageError || !hasCurrentImage) {\n      // Image errors also include expired sessions, temporary storage failures\n      // and decode failures. They do not establish that no preview exists.\n      return "failed-neutral";',
  }],
  'src/pages/Projects/components/project-card-utils.ts': [{
    before: '    status === "READY"\n      ? project.thumbnailRevision\n      : project.configRevision ?? 0;',
    after: '    status === "READY"\n      ? project.thumbnailRevision\n      : 0;',
  }, {
    before: '    status === "READY"\n      ? project.thumbnailRevision\n      : project.configRevision;\n  const normalized = Number(revision);',
    after: '    status === "READY"\n      ? project.thumbnailRevision\n      : status === "UNKNOWN"\n        ? 0\n        : project.configRevision;\n  if (revision === null || revision === undefined) {\n    return null;\n  }\n  const normalized = Number(revision);',
  }, {
    before: 'export function projectPreviousReadyThumbnailUrl(\n  project: ProjectListItem,\n) {\n  const revision = Number(project.thumbnailRevision);',
    after: 'export function projectPreviousReadyThumbnailUrl(\n  project: ProjectListItem,\n) {\n  if (project.thumbnailRevision === null || project.thumbnailRevision === undefined) {\n    return null;\n  }\n  const revision = Number(project.thumbnailRevision);',
  }],
};

// Exact inverse of the separately approved operation-owned preview refactor.
const pipelineChanges = {
  "functions/_lib/project-list.js": [
    {
      "before": "  publicProject,\n} from \"./projects.js\";\nimport { publicProjectPreview } from \"./project-preview.js\";\n\nconst ACCESS_LEVELS = new Set([\"owner\", \"editor\", \"viewer\"]);\n",
      "after": "  publicProject,\n} from \"./projects.js\";\nimport { publicProjectPreview, previewProjectSelect } from \"./project-preview.js\";\n\nconst ACCESS_LEVELS = new Set([\"owner\", \"editor\", \"viewer\"]);\n",
      "count": 1
    },
    {
      "before": "      `SELECT\n        ${PUBLIC_PROJECT_COLUMNS},\n        'owner' AS access_level\n       FROM projects\n",
      "after": "      `SELECT\n        ${PUBLIC_PROJECT_COLUMNS},\n        ${await previewProjectSelect(env)},\n        'owner' AS access_level\n       FROM projects\n",
      "count": 2
    },
    {
      "before": "    `SELECT\n      ${PUBLIC_PROJECT_COLUMNS},\n      user_projects.access_level\n     FROM user_projects\n",
      "after": "    `SELECT\n      ${PUBLIC_PROJECT_COLUMNS},\n        ${await previewProjectSelect(env)},\n      user_projects.access_level\n     FROM user_projects\n",
      "count": 2
    }
  ],
  "src/pages/Projects/projects-api.ts": [
    {
      "before": "  thumbnailUpdatedAt?: string | null;\n  thumbnailAttempts?: number;\n};\n\n",
      "after": "  thumbnailUpdatedAt?: string | null;\n  thumbnailAttempts?: number;\n  artifactId?: string | null;\n  jobState?: string | null;\n};\n\n",
      "count": 2
    },
    {
      "before": "        : Math.max(0, Number(data.thumbnailRevision || 0)),\n    thumbnailUpdatedAt: data.thumbnailUpdatedAt ?? null,\n    thumbnailAttempts: Math.max(\n      0,\n",
      "after": "        : Math.max(0, Number(data.thumbnailRevision || 0)),\n    thumbnailUpdatedAt: data.thumbnailUpdatedAt ?? null,\n    artifactId: data.artifactId ?? null,\n    jobState: data.jobState ?? null,\n    thumbnailAttempts: Math.max(\n      0,\n",
      "count": 1
    }
  ],
  "src/pages/Projects/components/project-card-utils.ts": [
    {
      "before": "  }\n\n  if (project.thumbnailUrl) {\n    return project.thumbnailUrl;\n  }\n",
      "after": "  }\n\n  if (project.thumbnailUrl && !project.artifactId) {\n    return project.thumbnailUrl;\n  }\n",
      "count": 1
    },
    {
      "before": "  return `/api/projects/${encodeURIComponent(\n    project.slug,\n  )}/thumbnail?v=${encodeURIComponent(String(revision ?? 0))}`;\n}\n\n",
      "after": "  return `/api/projects/${encodeURIComponent(\n    project.slug,\n  )}/thumbnail?v=${encodeURIComponent(String(revision ?? 0))}${project.artifactId ? `&artifactId=${encodeURIComponent(project.artifactId)}` : \"\"}`;\n}\n\n",
      "count": 1
    },
    {
      "before": "    normalizeProjectThumbnailStatus(project.thumbnailStatus) ===\n      \"FAILED\" &&\n    project.thumbnailUrl\n  ) {\n    return project.thumbnailUrl;\n",
      "after": "    normalizeProjectThumbnailStatus(project.thumbnailStatus) ===\n      \"FAILED\" &&\n    project.thumbnailUrl && !project.artifactId\n  ) {\n    return project.thumbnailUrl;\n",
      "count": 1
    },
    {
      "before": "  return `/api/projects/${encodeURIComponent(\n    project.slug,\n  )}/thumbnail?v=${encodeURIComponent(String(revision))}`;\n}\n\n",
      "after": "  return `/api/projects/${encodeURIComponent(\n    project.slug,\n  )}/thumbnail?v=${encodeURIComponent(String(revision))}${project.artifactId ? `&artifactId=${encodeURIComponent(project.artifactId)}` : \"\"}`;\n}\n\n",
      "count": 1
    }
  ],
  "src/pages/Projects/components/project-preview-presentation.mjs": [
    {
      "before": "export function resolvePreviewPresentation({\n  status,\n  currentUrl,\n  currentRevision,\n",
      "after": "export function resolvePreviewPresentation({\n  status,\n  jobState,\n  currentUrl,\n  currentRevision,\n",
      "count": 1
    },
    {
      "before": "\n  if (normalizedStatus === \"PENDING\") {\n    return \"generation-svg\";\n  }\n",
      "after": "\n  if (normalizedStatus === \"PENDING\") {\n    if ([\"WAITING_CAPTURE\", \"FAILED_FINAL\", \"SUPERSEDED\"].includes(jobState)) {\n      return previousReadyUrl ? \"failed-previous-image\" : jobState === \"WAITING_CAPTURE\" ? \"missing-neutral\" : \"failed-neutral\";\n    }\n    return \"generation-svg\";\n  }\n",
      "count": 1
    }
  ],
  "src/pages/Projects/components/ProjectsSection.tsx": [
    {
      "before": "import React, {\n  useEffect,\n",
      "after": "import { subscribePreviewStatus } from \"./preview-status-polling\";\nimport React, {\n  useEffect,\n",
      "count": 1
    },
    {
      "before": "import { prepareProjectMapDestination } from \"../../Kepler/map-panel/prepare-project-map-destination\";\nimport {\n  fetchProjectThumbnailStatus,\n  type ProjectListItem,\n  type ProjectSectionKey,\n",
      "after": "import { prepareProjectMapDestination } from \"../../Kepler/map-panel/prepare-project-map-destination\";\nimport {\n  type ProjectListItem,\n  type ProjectSectionKey,\n",
      "count": 1
    },
    {
      "before": "\n  useEffect(() => {\n    const pendingProjects = projects.filter(\n      (project) =>\n        normalizeProjectThumbnailStatus(\n          project.thumbnailStatus,\n        ) === \"PENDING\",\n    );\n\n    if (pendingProjects.length === 0) {\n      return undefined;\n    }\n\n    const controller = new AbortController();\n    const delays = [2000, 4000, 8000, 15000];\n    let attempt = 0;\n    let timer = 0;\n\n    const schedule = () => {\n      const delay = delays[Math.min(attempt, delays.length - 1)];\n      timer = window.setTimeout(() => {\n        void poll();\n      }, delay);\n    };\n\n    const poll = async () => {\n      const results = await Promise.allSettled(\n        pendingProjects.map(async (project) => ({\n          project,\n          state: await fetchProjectThumbnailStatus(project.slug, {\n            signal: controller.signal,\n          }),\n        })),\n      );\n\n      if (controller.signal.aborted) {\n        return;\n      }\n\n      let stillPending = false;\n\n      results.forEach((result) => {\n        if (result.status !== \"fulfilled\") {\n          stillPending = true;\n          return;\n        }\n\n        const { project, state } = result.value;\n\n        if (state.thumbnailStatus === \"PENDING\") {\n          stillPending = true;\n        }\n\n        const changed =\n          state.thumbnailStatus !== project.thumbnailStatus ||\n          state.configRevision !== Number(project.configRevision || 0) ||\n          state.thumbnailRevision !==\n            (project.thumbnailRevision ?? null) ||\n          state.thumbnailAttempts !==\n            Number(project.thumbnailAttempts || 0);\n\n        if (changed) {\n          onProjectUpdated({\n            ...project,\n            ...state,\n          });\n        }\n      });\n\n      attempt += 1;\n\n      if (stillPending) {\n        schedule();\n      }\n    };\n\n    schedule();\n\n    return () => {\n      controller.abort();\n      window.clearTimeout(timer);\n    };\n  }, [onProjectUpdated, projects]);\n\n",
      "after": "\n  useEffect(() => {\n    const releases = projects\n      .filter(project => normalizeProjectThumbnailStatus(project.thumbnailStatus) === \"PENDING\" && ![\"FAILED_FINAL\", \"SUPERSEDED\"].includes(project.jobState || \"\"))\n      .map(project => subscribePreviewStatus(`${projectOrganizationCacheKey(project)}:${project.id ?? project.slug}`, project.slug, state => {\n        const changed = state.thumbnailStatus !== project.thumbnailStatus || state.configRevision !== Number(project.configRevision || 0) ||\n          state.thumbnailRevision !== (project.thumbnailRevision ?? null) || state.thumbnailAttempts !== Number(project.thumbnailAttempts || 0) ||\n          state.artifactId !== (project.artifactId ?? null) || state.jobState !== (project.jobState ?? null);\n        if (changed) onProjectUpdated({ ...project, ...state });\n      }, project.jobState));\n    return () => { for (const release of releases) release(); };\n  }, [onProjectUpdated, projects]);\n\n",
      "count": 1
    }
  ],
  "src/pages/Projects/components/ProjectCard.tsx": [
    {
      "before": "import React from \"react\";\nimport { LoadingStatus, Skeleton } from \"../../../components/loading/Skeleton\";\nimport { useHref, useNavigate } from \"react-router\";\n",
      "after": "import React from \"react\";\nimport { inspectPreviewImageFailure, type PreviewImageErrorCause } from \"./preview-image-error\";\nimport { recordPreviewMetric } from \"../../Kepler/thumbnail/preview-metrics\";\nimport { LoadingStatus, Skeleton } from \"../../../components/loading/Skeleton\";\nimport { useHref, useNavigate } from \"react-router\";\n",
      "count": 1
    },
    {
      "before": "import type { ProjectListItem } from \"../projects-api\";\nimport ProjectActionsMenu from \"./ProjectActionsMenu\";\nimport ProjectMapPlaceholder from \"./ProjectMapPlaceholder\";\nimport {\n",
      "after": "import type { ProjectListItem } from \"../projects-api\";\nimport ProjectActionsMenu from \"./ProjectActionsMenu\";\nimport { isPreviewGenerationActive } from \"./preview-status-polling\";\nimport ProjectMapPlaceholder from \"./ProjectMapPlaceholder\";\nimport {\n",
      "count": 1
    },
    {
      "before": "  imageError: boolean;\n  imageErrorUrl: string | null;\n};\n\n",
      "after": "  imageError: boolean;\n  imageErrorUrl: string | null;\n  imageErrorCause?: PreviewImageErrorCause;\n};\n\n",
      "count": 1
    },
    {
      "before": "  );\n  const displayedSourceRef = React.useRef<string | null>(null);\n  const [previewState, setPreviewState] =\n    React.useState<PreviewTransitionState>(() => {\n",
      "after": "  );\n  const displayedSourceRef = React.useRef<string | null>(null);\n  const imageProbe = React.useRef<AbortController | null>(null);\n  React.useEffect(() => () => imageProbe.current?.abort(), []);\n  const [previewState, setPreviewState] =\n    React.useState<PreviewTransitionState>(() => {\n",
      "count": 1
    },
    {
      "before": "  const resolvedPresentation = resolvePreviewPresentation({\n    status: thumbnailStatus,\n    currentUrl: thumbnailUrl,\n    currentRevision: thumbnailRevision,\n",
      "after": "  const resolvedPresentation = resolvePreviewPresentation({\n    status: thumbnailStatus,\n    jobState: project.jobState,\n    currentUrl: thumbnailUrl,\n    currentRevision: thumbnailRevision,\n",
      "count": 1
    },
    {
      "before": "        : null;\n  const previewBusy =\n    thumbnailStatus === \"PENDING\" ||\n    (PROJECT_PREVIEW_TRANSITION_V2_ENABLED &&\n      thumbnailStatus === \"READY\" &&\n",
      "after": "        : null;\n  const previewBusy =\n    (thumbnailStatus === \"PENDING\" && isPreviewGenerationActive(project.jobState)) ||\n    (PROJECT_PREVIEW_TRANSITION_V2_ENABLED &&\n      thumbnailStatus === \"READY\" &&\n",
      "count": 1
    },
    {
      "before": "\n  const markDisplayedImageFailed = React.useCallback(\n    (failedUrl: string) => {\n      if (displayedSourceRef.current !== failedUrl) return;\n      logPreviewTransition(\n",
      "after": "\n  const markDisplayedImageFailed = React.useCallback(\n    (failedUrl: string, cause: PreviewImageErrorCause = \"unverified\") => {\n      if (displayedSourceRef.current !== failedUrl) return;\n      logPreviewTransition(\n",
      "count": 1
    },
    {
      "before": "        imageError: true,\n        imageErrorUrl: failedUrl,\n      }));\n    },\n",
      "after": "        imageError: true,\n        imageErrorUrl: failedUrl,\n        imageErrorCause: cause,\n      }));\n    },\n",
      "count": 1
    },
    {
      "before": "      }\n\n      if (typeof image.decode === \"function\") {\n        try {\n          await image.decode();\n        } catch {\n          markDisplayedImageFailed(expectedSource);\n          return;\n        }\n",
      "after": "      }\n\n      const decodeStarted = performance.now();\n      if (typeof image.decode === \"function\") {\n        try {\n          let timer: ReturnType<typeof setTimeout> | undefined;\n          try { await Promise.race([image.decode(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(\"PREVIEW_DECODE_TIMEOUT\")), 15_000); })]); }\n          finally { clearTimeout(timer); }\n        } catch {\n          markDisplayedImageFailed(expectedSource, \"decode\");\n          return;\n        }\n",
      "count": 1
    },
    {
      "before": "      }\n\n      rememberProjectThumbnailDecoded(project, expectedSource);\n      const decodedCurrentImage =\n",
      "after": "      }\n\n      recordPreviewMetric(\"decode\", performance.now() - decodeStarted);\n      rememberProjectThumbnailDecoded(project, expectedSource);\n      const decodedCurrentImage =\n",
      "count": 1
    },
    {
      "before": "\n      markDisplayedImageFailed(failedSource);\n    },\n    [displayImageUrl, markDisplayedImageFailed],\n",
      "after": "\n      markDisplayedImageFailed(failedSource);\n      imageProbe.current?.abort();\n      const controller = new AbortController(); imageProbe.current = controller;\n      void inspectPreviewImageFailure(failedSource, controller.signal).then(cause => {\n        if (controller.signal.aborted) return;\n        setPreviewState(current => current.imageErrorUrl === failedSource ? { ...current, imageErrorCause: cause } : current);\n      });\n    },\n    [displayImageUrl, markDisplayedImageFailed],\n",
      "count": 1
    },
    {
      "before": "        className=\"mm-project-card__preview\"\n        aria-busy={previewBusy}\n        data-preview-presentation={previewPresentation}\n      >\n",
      "after": "        className=\"mm-project-card__preview\"\n        aria-busy={previewBusy}\n        data-preview-error={previewState.imageError ? previewState.imageErrorCause : undefined}\n        data-preview-presentation={previewPresentation}\n      >\n",
      "count": 1
    }
  ],
  "src/auth/session.tsx": [
    {
        "before": "} from \"react\";\n\nimport { normalizeRole } from \"../access-control/roles\";\nimport {\n",
        "after": "} from \"react\";\n\nimport { normalizeThumbnailState, type ProjectThumbnailState } from \"../pages/Kepler/thumbnail/thumbnail-api\";\nimport { clearPreviewStatusSubscriptions } from \"../pages/Projects/components/preview-status-polling\";\nimport { activatePreviewRecovery } from \"../pages/Kepler/thumbnail/preview-recovery\";\nimport { activateProjectThumbnailCacheContext } from \"../pages/Projects/components/project-card-utils\";\nimport { normalizeRole } from \"../access-control/roles\";\nimport {\n",
        "count": 1
    },
    {
        "before": "};\n\ntype MaonoProject = {\n  id: MaonoId;\n  name: string;\n",
        "after": "};\n\ntype MaonoProject = Partial<ProjectThumbnailState> & {\n  id: MaonoId;\n  name: string;\n",
        "count": 1
    },
    {
        "before": "    ),\n    active: typeof value.active === \"boolean\" ? value.active : undefined,\n    thumbnailUrl:\n      toStringValue(value.thumbnailUrl) ?? toStringValue(value.thumbnail_url),\n",
        "after": "    ),\n    active: typeof value.active === \"boolean\" ? value.active : undefined,\n    ...normalizeThumbnailState(value),\n    thumbnailUrl:\n      toStringValue(value.thumbnailUrl) ?? toStringValue(value.thumbnail_url),\n",
        "count": 1
    },
    {
        "before": "  }\n\n  window.__MAONO_SESSION__ = {\n    authenticated: session.authenticated,\n",
        "after": "  }\n\n  const previous = window.__MAONO_SESSION__;\n  if (String(previous?.user?.id ?? \"\") !== String(session.user?.id ?? \"\") || String(previous?.activeOrganization?.id ?? \"\") !== String(session.activeOrganization?.id ?? \"\") || !session.authenticated) {\n    activateProjectThumbnailCacheContext(null);\n    clearPreviewStatusSubscriptions();\n  }\n  activatePreviewRecovery(session.authenticated ? String(session.user?.id ?? \"\") : null, session.authenticated ? String(session.activeOrganization?.id ?? \"\") : null, reason);\n  window.__MAONO_SESSION__ = {\n    authenticated: session.authenticated,\n",
        "count": 1
    },
    {
        "before": "function publishSessionToWindow(session: PublicSession) {",
        "after": "function publishSessionToWindow(session: PublicSession, reason: \"session\" | \"logout\" = \"session\") {",
        "count": 1
    },
    {
        "before": "const applySession = useCallback((rawData: unknown) => {",
        "after": "const applySession = useCallback((rawData: unknown, reason: \"session\" | \"logout\" = \"session\") => {",
        "count": 1
    },
    {
        "before": "publishSessionToWindow(nextSession);",
        "after": "publishSessionToWindow(nextSession, reason);",
        "count": 1
    },
    {
        "before": "      applySession(EMPTY_SESSION);\n      setHealth(\"unauthenticated\");",
        "after": "      applySession(EMPTY_SESSION, \"logout\");\n      setHealth(\"unauthenticated\");",
        "count": 1
    }
]
};

export function restoreApprovedPreviewPipeline(path, source) {
  for (const { before, after, count } of pipelineChanges[path] ?? []) {
    assert.equal(source.split(after).length - 1, count, `exact approved preview pipeline edit: ${path}`);
    source = source.replaceAll(after, before);
  }
  return source;
}
export function restoreApprovedThumbnailReliability(path, source) {
  source = restoreApprovedPreviewPipeline(path, source);
  for (const { before, after } of changes[path] ?? []) {
    assert.equal(source.split(after).length - 1, 1, `exact approved thumbnail edit: ${path}`);
    source = source.replace(after, before);
  }
  return source;
}
