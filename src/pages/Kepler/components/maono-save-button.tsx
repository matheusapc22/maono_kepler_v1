import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useParams } from "react-router";
import { KeplerGlSchema } from "@kepler.gl/schemas";
import { useSession } from "../../../auth/session";

function normalize(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function canSaveProject(userRole?: string, accessLevel?: string) {
  if (normalize(userRole) === "admin") return true;
  return normalize(accessLevel) === "editor";
}

function getFallbackDatasets(mapState: any) {
  const datasets = mapState?.visState?.datasets;

  if (!datasets || typeof datasets !== "object") {
    return [];
  }

  return Object.entries(datasets).map(([id, dataset]: [string, any]) => ({
    version: "v1",
    data: dataset?.data || dataset,
    info: {
      id,
      label: dataset?.label || dataset?.data?.label || id,
    },
  }));
}

function normalizeSavedKeplerConfig(rawSaved: any, mapState: any) {
  const saved = rawSaved && typeof rawSaved === "object" ? rawSaved : {};

  const config =
    saved.config && typeof saved.config === "object"
      ? saved.config
      : {
          visState: saved.visState || mapState?.visState || {},
          mapState: saved.mapState || mapState?.mapState || {},
          mapStyle: saved.mapStyle || mapState?.mapStyle || {},
        };

  const datasets = Array.isArray(saved.datasets)
    ? saved.datasets
    : getFallbackDatasets(mapState);

  return {
    ...saved,
    version: saved.version || "v1",
    datasets,
    config,
  };
}

const MaonoSaveButton: React.FC = () => {
  const { projectSlug } = useParams();
  const { authenticated, user, projects } = useSession();
  const mapState = useSelector((state: any) => state?.demo?.keplerGl?.map);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const projectAccessLevel = useMemo(() => {
    const currentProject = projects.find(
      (project) => normalize(project.slug) === normalize(projectSlug)
    );
    return currentProject?.accessLevel;
  }, [projects, projectSlug]);

  const allowed = Boolean(
    authenticated && projectSlug && canSaveProject(user?.role, projectAccessLevel)
  );

  async function handleSave() {
    if (!projectSlug || !mapState) return;

    setSaving(true);
    setMessage("");

    try {
      const rawSaved = KeplerGlSchema.save(mapState);
      const config = normalizeSavedKeplerConfig(rawSaved, mapState);

      const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/config`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ config }),
      });

      const data = await response.json();

      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error?.message || "Não foi possível salvar o projeto.");
      }

      setMessageType("success");
      setMessage("Projeto salvo no Dropbox com sucesso.");
    } catch (error) {
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : "Erro ao salvar projeto.");
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[99998] flex flex-col items-end gap-3">
      {message && (
        <div
          className={
            messageType === "success"
              ? "max-w-md rounded-2xl border border-emerald-300/50 bg-emerald-800/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl"
              : "max-w-md rounded-2xl border border-red-300/50 bg-red-900/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl"
          }
        >
          {message}
        </div>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !mapState}
        className="rounded-2xl border border-emerald-300/50 bg-emerald-600 px-5 py-4 text-sm font-extrabold text-white shadow-2xl transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        title="Salvar alterações no arquivo JSON original do projeto no Dropbox"
      >
        {saving ? "Salvando..." : "Salvar na Maõno"}
      </button>
    </div>
  );
};

export default MaonoSaveButton;
