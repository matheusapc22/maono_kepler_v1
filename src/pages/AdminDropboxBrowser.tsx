import React, { useEffect, useMemo, useState } from "react";

type DropboxEntry = {
  tag: "folder" | "file" | string;
  name: string;
  pathLower?: string;
  pathDisplay?: string;
  id?: string;
};

type ProjectValidation = {
  valid: boolean;
  message: string;
  rootPath: string;
  fileName: string;
  checks: {
    fileExists: boolean;
    jsonValid: boolean;
    hasDatasets: boolean;
    hasConfig: boolean;
    hasKeplerStructure: boolean;
    canLoadMap: boolean;
  };
  details: {
    datasetsCount: number;
    configSections: string[];
    errors: string[];
    warnings: string[];
  };
};

type DropboxBrowserProps = {
  currentRootPath: string;
  currentConfigFile: string;
  onSelectFile: (selection: { folderPath: string; fileName: string }) => void;
};

const fieldStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  color: "#0f172a",
  WebkitTextFillColor: "#0f172a",
  caretColor: "#0f172a",
};

function normalizePath(value: string) {
  const path = String(value || "").trim();
  if (!path || path === "/") return "";
  return path.startsWith("/") ? path.replace(/\/+$/g, "") : `/${path.replace(/\/+$/g, "")}`;
}

function parentPath(path: string) {
  const normalized = normalizePath(path);
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "";
}

async function readJson(response: Response) {
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error?.message || "Erro ao acessar o backend.");
  }
  return data;
}

function ValidationRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className={ok ? "text-emerald-100" : "text-red-100"}>
      <span className="mr-2">{ok ? "✅" : "❌"}</span>
      {label}
    </li>
  );
}

const AdminDropboxBrowser: React.FC<DropboxBrowserProps> = ({
  currentRootPath,
  currentConfigFile,
  onSelectFile,
}) => {
  const [path, setPath] = useState(() => normalizePath(currentRootPath || "/projects"));
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ProjectValidation | null>(null);
  const [error, setError] = useState("");

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.tag !== b.tag) return a.tag === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }, [entries]);

  async function loadFolder(nextPath = path) {
    setLoading(true);
    setError("");

    try {
      const normalizedPath = normalizePath(nextPath);
      const url = normalizedPath
        ? `/api/dropbox/list?path=${encodeURIComponent(normalizedPath)}`
        : "/api/dropbox/list";
      const data = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(readJson);

      setPath(normalizedPath);
      setEntries(data.entries || data.entradas || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao listar Dropbox.");
    } finally {
      setLoading(false);
    }
  }

  async function validateProjectFile(rootPath = currentRootPath, fileName = currentConfigFile) {
    const cleanRootPath = normalizePath(rootPath);
    const cleanFileName = String(fileName || "").trim();

    if (!cleanRootPath || !cleanFileName) {
      setValidation(null);
      return;
    }

    setValidating(true);
    setError("");

    try {
      const data = await fetch("/api/dropbox/validate", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          dropboxRootPath: cleanRootPath,
          defaultConfigFile: cleanFileName,
        }),
      }).then(readJson);

      setValidation(data.validation || null);
    } catch (err) {
      setValidation(null);
      setError(err instanceof Error ? err.message : "Erro ao validar arquivo Dropbox.");
    } finally {
      setValidating(false);
    }
  }

  useEffect(() => {
    loadFolder(normalizePath(currentRootPath || "/projects"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    validateProjectFile(currentRootPath, currentConfigFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRootPath, currentConfigFile]);

  function handleOpenFolder(entry: DropboxEntry) {
    const nextPath = entry.pathDisplay || entry.pathLower || `${path}/${entry.name}`;
    loadFolder(nextPath);
  }

  function handleSelectFile(entry: DropboxEntry) {
    const folderPath = path || "/";
    onSelectFile({
      folderPath,
      fileName: entry.name,
    });
    validateProjectFile(folderPath, entry.name);
  }

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="font-semibold">Selecionar arquivo no Dropbox</h3>
          <p className="mt-1 text-xs text-white/60">
            Navegue pela pasta do app Dropbox e selecione o JSON principal do projeto.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            type="button"
            disabled={loading || !path}
            onClick={() => loadFolder(parentPath(path))}
          >
            Subir pasta
          </button>
          <button
            className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            type="button"
            disabled={loading}
            onClick={() => loadFolder(path)}
          >
            Atualizar
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 md:flex-row">
        <input
          className="w-full rounded-xl border border-white/15 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-400"
          style={fieldStyle}
          value={path || "/"}
          onChange={(event) => setPath(normalizePath(event.target.value))}
          placeholder="/projects"
        />
        <button
          className="rounded-xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-60"
          type="button"
          disabled={loading}
          onClick={() => loadFolder(path)}
        >
          Abrir caminho
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
        Seleção atual: <strong>{currentRootPath || "—"}</strong> / <strong>{currentConfigFile || "—"}</strong>
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h4 className="text-sm font-semibold">Validação do projeto</h4>
            <p className="mt-1 text-xs text-white/60">
              O sistema testa se o arquivo existe, se é JSON válido e se possui estrutura compatível com Kepler.
            </p>
          </div>
          <button
            className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            type="button"
            disabled={validating || !currentRootPath || !currentConfigFile}
            onClick={() => validateProjectFile(currentRootPath, currentConfigFile)}
          >
            {validating ? "Validando..." : "Validar agora"}
          </button>
        </div>

        {validation ? (
          <div
            className={
              validation.valid
                ? "mt-3 rounded-xl border border-emerald-300/40 bg-emerald-500/15 p-3"
                : "mt-3 rounded-xl border border-red-300/40 bg-red-500/15 p-3"
            }
          >
            <p className={validation.valid ? "text-sm font-semibold text-emerald-100" : "text-sm font-semibold text-red-100"}>
              {validation.valid ? "✅" : "❌"} {validation.message}
            </p>

            <ul className="mt-3 grid gap-1 text-xs md:grid-cols-2">
              <ValidationRow label="Arquivo existe no Dropbox" ok={validation.checks.fileExists} />
              <ValidationRow label="JSON válido" ok={validation.checks.jsonValid} />
              <ValidationRow label="Possui datasets" ok={validation.checks.hasDatasets} />
              <ValidationRow label="Possui config" ok={validation.checks.hasConfig} />
              <ValidationRow label="Estrutura compatível com Kepler" ok={validation.checks.hasKeplerStructure} />
              <ValidationRow label="Pode ser carregado pelo mapa" ok={validation.checks.canLoadMap} />
            </ul>

            <div className="mt-3 text-xs text-white/70">
              Datasets: <strong>{validation.details.datasetsCount}</strong>
              {validation.details.configSections.length > 0 && (
                <span> · Seções config: <strong>{validation.details.configSections.join(", ")}</strong></span>
              )}
            </div>

            {validation.details.errors.length > 0 && (
              <div className="mt-3 text-xs text-red-100">
                <strong>Erros:</strong>
                <ul className="mt-1 list-disc pl-5">
                  {validation.details.errors.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {validation.details.warnings.length > 0 && (
              <div className="mt-3 text-xs text-yellow-100">
                <strong>Avisos:</strong>
                <ul className="mt-1 list-disc pl-5">
                  {validation.details.warnings.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-white/60">
            Selecione um arquivo ou clique em validar para conferir o projeto antes de salvar.
          </p>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-red-300/40 bg-red-500/15 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-white/10">
        {loading ? (
          <div className="p-4 text-sm text-white/70">Carregando Dropbox...</div>
        ) : sortedEntries.length === 0 ? (
          <div className="p-4 text-sm text-white/70">Nenhum item encontrado nesta pasta.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-white/60">
              <tr>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Ação</th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <tr key={entry.id || entry.pathDisplay || entry.name} className="border-t border-white/10">
                  <td className="px-4 py-3 text-white/70">
                    {entry.tag === "folder" ? "Pasta" : "Arquivo"}
                  </td>
                  <td className="px-4 py-3 font-medium">{entry.name}</td>
                  <td className="px-4 py-3">
                    {entry.tag === "folder" ? (
                      <button
                        className="rounded-lg border border-blue-300/30 px-3 py-1 text-blue-100 hover:bg-blue-500/20"
                        type="button"
                        onClick={() => handleOpenFolder(entry)}
                      >
                        Abrir
                      </button>
                    ) : (
                      <button
                        className="rounded-lg border border-emerald-300/30 px-3 py-1 text-emerald-100 hover:bg-emerald-500/20"
                        type="button"
                        onClick={() => handleSelectFile(entry)}
                      >
                        Usar este arquivo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};

export default AdminDropboxBrowser;
