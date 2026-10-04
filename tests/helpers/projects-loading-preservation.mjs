import assert from "node:assert/strict";

// Exact inverse of the reviewed Projects loading-only changes against f964539.
// Keep the original full-source selector hash unchanged. Each replacement must
// occur exactly once; all other option, payload, API and permission bytes remain
// protected by the original hash in maono-select-migration.test.mjs.
const loadingChanges = [
  {
    "after": "import { MaonoSelect } from \"../../../components/selection/MaonoSelect\";\nimport { useCallback, useEffect, useMemo, useRef, useState } from \"react\";\n\nimport { LimitsPlansSectionSkeleton } from \"./ProjectSectionSkeletons\";\n\nimport type { MaonoUser } from \"../../../auth/session\";\n",
    "before": "import { MaonoSelect } from \"../../../components/selection/MaonoSelect\";\nimport { useCallback, useEffect, useMemo, useState } from \"react\";\n\nimport type { MaonoUser } from \"../../../auth/session\";\n"
  },
  {
    "after": "}\n\nexport default function LimitsPlansSection(props: LimitsPlansSectionProps) {\n  const contextKey = JSON.stringify([getOrganizationId(props.user), props.user?.id, getUserRole(props.user), getUserPermissions(props.user), getUserScopes(props.user)]);\n  return <LimitsPlansWorkspace key={contextKey} {...props} />;\n}\n\nfunction LimitsPlansWorkspace({ user, projectsCount }: LimitsPlansSectionProps) {\n  const organizationId = useMemo(() => getOrganizationId(user), [user]);\n  const permissions = useMemo(() => ({\n",
    "before": "}\n\nexport default function LimitsPlansSection({ user, projectsCount }: LimitsPlansSectionProps) {\n  const organizationId = useMemo(() => getOrganizationId(user), [user]);\n  const permissions = useMemo(() => ({\n"
  },
  {
    "after": "  const [pendingRequests, setPendingRequests] = useState<OrganizationLimitRequest[]>([]);\n  const [form, setForm] = useState<UpgradeForm>(DEFAULT_UPGRADE_FORM);\n  const [loading, setLoading] = useState(Boolean(organizationId && permissions.view));\n  const requestRef = useRef(0);\n  const [busyKey, setBusyKey] = useState<string | null>(null);\n  const [errorMessage, setErrorMessage] = useState<string | null>(null);\n",
    "before": "  const [pendingRequests, setPendingRequests] = useState<OrganizationLimitRequest[]>([]);\n  const [form, setForm] = useState<UpgradeForm>(DEFAULT_UPGRADE_FORM);\n  const [loading, setLoading] = useState(false);\n  const [busyKey, setBusyKey] = useState<string | null>(null);\n  const [errorMessage, setErrorMessage] = useState<string | null>(null);\n"
  },
  {
    "after": "  const loadLimits = useCallback(async () => {\n    if (!organizationId || !permissions.view) return;\n    const revision = ++requestRef.current;\n    setLoading(true);\n    setErrorMessage(null);\n    try {\n      const response = await getOrganizationLimits(organizationId);\n      if (revision !== requestRef.current) return;\n      setLimits(response.limits);\n      setPendingRequests(response.pendingRequests || []);\n    } catch (error) {\n      if (revision === requestRef.current) setErrorMessage(normalizeUserError(error).message);\n    } finally {\n      if (revision === requestRef.current) setLoading(false);\n    }\n  }, [organizationId, permissions.view]);\n\n  useEffect(() => {\n    void loadLimits();\n    return () => { requestRef.current += 1; };\n  }, [loadLimits]);\n\n  function updateForm<K extends keyof UpgradeForm>(key: K, value: UpgradeForm[K]) {\n",
    "before": "  const loadLimits = useCallback(async () => {\n    if (!organizationId || !permissions.view) return;\n    setLoading(true);\n    setErrorMessage(null);\n    try {\n      const response = await getOrganizationLimits(organizationId);\n      setLimits(response.limits);\n      setPendingRequests(response.pendingRequests || []);\n    } catch (error) {\n      setErrorMessage(normalizeUserError(error).message);\n    } finally {\n      setLoading(false);\n    }\n  }, [organizationId, permissions.view]);\n\n  useEffect(() => { void loadLimits(); }, [loadLimits]);\n\n  function updateForm<K extends keyof UpgradeForm>(key: K, value: UpgradeForm[K]) {\n"
  },
  {
    "after": "\n  return (\n    <section className=\"mm-card mm-section-card mm-limits-section\">\n      <h2>Limites e Planos</h2>\n      <p>Acompanhe o uso atual da organização e solicite upgrade de plano ou aumento de limites.</p>\n\n      {errorMessage && <div className=\"mm-card\" role=\"alert\"><strong>Não foi possível concluir</strong><p>{errorMessage}</p><button type=\"button\" className=\"mm-btn\" disabled={loading} onClick={() => void loadLimits()}>Recarregar</button></div>}\n      {successMessage && <div className=\"mm-card\" role=\"status\"><strong>Sucesso</strong><p>{successMessage}</p></div>}\n      <span className=\"mm-sr-only\" role=\"status\">{loading ? limits ? \"Atualizando limites da organização.\" : \"Carregando limites da organização.\" : \"\"}</span>\n      <div className=\"mm-section-load-region\" role=\"region\" aria-label=\"Limites da organização\" aria-busy={loading}>\n      {loading && !limits ? <LimitsPlansSectionSkeleton requestForm={permissions.increaseRequest} /> : null}\n\n      {limits && <>\n        <div className=\"mm-card\"><h3>Plano atual</h3><div className=\"mm-tags-list\"><span className={planClassName(limits?.plan)}>{planLabel(limits?.plan)}</span></div><p>Alterações de plano são analisadas antes de entrarem em vigor.</p></div>\n\n",
    "before": "\n  return (\n    <section className=\"mm-card mm-section-card\">\n      <h2>Limites e Planos</h2>\n      <p>Acompanhe o uso atual da organização e solicite upgrade de plano ou aumento de limites.</p>\n\n      {errorMessage && <div className=\"mm-card\" role=\"alert\"><strong>Não foi possível concluir</strong><p>{errorMessage}</p><button type=\"button\" className=\"mm-btn\" onClick={() => void loadLimits()}>Recarregar</button></div>}\n      {successMessage && <div className=\"mm-card\" role=\"status\"><strong>Sucesso</strong><p>{successMessage}</p></div>}\n      {loading && <div className=\"mm-card\"><p>Carregando limites da organização...</p></div>}\n\n      {!loading && <>\n        <div className=\"mm-card\"><h3>Plano atual</h3><div className=\"mm-tags-list\"><span className={planClassName(limits?.plan)}>{planLabel(limits?.plan)}</span></div><p>Alterações de plano são analisadas antes de entrarem em vigor.</p></div>\n\n"
  },
  {
    "after": "        <div className=\"mm-card\"><h3>Solicitações pendentes</h3><PendingRequestsTable requests={pendingRequests} /></div>\n      </>}\n      </div>\n    </section>\n  );\n",
    "before": "        <div className=\"mm-card\"><h3>Solicitações pendentes</h3><PendingRequestsTable requests={pendingRequests} /></div>\n      </>}\n    </section>\n  );\n"
  }
];

export function restoreLimitsPlansLoading(source) {
  for (const { after, before } of loadingChanges) {
    assert.equal(source.split(after).length - 1, 1, "exact approved Limits loading change");
    source = source.replace(after, before);
  }
  return source;
}
