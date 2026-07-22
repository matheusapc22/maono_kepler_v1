import { useCallback, useEffect, useMemo, useState } from "react";

import {
  grantOrganizationUserPermission,
  listOrganizationUsers,
  revokeOrganizationUserPermission,
  type OrganizationUser,
} from "../../lib/api";
import {
  accessFromCode,
  profileFromTechnical,
} from "../../pages/Projects/components/user-access-commercial";
import "./OrganizationPermissionManager.css";

type ApiId = number | string;

const ADMIN_OWNER_NATIVE_ACCESS_CODES = new Set([
  "project.create",
  "project.edit",
  "project.save",
  "project.thumbnail.update",
  "document.view",
  "document.upload",
  "document.download",
  "document.delete",
  "ticket.view",
  "ticket.create",
  "ticket.comment",
  "ticket.manage",
  "ticket.close",
  "ticket.assign",
  "roadmap.view",
  "roadmap.comment.create",
  "roadmap.comment.edit_own",
  "roadmap.comment.moderate",
  "roadmap.manage",
  "roadmap.task.manage",
  "roadmap.dependency.manage",
  "users.view",
  "users.create",
  "users.edit",
  "users.disable",
  "users.delete",
  "users.invite",
  "organization.view",
  "organization.edit",
  "organization.metrics.view",
  "plan.view",
  "limits.view",
  "limits.increase_request",
]);

export type AccessGovernanceCapabilities = {
  mode: "super_admin" | "organization";
  organizationId: ApiId;
  canManageAdditionalAccesses: boolean;
  canGrant: boolean;
  canRevoke: boolean;
  allowedPermissions: string[];
  grantPermissions: string[];
  revokePermissions: string[];
  allowedTargetLevels: string[];
  delegation?: {
    enabled?: boolean;
    expired?: boolean;
    expiresAt?: string | null;
    version?: number;
  } | null;
  reason: string;
};

export async function loadAccessGovernance(
  organizationId: ApiId,
): Promise<AccessGovernanceCapabilities> {
  const response = await fetch(
    "/api/organizations/" +
      encodeURIComponent(String(organizationId)) +
      "/access-governance",
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
  const data = await response.json();
  if (!response.ok || data?.ok === false || !data?.capabilities) {
    throw new Error(
      data?.error?.message ||
        data?.error ||
        "Não foi possível carregar a governança de acessos.",
    );
  }
  return data.capabilities as AccessGovernanceCapabilities;
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}

function profileLabel(person: OrganizationUser): string {
  return (
    profileFromTechnical(person.role, person.accessLevel)?.shortName ??
    "Perfil personalizado"
  );
}

function targetLevel(person: OrganizationUser): string {
  return String(person.accessLevel || "")
    .trim()
    .toLowerCase();
}

function hasAdminOrOwnerNativeProfile(person: OrganizationUser): boolean {
  const role = String(person.role || "")
    .trim()
    .toLowerCase();
  return (
    role === "admin" ||
    role === "owner" ||
    role === "client" ||
    targetLevel(person) === "owner"
  );
}

function sameId(left: ApiId | undefined, right: ApiId | undefined): boolean {
  return (
    left !== undefined && right !== undefined && String(left) === String(right)
  );
}

export default function OrganizationPermissionManager({
  organizationId,
  actorUserId,
  initialTargetUserId,
  mode,
  onClose,
  onSaved,
}: {
  organizationId: ApiId;
  actorUserId?: ApiId;
  initialTargetUserId?: ApiId;
  mode: "admin" | "delegated";
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const [people, setPeople] = useState<OrganizationUser[]>([]);
  const [governance, setGovernance] =
    useState<AccessGovernanceCapabilities | null>(null);
  const [targetId, setTargetId] = useState<ApiId | "">(
    initialTargetUserId ?? "",
  );
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [geoJsonAcknowledged, setGeoJsonAcknowledged] = useState(false);
  const [geoJsonJustification, setGeoJsonJustification] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [peopleResult, capabilities] = await Promise.all([
        listOrganizationUsers(organizationId),
        loadAccessGovernance(organizationId),
      ]);
      setPeople(peopleResult.users ?? []);
      setGovernance(capabilities);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const eligiblePeople = useMemo(() => {
    if (!governance) return [];
    return people.filter((person) => {
      if (person.active === false) return false;
      if (mode === "delegated" && sameId(person.id, actorUserId)) return false;
      if (governance.mode === "super_admin") return true;
      return governance.allowedTargetLevels.includes(targetLevel(person));
    });
  }, [actorUserId, governance, mode, people]);

  useEffect(() => {
    if (initialTargetUserId !== undefined) {
      if (
        eligiblePeople.some((person) => sameId(person.id, initialTargetUserId))
      ) {
        setTargetId(initialTargetUserId);
      }
      return;
    }
    if (
      targetId === "" ||
      !eligiblePeople.some((person) => sameId(person.id, targetId))
    ) {
      setTargetId(eligiblePeople[0]?.id ?? "");
    }
  }, [eligiblePeople, initialTargetUserId, targetId]);

  const target = useMemo(
    () => eligiblePeople.find((person) => sameId(person.id, targetId)) ?? null,
    [eligiblePeople, targetId],
  );

  useEffect(() => {
    setSelectedPermissions([...(target?.permissions ?? [])]);
    setGeoJsonAcknowledged(false);
    setGeoJsonJustification("");
    setMessage(null);
  }, [target]);

  const grantPermissions = useMemo(
    () => new Set(governance?.grantPermissions ?? []),
    [governance],
  );
  const revokePermissions = useMemo(
    () => new Set(governance?.revokePermissions ?? []),
    [governance],
  );
  const accessOptions = useMemo(
    () =>
      (governance?.allowedPermissions ?? [])
        .filter(
          (code) =>
            grantPermissions.has(code) || selectedPermissions.includes(code),
        )
        .filter(
          (code) =>
            !target ||
            !hasAdminOrOwnerNativeProfile(target) ||
            !ADMIN_OWNER_NATIVE_ACCESS_CODES.has(code),
        )
        .map((code) => accessFromCode(code)),
    [governance, grantPermissions, selectedPermissions, target],
  );
  const groups = useMemo(
    () => Array.from(new Set(accessOptions.map((item) => item.group))),
    [accessOptions],
  );

  const changed = useMemo(() => {
    if (!target) return false;
    const before = new Set(target.permissions ?? []);
    const after = new Set(selectedPermissions);
    return (
      selectedPermissions.some((code) => !before.has(code)) ||
      (target.permissions ?? []).some((code) => !after.has(code))
    );
  }, [selectedPermissions, target]);

  function togglePermission(code: string) {
    const selected = selectedPermissions.includes(code);
    const canChange = selected
      ? revokePermissions.has(code)
      : grantPermissions.has(code);
    if (!canChange) return;
    setSelectedPermissions(
      selected
        ? selectedPermissions.filter((item) => item !== code)
        : [...selectedPermissions, code],
    );
  }

  async function save() {
    if (!target || !governance || !changed) return;

    const before = target.permissions ?? [];
    const additions = selectedPermissions.filter(
      (code) => !before.includes(code) && grantPermissions.has(code),
    );
    const removals = before.filter(
      (code) =>
        !selectedPermissions.includes(code) && revokePermissions.has(code),
    );
    const geoJsonCode = "organization.projects.geojson.view";

    if (
      additions.includes(geoJsonCode) &&
      (!geoJsonAcknowledged || !geoJsonJustification.trim())
    ) {
      setMessage({
        kind: "error",
        text: "Confirme a ciência e informe uma justificativa para liberar GeoJSON amplo.",
      });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      for (const code of additions) {
        await grantOrganizationUserPermission(
          organizationId,
          target.id,
          code,
          code === geoJsonCode
            ? {
                warningAcknowledged: geoJsonAcknowledged,
                justification: geoJsonJustification.trim(),
              }
            : undefined,
        );
      }
      for (const code of removals) {
        await revokeOrganizationUserPermission(organizationId, target.id, code);
      }
      await load();
      await onSaved?.();
      setMessage({
        kind: "success",
        text: "Acessos adicionais atualizados dentro da política vigente.",
      });
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="org-permission-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="org-permission-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-permission-title"
      >
        <header>
          <div>
            <span>
              {mode === "admin"
                ? "USUÁRIOS E PERMISSÕES"
                : "DELEGAÇÃO LIMITADA"}
            </span>
            <h3 id="org-permission-title">Gerenciar acessos adicionais</h3>
            <p>
              {mode === "admin"
                ? "Gestão exclusiva do Super Admin no Painel Admin."
                : "Gestão delegada em Projects, restrita à organização ativa e à whitelist concedida."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <div className="org-permission-body">
          {loading && <p role="status">Carregando política e equipe...</p>}

          {!loading && !governance?.canManageAdditionalAccesses && (
            <div className="org-permission-notice error" role="alert">
              Esta conta não possui uma delegação ativa para gerenciar acessos
              nesta organização.
            </div>
          )}

          {!loading && governance?.canManageAdditionalAccesses && (
            <>
              <div className="org-permission-scope" role="status">
                <strong>
                  {governance.mode === "super_admin"
                    ? "Autoridade do Super Admin"
                    : "Delegação por organização"}
                </strong>
                <span>
                  {governance.mode === "super_admin"
                    ? "A operação será registrada na gestão central."
                    : "O backend revalidará organização, alvo, operação e teto no salvamento."}
                </span>
              </div>

              <label className="org-permission-target">
                Pessoa
                <select
                  value={String(targetId)}
                  disabled={initialTargetUserId !== undefined || saving}
                  onChange={(event) => setTargetId(event.target.value)}
                >
                  {eligiblePeople.length === 0 && (
                    <option value="">Nenhum perfil elegível</option>
                  )}
                  {eligiblePeople.map((person) => (
                    <option key={String(person.id)} value={String(person.id)}>
                      {(person.name || person.email || "Pessoa") +
                        " — " +
                        profileLabel(person)}
                    </option>
                  ))}
                </select>
              </label>

              {target && hasAdminOrOwnerNativeProfile(target) && (
                <div className="org-permission-notice" role="note">
                  As capacidades nativas de Gestor/Responsável são garantidas
                  pelo código e não aparecem como concessões adicionais. Este
                  painel mostra somente o que está fora do perfil básico.
                </div>
              )}

              {target && (
                <div className="org-permission-catalog">
                  {groups.map((group) => (
                    <fieldset key={group}>
                      <legend>{group}</legend>
                      {accessOptions
                        .filter((item) => item.group === group)
                        .map((item) => {
                          const selected = selectedPermissions.includes(
                            item.code,
                          );
                          const canChange = selected
                            ? revokePermissions.has(item.code)
                            : grantPermissions.has(item.code);
                          return (
                            <label
                              key={item.code}
                              className={
                                "org-permission-option" +
                                (canChange ? "" : " disabled")
                              }
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                disabled={!canChange || saving}
                                onChange={() => togglePermission(item.code)}
                              />
                              <span>
                                <strong>{item.name}</strong>
                                <small>{item.description}</small>
                                {!canChange && (
                                  <em>
                                    {selected
                                      ? "Revogação não concedida"
                                      : "Concessão não concedida"}
                                  </em>
                                )}
                              </span>
                            </label>
                          );
                        })}
                    </fieldset>
                  ))}
                </div>
              )}

              {target &&
                selectedPermissions.includes(
                  "organization.projects.geojson.view",
                ) &&
                !(target.permissions ?? []).includes(
                  "organization.projects.geojson.view",
                ) && (
                  <div className="org-permission-geojson" role="alert">
                    <strong>Acesso amplo a GeoJSON</strong>
                    <label>
                      <input
                        type="checkbox"
                        checked={geoJsonAcknowledged}
                        onChange={(event) =>
                          setGeoJsonAcknowledged(event.target.checked)
                        }
                      />
                      Estou ciente do alcance deste acesso.
                    </label>
                    <label>
                      Justificativa obrigatória
                      <textarea
                        value={geoJsonJustification}
                        maxLength={500}
                        onChange={(event) =>
                          setGeoJsonJustification(event.target.value)
                        }
                      />
                    </label>
                  </div>
                )}
            </>
          )}

          {message && (
            <div
              className={"org-permission-notice " + message.kind}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {message.text}
            </div>
          )}
        </div>

        <footer>
          <button
            type="button"
            className="mm-btn"
            onClick={onClose}
            disabled={saving}
          >
            Fechar
          </button>
          <button
            type="button"
            className="mm-btn primary"
            disabled={
              saving ||
              !target ||
              !governance?.canManageAdditionalAccesses ||
              !changed
            }
            onClick={() => void save()}
          >
            {saving ? "Salvando..." : "Salvar acessos"}
          </button>
        </footer>
      </section>
    </div>
  );
}
