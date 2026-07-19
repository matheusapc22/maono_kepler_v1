import { useMemo, useState } from "react";

type CatalogItem = {
  code: string;
  name: string;
  group: string;
  risk?: string;
  ownerDelegable?: boolean;
  reason?: string;
};

type PolicyPermission = {
  permission: string;
  canGrant: boolean;
  canRevoke: boolean;
};

type Policy = {
  id?: number;
  enabled: boolean;
  expiresAt: string | null;
  version: number;
  permissions: PolicyPermission[];
  targetLevels: string[];
};

type Organization = {
  id: number;
  name: string;
  assigned: boolean;
  accessLevel: string;
};

async function json(response: Response) {
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error?.message || data?.error || "Erro na requisição.");
  }
  return data;
}

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

const EMPTY_POLICY: Policy = {
  enabled: false,
  expiresAt: null,
  version: 0,
  permissions: [],
  targetLevels: ["viewer", "editor"],
};

function localDateTimeValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export default function AdminOrganizationAccessPanel({
  userId,
  userRole,
  organization,
  disabled,
  onMessage,
}: {
  userId: number;
  userRole: string;
  organization: Organization;
  disabled: boolean;
  onMessage: (kind: "error" | "success", text: string) => void;
}) {
  const eligible =
    organization.assigned &&
    (String(userRole).toLowerCase() === "admin" ||
      organization.accessLevel === "owner");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [initial, setInitial] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [policy, setPolicy] = useState<Policy>(EMPTY_POLICY);
  const delegable = useMemo(
    () => catalog.filter((item) => item.ownerDelegable),
    [catalog],
  );

  async function load() {
    setBusy(true);
    try {
      const [accessData, policyData] = await Promise.all([
        fetch(
          `/api/admin/organizations/${organization.id}/users/${userId}/permissions`,
          { credentials: "include", headers: { Accept: "application/json" } },
        ).then(json),
        fetch(
          `/api/admin/organizations/${organization.id}/delegations/${userId}`,
          { credentials: "include", headers: { Accept: "application/json" } },
        ).then(json),
      ]);
      setCatalog(accessData.catalog || policyData.catalog || []);
      setInitial(accessData.permissions || []);
      setSelected(accessData.permissions || []);
      setPolicy(policyData.policy || EMPTY_POLICY);
      setOpen(true);
    } catch (error) {
      onMessage(
        "error",
        error instanceof Error ? error.message : "Falha ao carregar acessos.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAccesses() {
    for (const code of selected.filter((item) => !initial.includes(item))) {
      await fetch(
        `/api/admin/organizations/${organization.id}/users/${userId}/permissions`,
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ permission: code }),
        },
      ).then(json);
    }
    for (const code of initial.filter((item) => !selected.includes(item))) {
      await fetch(
        `/api/admin/organizations/${organization.id}/users/${userId}/permissions`,
        {
          method: "DELETE",
          credentials: "include",
          headers,
          body: JSON.stringify({ permission: code }),
        },
      ).then(json);
    }
  }

  function policyPermission(code: string): PolicyPermission {
    return (
      policy.permissions.find((item) => item.permission === code) || {
        permission: code,
        canGrant: false,
        canRevoke: false,
      }
    );
  }

  function updatePolicyPermission(
    code: string,
    key: "canGrant" | "canRevoke",
    value: boolean,
  ) {
    const next = { ...policyPermission(code), [key]: value };
    setPolicy({
      ...policy,
      permissions: [
        ...policy.permissions.filter((item) => item.permission !== code),
        next,
      ].filter((item) => item.canGrant || item.canRevoke),
    });
  }

  async function save() {
    if (
      policy.enabled &&
      (!policy.targetLevels.length || !policy.permissions.length)
    ) {
      onMessage(
        "error",
        "A delegação exige perfil de destino e pelo menos uma ação permitida.",
      );
      return;
    }
    setBusy(true);
    try {
      await saveAccesses();
      if (policy.enabled) {
        await fetch(
          `/api/admin/organizations/${organization.id}/delegations/${userId}`,
          {
            method: "PUT",
            credentials: "include",
            headers,
            body: JSON.stringify({
              ...policy,
              expiresAt: policy.expiresAt
                ? new Date(policy.expiresAt).toISOString()
                : null,
            }),
          },
        ).then(json);
      } else if (policy.id) {
        await fetch(
          `/api/admin/organizations/${organization.id}/delegations/${userId}`,
          {
            method: "DELETE",
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        ).then(json);
      }
      onMessage("success", "Acessos e política organizacional salvos.");
      setOpen(false);
    } catch (error) {
      onMessage(
        "error",
        error instanceof Error ? error.message : "Falha ao salvar governança.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="mm-btn tiny"
        disabled={disabled || !organization.assigned || busy}
        onClick={() => void load()}
      >
        {busy ? "Carregando..." : "Acessos e delegação"}
      </button>
      {open && (
        <div
          className="admin-user-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Acessos em ${organization.name}`}
        >
          <div className="admin-user-dialog delegation-dialog">
            <header>
              <div>
                <span>GOVERNANÇA ORGANIZACIONAL</span>
                <h3>{organization.name}</h3>
                <p>Acessos do usuário e limites para delegação.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
            </header>
            <div className="delegation-editor">
              <section>
                <h4>Acessos adicionais do usuário</h4>
                <p>Geridos exclusivamente pelo Super Admin.</p>
                <div className="delegation-catalog">
                  {catalog
                    .filter(
                      (item) =>
                        item.code !== "organization.users.permissions.delegate" &&
                        item.group !== "Plataforma",
                    )
                    .map((item) => (
                      <label key={item.code}>
                        <input
                          type="checkbox"
                          checked={selected.includes(item.code)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, item.code]
                                : selected.filter((code) => code !== item.code),
                            )
                          }
                        />
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.group}
                            {item.reason ? ` · ${item.reason}` : ""}
                          </small>
                        </span>
                      </label>
                    ))}
                </div>
              </section>
              <section className="delegation-policy">
                <label className="delegation-toggle">
                  <input
                    type="checkbox"
                    checked={policy.enabled}
                    disabled={!eligible}
                    onChange={(event) =>
                      setPolicy({ ...policy, enabled: event.target.checked })
                    }
                  />
                  <span>
                    <strong>Delegar acessos da organização</strong>
                    <small>
                      {eligible
                        ? "O usuário poderá gerir somente os limites abaixo em Projects → Usuários e Acessos."
                        : "Disponível apenas para admin ou owner ativo desta organização."}
                    </small>
                  </span>
                </label>
                {policy.enabled && eligible && (
                  <>
                    <div className="delegation-targets">
                      <strong>Perfis de destino</strong>
                      {["viewer", "editor"].map((level) => (
                        <label key={level}>
                          <input
                            type="checkbox"
                            checked={policy.targetLevels.includes(level)}
                            onChange={(event) =>
                              setPolicy({
                                ...policy,
                                targetLevels: event.target.checked
                                  ? [...policy.targetLevels, level]
                                  : policy.targetLevels.filter(
                                      (item) => item !== level,
                                    ),
                              })
                            }
                          />
                          {level === "viewer" ? "Consulta" : "Colaborador"}
                        </label>
                      ))}
                    </div>
                    <label>
                      Expiração opcional
                      <input
                        type="datetime-local"
                        value={localDateTimeValue(policy.expiresAt)}
                        onChange={(event) =>
                          setPolicy({
                            ...policy,
                            expiresAt: event.target.value || null,
                          })
                        }
                      />
                    </label>
                    <div className="delegation-limits">
                      <div>
                        <strong>Acesso delegável</strong>
                        <span>Conceder</span>
                        <span>Revogar</span>
                      </div>
                      {delegable.map((item) => {
                        const value = policyPermission(item.code);
                        return (
                          <div key={item.code}>
                            <span>
                              <strong>{item.name}</strong>
                              <small>{item.group}</small>
                            </span>
                            <input
                              aria-label={`Conceder ${item.name}`}
                              type="checkbox"
                              checked={value.canGrant}
                              onChange={(event) =>
                                updatePolicyPermission(
                                  item.code,
                                  "canGrant",
                                  event.target.checked,
                                )
                              }
                            />
                            <input
                              aria-label={`Revogar ${item.name}`}
                              type="checkbox"
                              checked={value.canRevoke}
                              onChange={(event) =>
                                updatePolicyPermission(
                                  item.code,
                                  "canRevoke",
                                  event.target.checked,
                                )
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                    <aside className="delegation-protections">
                      <strong>Proteções permanentes</strong>
                      <p>
                        GeoJSON amplo, painel global, auditoria, meta-delegação,
                        owners/admins e autogestão permanecem bloqueados.
                      </p>
                    </aside>
                  </>
                )}
              </section>
              <footer>
                <button type="button" className="mm-btn" onClick={() => setOpen(false)}>Cancelar</button>
                <button type="button" className="mm-btn primary" disabled={busy} onClick={() => void save()}>
                  {busy ? "Salvando..." : "Salvar configuração"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
