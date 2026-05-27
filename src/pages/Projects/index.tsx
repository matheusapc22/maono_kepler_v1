// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./projects.css";
import { getCloudProvider } from "../Kepler/cloud-providers";

type DropboxProject = {
  id?: string;
  name?: string;
  title?: string;
  updatedAt?: number;
  thumbnail?: string;
  loadParams?: {
    id?: string;
    path?: string;
  };
};

function formatUpdatedAt(updatedAt?: number) {
  if (!updatedAt) return "Sem data de atualização";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(updatedAt));
}

function getProjectPath(project: DropboxProject) {
  return project?.loadParams?.path || "";
}

function getProjectSlug(project: DropboxProject) {
  const title = project.title || project.name || "projeto";
  return title
    .replace(/\.json$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ProjectsPage = () => {
  const provider = useMemo(() => getCloudProvider("dropbox"), []);
  const [projects, setProjects] = useState<DropboxProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = provider.getAccessToken?.();

      if (!token) {
        setIsConnected(false);
        setProjects([]);
        setUserName(null);
        return;
      }

      setIsConnected(true);
      const storedUser = provider.getUserName?.();
      setUserName(storedUser?.name || storedUser?.email || null);

      const maps = await provider.listMaps();
      setProjects(Array.isArray(maps) ? maps : []);
    } catch (err: any) {
      setError(err?.message || "Não foi possível carregar os projetos do Dropbox.");
    } finally {
      setIsLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleConnectDropbox = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await provider.login();
      await loadProjects();
    } catch (err: any) {
      setError(err?.message || "Não foi possível conectar ao Dropbox.");
      setIsLoading(false);
    }
  };

  const openProject = (project: DropboxProject) => {
    const path = getProjectPath(project);
    if (!path) {
      setError("Este projeto não possui caminho de arquivo no Dropbox.");
      return;
    }

    window.location.href = `/map/dropbox?path=${encodeURIComponent(path)}`;
  };

  return (
    <main className="projects-page">
      <section className="projects-shell">
        <header className="projects-header">
          <div>
            <p className="eyebrow">Maõno Maps</p>
            <h1>Projetos</h1>
            <p className="subtitle">
              Visualize os mapas salvos no Dropbox com a miniatura real do último salvamento.
            </p>
          </div>

          <div className="projects-actions">
            {userName && <span className="user-chip">{userName}</span>}
            <button className="btn" type="button" onClick={loadProjects}>
              Atualizar
            </button>
            {!isConnected && (
              <button className="btn btn-primary" type="button" onClick={handleConnectDropbox}>
                Conectar Dropbox
              </button>
            )}
          </div>
        </header>

        {error && <div className="notice notice-error">{error}</div>}

        {!isConnected && !isLoading && (
          <section className="empty-state">
            <h2>Dropbox não conectado</h2>
            <p>
              Conecte o Dropbox para listar os arquivos JSON do App Folder e substituir o preview SVG pela imagem PNG gerada no último salvamento do mapa.
            </p>
            <button className="btn btn-primary" type="button" onClick={handleConnectDropbox}>
              Conectar agora
            </button>
          </section>
        )}

        {isLoading && <div className="notice">Carregando projetos e miniaturas do Dropbox...</div>}

        {isConnected && !isLoading && projects.length === 0 && (
          <section className="empty-state">
            <h2>Nenhum projeto encontrado</h2>
            <p>
              Salve um mapa no Kepler usando o provider Dropbox. O arquivo <code>.json</code> será listado aqui e o <code>.png</code> correspondente será usado como preview real do card.
            </p>
          </section>
        )}

        {projects.length > 0 && (
          <section className="project-grid" aria-label="Projetos do Dropbox">
            {projects.map((project) => {
              const title = project.title || project.name?.replace(/\.json$/i, "") || "Projeto sem nome";
              const hasRealThumbnail = Boolean(project.thumbnail);
              const slug = getProjectSlug(project);

              return (
                <article className="project-card" key={project.id || getProjectPath(project) || title}>
                  <button
                    className="project-thumb-button"
                    type="button"
                    onClick={() => openProject(project)}
                    aria-label={`Abrir mapa ${title}`}
                  >
                    <div
                      className={hasRealThumbnail ? "project-thumb has-real-thumbnail" : "project-thumb uses-svg-fallback"}
                      style={hasRealThumbnail ? { backgroundImage: `url(${project.thumbnail})` } : undefined}
                    />
                  </button>

                  <div className="project-body">
                    <h2>{title}</h2>

                    <div className="project-tags">
                      <span className={hasRealThumbnail ? "tag tag-success" : "tag tag-fallback"}>
                        {hasRealThumbnail ? "Preview real" : "Fallback SVG"}
                      </span>
                      <span className="tag">Dropbox</span>
                    </div>

                    <p>
                      {hasRealThumbnail
                        ? "Imagem PNG recuperada do Dropbox, vinculada ao JSON salvo do projeto."
                        : "Sem PNG correspondente. Usando motor SVG cartográfico temporário."}
                    </p>

                    <div className="project-meta">
                      <span>{formatUpdatedAt(project.updatedAt)}</span>
                      <span>{slug}</span>
                    </div>

                    <div className="card-actions">
                      <button className="btn btn-primary" type="button" onClick={() => openProject(project)}>
                        Abrir mapa
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </section>
    </main>
  );
};

export default ProjectsPage;
