import React, { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";

type AdminUser = {
  id: number;
  email: string;
  name?: string;
  role: string;
  active: boolean;
};

type Organization = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  dropboxRootPath: string;
  active: boolean;
  fileCount?: number;
  projectCount?: number;
  userCount?: number;
};

type OrganizationFile = {
  id: number;
  organizationId: number;
  name: string;
  fileName: string;
  dropboxPath: string;
  fileType: string;
  sizeBytes?: number;
  isProject: boolean;
  active: boolean;
};

type OrganizationUser = {
  id: number;
  organizationId: number;
  accessLevel: string;
  user: AdminUser;
};

type DropboxEntry = {
  tag: string;
  name: string;
  pathDisplay?: string;
  pathLower?: string;
  size?: number;
};

const EMPTY_ORG_FORM = {
  name: "",
  slug: "",
  description: "",
  dropboxRootPath: "/projects/",
  active: true,
};

const fieldStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  color: "#0f172a",
  WebkitTextFillColor: "#0f172a",
  caretColor: "#0f172a",
};

const selectStyle: React.CSSProperties = {
  ...fieldStyle,
  colorScheme: "light",
};

async function readJson(response: Response) {
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Erro na requisição.");
  }
  return data;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeProjectPath(slug: string) {
  const cleanSlug = slugify(slug);
  return cleanSlug ? `/projects/${cleanSlug}` : "/projects/";
}

const AdminFilesPage: React.FC = () => {
  const { authenticated, loading, user, logout } = useSession();
  const navigate = useNavigate();

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<number | null>(null);
  const [organizationFiles, setOrganizationFiles] = useState<OrganizationFile[]>([]);
  const [organizationUsers, setOrganizationUsers] = useState<OrganizationUser[]>([]);
  const [dropboxEntries, setDropboxEntries] = useState<DropboxEntry[]>([]);

  const [orgForm, setOrgForm] = useState(EMPTY_ORG_FORM);
  const [editingOrgId, setEditingOrgId] = useState<number | null>(null);
  const [fileUpload, setFileUpload] = useState<File | null>(null);
  const [fileDisplayName, setFileDisplayName] = useState("");
  const [orgUserForm, setOrgUserForm] = useState({ userId: "", accessLevel: "viewer" });

  const [savingOrganization, setSavingOrganization] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [savingOrgUser, setSavingOrgUser] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [transformingFileId, setTransformingFileId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isAdmin = user?.role === "admin";
  const selectedOrganization = useMemo(
    () => organizations.find((item) => item.id === selectedOrganizationId) || null,
    [organizations, selectedOrganizationId]
  );

  const activeUsers = useMemo(() => users.filter((item) => item.active), [users]);

  function isJsonKeplerCandidate(file: OrganizationFile) {
    return file.active && file.fileName.toLowerCase().endsWith(".json");
  }

  async function refreshOrganizations(nextSelectedId?: number | null) {
    const [organizationsData, usersData] = await Promise.all([
      fetch("/api/admin/organizations", {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson),
      fetch("/api/admin/users", {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson),
    ]);

    const nextOrganizations = organizationsData.organizations || [];
    setOrganizations(nextOrganizations);
    setUsers(usersData.users || []);

    if (nextSelectedId === null) {
      setSelectedOrganizationId(null);
      return;
    }

    if (nextSelectedId) {
      setSelectedOrganizationId(nextSelectedId);
      return;
    }

    if (!selectedOrganizationId && nextOrganizations.length > 0) {
      setSelectedOrganizationId(nextOrganizations[0].id);
    }
  }

  async function refreshOrganizationDetails(organizationId: number) {
    setLoadingDetails(true);
    setError("");

    try {
      const [filesData, usersData] = await Promise.all([
        fetch(`/api/admin/organizations/${organizationId}/files`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        }).then(readJson),
        fetch(`/api/admin/organizations/${organizationId}/users`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        }).then(readJson),
      ]);

      setOrganizationFiles(filesData.files || []);
      setDropboxEntries(filesData.dropboxEntries || []);
      setOrganizationUsers(usersData.users || []);
    } catch (err) {
      setOrganizationFiles([]);
      setDropboxEntries([]);
      setOrganizationUsers([]);
      setError(err instanceof Error ? err.message : "Erro ao carregar organização.");
    } finally {
      setLoadingDetails(false);
    }
  }

  useEffect(() => {
    if (!loading && !authenticated) navigate("/login?next=/admin/files", { replace: true });
  }, [authenticated, loading, navigate]);

  useEffect(() => {
    if (!loading && authenticated && !isAdmin) navigate("/projects", { replace: true });
  }, [authenticated, isAdmin, loading, navigate]);

  useEffect(() => {
    if (!loading && authenticated && isAdmin) {
      refreshOrganizations().catch((err) => setError(err.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, isAdmin, loading]);

  useEffect(() => {
    if (selectedOrganizationId) {
      refreshOrganizationDetails(selectedOrganizationId);
    } else {
      setOrganizationFiles([]);
      setOrganizationUsers([]);
      setDropboxEntries([]);
    }
  }, [selectedOrganizationId]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  function resetOrgForm() {
    setEditingOrgId(null);
    setOrgForm(EMPTY_ORG_FORM);
  }

  function handleEditOrganization(organization: Organization) {
    setEditingOrgId(organization.id);
    setOrgForm({
      name: organization.name,
      slug: organization.slug,
      description: organization.description || "",
      dropboxRootPath: organization.dropboxRootPath,
      active: organization.active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSaveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingOrganization(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...orgForm,
        slug: orgForm.slug || slugify(orgForm.name),
        dropboxRootPath:
          orgForm.dropboxRootPath && orgForm.dropboxRootPath !== "/projects/"
            ? orgForm.dropboxRootPath
            : normalizeProjectPath(orgForm.slug || orgForm.name),
      };

      const url = editingOrgId
        ? `/api/admin/organizations/${editingOrgId}`
        : "/api/admin/organizations";
      const method = editingOrgId ? "PUT" : "POST";

      const data = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      }).then(readJson);

      const savedOrganization = data.organization;
      setSuccess(editingOrgId ? "Organização atualizada com sucesso." : "Organização criada com sucesso.");
      resetOrgForm();
      await refreshOrganizations(savedOrganization?.id || selectedOrganizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar organização.");
    } finally {
      setSavingOrganization(false);
    }
  }

  async function handleDeleteOrganization(organization: Organization, deleteDropbox = false) {
    const actionText = deleteDropbox ? "excluir também a pasta no Dropbox" : "desativar no sistema";
    const confirmed = window.confirm(
      `Deseja ${actionText} a organização \"${organization.name}\"?`
    );

    if (!confirmed) return;

    setError("");
    setSuccess("");

    try {
      await fetch(`/api/admin/organizations/${organization.id}${deleteDropbox ? "?dropbox=true" : ""}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson);

      setSuccess(deleteDropbox ? "Organização e pasta Dropbox excluídas." : "Organização desativada.");
      if (selectedOrganizationId === organization.id) {
        setSelectedOrganizationId(null);
      }
      await refreshOrganizations(selectedOrganizationId === organization.id ? null : selectedOrganizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir organização.");
    }
  }

  function handleFileInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setFileUpload(file);
    if (file && !fileDisplayName) {
      setFileDisplayName(file.name);
    }
  }

  async function handleUploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedOrganizationId || !fileUpload) return;

    setSavingFile(true);
    setError("");
    setSuccess("");

    try {
      const formData = new FormData();
      formData.set("file", fileUpload);
      formData.set("name", fileDisplayName || fileUpload.name);

      await fetch(`/api/admin/organizations/${selectedOrganizationId}/files`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
        body: formData,
      }).then(readJson);

      setSuccess("Arquivo enviado para a organização com sucesso.");
      setFileUpload(null);
      setFileDisplayName("");
      await refreshOrganizationDetails(selectedOrganizationId);
      await refreshOrganizations(selectedOrganizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar arquivo.");
    } finally {
      setSavingFile(false);
    }
  }

  async function handleCreateProjectFromFile(file: OrganizationFile) {
    const defaultSlug = slugify(file.name || file.fileName.replace(/\.json$/i, ""));
    const projectName = window.prompt("Nome do projeto:", file.name || file.fileName.replace(/\.json$/i, ""));

    if (!projectName) return;

    const projectSlug = window.prompt("Identificador do projeto:", defaultSlug);

    if (!projectSlug) return;

    const confirmed = window.confirm(
      "Criar projeto a partir deste JSON e copiar os usuários vinculados à organização para o projeto?"
    );

    if (!confirmed) return;

    setTransformingFileId(file.id);
    setError("");
    setSuccess("");

    try {
      await fetch(`/api/admin/organization-files/${file.id}/project`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: projectName,
          slug: slugify(projectSlug),
          copyOrganizationAccess: true,
        }),
      }).then(readJson);

      setSuccess("Projeto criado a partir do arquivo. Os usuários da organização foram vinculados ao projeto.");
      if (selectedOrganizationId) {
        await refreshOrganizationDetails(selectedOrganizationId);
        await refreshOrganizations(selectedOrganizationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao transformar arquivo em projeto.");
    } finally {
      setTransformingFileId(null);
    }
  }

  async function handleDeleteFile(file: OrganizationFile, deleteDropbox = false) {
    const actionText = deleteDropbox ? "excluir também do Dropbox" : "desativar no sistema";
    const confirmed = window.confirm(`Deseja ${actionText} o arquivo \"${file.fileName}\"?`);

    if (!confirmed) return;

    setError("");
    setSuccess("");

    try {
      await fetch(`/api/admin/organization-files/${file.id}${deleteDropbox ? "?dropbox=true" : ""}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson);

      setSuccess(deleteDropbox ? "Arquivo excluído do sistema e do Dropbox." : "Arquivo desativado no sistema.");
      if (selectedOrganizationId) {
        await refreshOrganizationDetails(selectedOrganizationId);
        await refreshOrganizations(selectedOrganizationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir arquivo.");
    }
  }

  async function handleBindOrganizationUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganizationId) return;

    setSavingOrgUser(true);
    setError("");
    setSuccess("");

    try {
      await fetch(`/api/admin/organizations/${selectedOrganizationId}/users`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          userId: Number(orgUserForm.userId),
          accessLevel: orgUserForm.accessLevel,
        }),
      }).then(readJson);

      setSuccess("Usuário vinculado à organização com sucesso.");
      setOrgUserForm({ userId: "", accessLevel: "viewer" });
      await refreshOrganizationDetails(selectedOrganizationId);
      await refreshOrganizations(selectedOrganizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao vincular usuário.");
    } finally {
      setSavingOrgUser(false);
    }
  }

  async function handleRemoveOrganizationUser(organizationUser: OrganizationUser) {
    const confirmed = window.confirm(
      `Remover o acesso de ${organizationUser.user.email} desta organização?`
    );

    if (!confirmed) return;

    setError("");
    setSuccess("");

    try {
      await fetch(`/api/admin/organization-users/${organizationUser.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson);

      setSuccess("Usuário removido da organização.");
      if (selectedOrganizationId) {
        await refreshOrganizationDetails(selectedOrganizationId);
        await refreshOrganizations(selectedOrganizationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover usuário da organização.");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center">
        <p className="animate-pulse">Carregando gestão de arquivos...</p>
      </main>
    );
  }

  if (!authenticated || !isAdmin) return null;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white">
      <header className="border-b border-white/10 bg-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src={Logo} alt="Maõno" className="h-12 w-auto object-contain" />
            <div>
              <h1 className="text-xl font-semibold">Gestão de Organizações e Arquivos</h1>
              <p className="text-sm text-white/60">Pastas Dropbox, arquivos e acessos por organização</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10" to="/admin">
              Painel Admin
            </Link>
            <Link className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10" to="/projects">
              Meus Projetos
            </Link>
            <button onClick={handleLogout} className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10">
              Sair
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">
        {error && <div className="mb-6 rounded-xl border border-red-300/40 bg-red-500/15 px-4 py-3 text-sm text-red-100">{error}</div>}
        {success && <div className="mb-6 rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100">{success}</div>}

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{editingOrgId ? "Editar Organização" : "Nova Organização"}</h2>
                <p className="mt-1 text-sm text-white/60">
                  A organização representa uma pasta principal no Dropbox, normalmente um cliente ou uma unidade de projeto.
                </p>
              </div>
              {editingOrgId && (
                <button className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10" type="button" onClick={resetOrgForm}>
                  Cancelar edição
                </button>
              )}
            </div>

            <form onSubmit={handleSaveOrganization} className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm text-white/75">Nome</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400"
                  style={fieldStyle}
                  value={orgForm.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setOrgForm((current) => ({
                      ...current,
                      name,
                      slug: current.slug ? current.slug : slugify(name),
                      dropboxRootPath:
                        current.dropboxRootPath && current.dropboxRootPath !== "/projects/"
                          ? current.dropboxRootPath
                          : normalizeProjectPath(name),
                    }));
                  }}
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm text-white/75">Identificador</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400"
                  style={fieldStyle}
                  value={orgForm.slug}
                  onChange={(event) => {
                    const slug = slugify(event.target.value);
                    setOrgForm((current) => ({
                      ...current,
                      slug,
                      dropboxRootPath:
                        current.dropboxRootPath && current.dropboxRootPath !== "/projects/"
                          ? current.dropboxRootPath
                          : normalizeProjectPath(slug),
                    }));
                  }}
                  required
                />
              </label>

              <label className="block md:col-span-2">
                <span className="text-sm text-white/75">Descrição</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400"
                  style={fieldStyle}
                  value={orgForm.description}
                  onChange={(event) => setOrgForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>

              <label className="block">
                <span className="text-sm text-white/75">Pasta Dropbox</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400"
                  style={fieldStyle}
                  value={orgForm.dropboxRootPath}
                  onChange={(event) => setOrgForm((current) => ({ ...current, dropboxRootPath: event.target.value }))}
                  placeholder="/projects/cliente-a"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm text-white/75">Status</span>
                <select
                  className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400"
                  style={selectStyle}
                  value={orgForm.active ? "active" : "inactive"}
                  onChange={(event) => setOrgForm((current) => ({ ...current, active: event.target.value === "active" }))}
                >
                  <option value="active">Ativa</option>
                  <option value="inactive">Inativa</option>
                </select>
              </label>

              <div className="flex flex-wrap gap-3 md:col-span-2">
                <button className="rounded-xl bg-blue-500 px-5 py-3 font-semibold text-white hover:bg-blue-400 disabled:opacity-60" type="submit" disabled={savingOrganization}>
                  {savingOrganization ? "Salvando..." : editingOrgId ? "Salvar organização" : "Criar organização/pasta"}
                </button>
                {editingOrgId && <button className="rounded-xl border border-white/20 px-5 py-3 font-semibold text-white hover:bg-white/10" type="button" onClick={resetOrgForm}>Limpar</button>}
              </div>
            </form>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold">Organizações cadastradas</h2>
            <p className="mt-1 text-sm text-white/60">Selecione uma organização para gerenciar arquivos e usuários.</p>
            <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-white/60">
                  <tr>
                    <th className="border-b border-white/10 px-4 py-3">Organização</th>
                    <th className="border-b border-white/10 px-4 py-3">Dropbox</th>
                    <th className="border-b border-white/10 px-4 py-3">Resumo</th>
                    <th className="border-b border-white/10 px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.length === 0 ? (
                    <tr><td className="px-4 py-4 text-white/60" colSpan={4}>Nenhuma organização cadastrada.</td></tr>
                  ) : organizations.map((organization) => (
                    <tr key={organization.id} className={selectedOrganizationId === organization.id ? "border-b border-white/5 bg-blue-500/10" : "border-b border-white/5"}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{organization.name}</div>
                        <div className="text-xs text-blue-200">{organization.slug}</div>
                        <div className="text-xs text-white/50">{organization.active ? "Ativa" : "Inativa"}</div>
                      </td>
                      <td className="px-4 py-3 text-white/70">{organization.dropboxRootPath}</td>
                      <td className="px-4 py-3 text-white/70">
                        {organization.fileCount || 0} arquivos · {organization.projectCount || 0} projetos · {organization.userCount || 0} usuários
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button className="rounded-lg border border-emerald-300/30 px-3 py-1 text-emerald-100 hover:bg-emerald-500/20" type="button" onClick={() => setSelectedOrganizationId(organization.id)}>Gerenciar</button>
                          <button className="rounded-lg border border-blue-300/30 px-3 py-1 text-blue-100 hover:bg-blue-500/20" type="button" onClick={() => handleEditOrganization(organization)}>Editar</button>
                          <button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteOrganization(organization, false)}>Desativar</button>
                          <button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteOrganization(organization, true)}>Excluir Dropbox</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Arquivos da organização</h2>
              <p className="mt-1 text-sm text-white/60">
                {selectedOrganization ? `${selectedOrganization.name} · ${selectedOrganization.dropboxRootPath}` : "Selecione uma organização para gerenciar os arquivos."}
              </p>
            </div>
            {selectedOrganizationId && (
              <button className="rounded-xl border border-white/20 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50" type="button" disabled={loadingDetails} onClick={() => refreshOrganizationDetails(selectedOrganizationId)}>
                {loadingDetails ? "Atualizando..." : "Atualizar"}
              </button>
            )}
          </div>

          {selectedOrganizationId ? (
            <>
              <form onSubmit={handleUploadFile} className="mt-5 grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="text-sm text-white/75">Nome de exibição</span>
                  <input className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} value={fileDisplayName} onChange={(event) => setFileDisplayName(event.target.value)} placeholder="Opcional" />
                </label>
                <label className="block">
                  <span className="text-sm text-white/75">Arquivo</span>
                  <input className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={fieldStyle} type="file" onChange={handleFileInput} />
                </label>
                <div className="flex items-end">
                  <button className="w-full rounded-xl bg-blue-500 px-5 py-3 font-semibold text-white hover:bg-blue-400 disabled:opacity-60" type="submit" disabled={savingFile || !fileUpload}>
                    {savingFile ? "Enviando..." : "Enviar para Dropbox"}
                  </button>
                </div>
              </form>

              <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="text-white/60">
                    <tr>
                      <th className="border-b border-white/10 px-4 py-3">Arquivo gerenciado</th>
                      <th className="border-b border-white/10 px-4 py-3">Tipo</th>
                      <th className="border-b border-white/10 px-4 py-3">Tamanho</th>
                      <th className="border-b border-white/10 px-4 py-3">Status</th>
                      <th className="border-b border-white/10 px-4 py-3">Projeto</th>
                      <th className="border-b border-white/10 px-4 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizationFiles.length === 0 ? (
                      <tr><td className="px-4 py-4 text-white/60" colSpan={6}>Nenhum arquivo gerenciado ainda. Envie um arquivo pelo formulário acima.</td></tr>
                    ) : organizationFiles.map((file) => (
                      <tr key={file.id} className="border-b border-white/5">
                        <td className="px-4 py-3">
                          <div className="font-medium">{file.name}</div>
                          <div className="text-xs text-white/50">{file.dropboxPath}</div>
                        </td>
                        <td className="px-4 py-3 text-white/70">{file.fileType}</td>
                        <td className="px-4 py-3 text-white/70">{formatBytes(file.sizeBytes)}</td>
                        <td className="px-4 py-3">{file.active ? "Ativo" : "Inativo"}</td>
                        <td className="px-4 py-3">
                          {file.isProject ? (
                            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100">
                              Já é projeto
                            </span>
                          ) : isJsonKeplerCandidate(file) ? (
                            <button
                              className="rounded-lg border border-emerald-300/30 px-3 py-1 text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50"
                              type="button"
                              disabled={transformingFileId === file.id}
                              onClick={() => handleCreateProjectFromFile(file)}
                            >
                              {transformingFileId === file.id ? "Criando..." : "Transformar em projeto"}
                            </button>
                          ) : (
                            <span className="text-xs text-white/50">Não aplicável</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteFile(file, false)}>Desativar</button>
                            <button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleDeleteFile(file, true)}>Excluir Dropbox</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-black/10 p-4">
                <h3 className="font-semibold">Arquivos encontrados diretamente no Dropbox</h3>
                <p className="mt-1 text-xs text-white/60">Esta lista mostra o conteúdo real da pasta, mesmo quando ainda não foi registrado como arquivo gerenciado.</p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="text-white/60">
                      <tr>
                        <th className="border-b border-white/10 py-3 pr-4">Tipo</th>
                        <th className="border-b border-white/10 py-3 pr-4">Nome</th>
                        <th className="border-b border-white/10 py-3 pr-4">Caminho</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dropboxEntries.length === 0 ? (
                        <tr><td className="py-4 text-white/60" colSpan={3}>Nenhum item encontrado na pasta Dropbox.</td></tr>
                      ) : dropboxEntries.map((entry) => (
                        <tr key={entry.pathDisplay || entry.name} className="border-b border-white/5">
                          <td className="py-3 pr-4">{entry.tag === "folder" ? "Pasta" : "Arquivo"}</td>
                          <td className="py-3 pr-4 font-medium">{entry.name}</td>
                          <td className="py-3 pr-4 text-white/60">{entry.pathDisplay || entry.pathLower || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-white/60">Nenhuma organização selecionada.</p>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Usuários vinculados à organização</h2>
          <p className="mt-1 text-sm text-white/60">Este acesso é por pasta/organização. Ao transformar um JSON em projeto, os usuários da organização são copiados para o projeto.</p>

          {selectedOrganizationId ? (
            <>
              <form onSubmit={handleBindOrganizationUser} className="mt-5 grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="text-sm text-white/75">Usuário</span>
                  <select className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={orgUserForm.userId} onChange={(event) => setOrgUserForm((current) => ({ ...current, userId: event.target.value }))} required>
                    <option value="">Selecione...</option>
                    {activeUsers.map((item) => <option key={item.id} value={item.id}>{item.email} {item.name ? `- ${item.name}` : ""}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm text-white/75">Permissão</span>
                  <select className="mt-1 w-full rounded-xl border border-white/15 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400" style={selectStyle} value={orgUserForm.accessLevel} onChange={(event) => setOrgUserForm((current) => ({ ...current, accessLevel: event.target.value }))}>
                    <option value="viewer">viewer</option>
                    <option value="editor">editor</option>
                    <option value="owner">owner</option>
                  </select>
                </label>
                <div className="flex items-end">
                  <button className="w-full rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white hover:bg-emerald-400 disabled:opacity-60" type="submit" disabled={savingOrgUser}>
                    {savingOrgUser ? "Salvando..." : "Vincular usuário"}
                  </button>
                </div>
              </form>

              <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-white/60">
                    <tr>
                      <th className="border-b border-white/10 px-4 py-3">Usuário</th>
                      <th className="border-b border-white/10 px-4 py-3">Permissão</th>
                      <th className="border-b border-white/10 px-4 py-3">Status</th>
                      <th className="border-b border-white/10 px-4 py-3">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizationUsers.length === 0 ? (
                      <tr><td className="px-4 py-4 text-white/60" colSpan={4}>Nenhum usuário vinculado à organização.</td></tr>
                    ) : organizationUsers.map((organizationUser) => (
                      <tr key={organizationUser.id} className="border-b border-white/5">
                        <td className="px-4 py-3">
                          <div className="font-medium">{organizationUser.user.email}</div>
                          <div className="text-xs text-white/50">{organizationUser.user.name || organizationUser.user.role}</div>
                        </td>
                        <td className="px-4 py-3">{organizationUser.accessLevel}</td>
                        <td className="px-4 py-3">{organizationUser.user.active ? "Ativo" : "Inativo"}</td>
                        <td className="px-4 py-3">
                          <button className="rounded-lg border border-red-300/30 px-3 py-1 text-red-100 hover:bg-red-500/20" type="button" onClick={() => handleRemoveOrganizationUser(organizationUser)}>Remover</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-white/60">Selecione uma organização para vincular usuários.</p>
          )}
        </section>
      </section>
    </main>
  );
};

export default AdminFilesPage;
