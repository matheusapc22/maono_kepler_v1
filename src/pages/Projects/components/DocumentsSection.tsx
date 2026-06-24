import { useEffect, useMemo, useRef, useState } from "react";

import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import {
  deleteOrganizationFile,
  downloadOrganizationFile,
  listOrganizationFiles,
  uploadOrganizationFile,
  type OrganizationFile,
} from "../../../lib/api";

type DocumentsSectionProps = {
  user?: AccessControlUser | null;
  organizationId?: number | string | null;
};

function formatBytes(size?: number) {
  if (!size || size <= 0) {
    return "—";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

export default function DocumentsSection({
  user,
  organizationId,
}: DocumentsSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<OrganizationFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const permissionContext = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      organization: organizationId ? { id: organizationId } : undefined,
    }),
    [organizationId],
  );

  const canView = can(user, PERMISSION.DOCUMENT_VIEW, permissionContext);
  const canUpload = can(user, PERMISSION.DOCUMENT_UPLOAD, permissionContext);
  const canDownload = can(user, PERMISSION.DOCUMENT_DOWNLOAD, permissionContext);
  const canDelete = can(user, PERMISSION.DOCUMENT_DELETE, permissionContext);

  async function loadFiles() {
    if (!organizationId || !canView) {
      setFiles([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await listOrganizationFiles(organizationId);
      setFiles(response.files ?? []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar os documentos.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canView]);

  async function handleUpload(file: File) {
    if (!organizationId || !canUpload) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    setError(null);

    try {
      await uploadOrganizationFile(organizationId, formData);
      await loadFiles();

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível enviar o documento.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(file: OrganizationFile) {
    if (!organizationId || !canDownload) {
      return;
    }

    setError(null);

    try {
      const response = await downloadOrganizationFile(organizationId, file.id);
      downloadBlob(response.blob, response.fileName || file.name || "documento");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível baixar o documento.",
      );
    }
  }

  async function handleDelete(file: OrganizationFile) {
    if (!organizationId || !canDelete) {
      return;
    }

    const confirmed = window.confirm(
      `Excluir o documento "${file.name}"? Essa ação não pode ser desfeita.`,
    );

    if (!confirmed) {
      return;
    }

    setError(null);

    try {
      await deleteOrganizationFile(organizationId, file.id);
      await loadFiles();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível excluir o documento.",
      );
    }
  }

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Arquivos e Documentos</h2>
        <p>Selecione uma organização para consultar documentos.</p>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Arquivos e Documentos</h2>
        <p>Você não tem permissão para visualizar documentos desta organização.</p>
      </section>
    );
  }

  return (
    <section className="mm-card mm-section-card">
      <div className="projects-section-header">
        <div>
          <h2>Arquivos e Documentos</h2>
          <p>
            Documentos vinculados à organização. Caminhos internos de
            armazenamento não são exibidos nesta tela.
          </p>
        </div>

        {canUpload ? (
          <label className="mm-button secondary">
            {uploading ? "Enviando..." : "Enviar documento"}
            <input
              ref={fileInputRef}
              type="file"
              disabled={uploading}
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file) {
                  void handleUpload(file);
                }
              }}
            />
          </label>
        ) : null}
      </div>

      {error ? <p className="mm-error-text">{error}</p> : null}

      {loading ? (
        <p>Carregando documentos...</p>
      ) : files.length === 0 ? (
        <div className="projects-empty-state">
          Nenhum documento encontrado para esta organização.
        </div>
      ) : (
        <div className="mm-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Tamanho</th>
                <th>Atualizado em</th>
                <th>Ações</th>
              </tr>
            </thead>

            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td>{file.name}</td>
                  <td>{file.mimeType || "—"}</td>
                  <td>{formatBytes(file.size)}</td>
                  <td>{formatDate(file.updatedAt || file.createdAt)}</td>
                  <td>
                    <div className="projects-row-actions">
                      {canDownload ? (
                        <button
                          type="button"
                          className="mm-button ghost"
                          onClick={() => void handleDownload(file)}
                        >
                          Baixar
                        </button>
                      ) : null}

                      {canDelete ? (
                        <button
                          type="button"
                          className="mm-button danger"
                          onClick={() => void handleDelete(file)}
                        >
                          Excluir
                        </button>
                      ) : null}

                      {!canDownload && !canDelete ? "—" : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}