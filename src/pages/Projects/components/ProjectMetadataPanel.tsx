import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  fetchProjectMetadata,
  ProjectMetadataApiError,
  updateProjectMetadata,
  type ProjectListItem,
  type ProjectMetadata,
} from "../projects-api";
import "./project-metadata-panel.css";

type ProjectMetadataPanelProps = {
  project: ProjectListItem | null;
  open: boolean;
  onClose: () => void;
  onUpdated: (project: ProjectListItem) => void;
};

type PanelState =
  | "closed"
  | "loading"
  | "ready"
  | "saving"
  | "success"
  | "conflict"
  | "error";

type FormState = {
  name: string;
  description: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
};

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function formatMetadataDate(value?: string) {
  if (!value) {
    return "Não informado";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Não informado";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formFromMetadata(metadata: ProjectMetadata): FormState {
  return {
    name: metadata.name || "",
    description: metadata.description || "",
  };
}

function normalizeForm(form: FormState): FormState {
  return {
    name: form.name.trim().replace(/\s+/g, " "),
    description: form.description.trim(),
  };
}

function sameForm(left: FormState, right: FormState) {
  return (
    left.name === right.name &&
    left.description === right.description
  );
}

function metadataActorName(
  actor: ProjectMetadata["createdBy"] | ProjectMetadata["updatedBy"],
  fallback: string,
) {
  return actor?.name?.trim() || fallback;
}

const ProjectMetadataPanel: React.FC<ProjectMetadataPanelProps> = ({
  project,
  open,
  onClose,
  onUpdated,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const successTimerRef = useRef<number | null>(null);
  const wasOpenRef = useRef(false);

  const [status, setStatus] = useState<PanelState>("closed");
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null);
  const [conflictProject, setConflictProject] =
    useState<ProjectMetadata | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = useMemo(
    () => !sameForm(normalizeForm(form), normalizeForm(initialForm)),
    [form, initialForm],
  );

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const applyMetadata = useCallback((nextMetadata: ProjectMetadata) => {
    const nextForm = formFromMetadata(nextMetadata);

    setMetadata(nextMetadata);
    setConflictProject(null);
    setForm(nextForm);
    setInitialForm(nextForm);
    setNotice(null);
    setStatus("ready");
  }, []);

  const loadMetadata = useCallback(async () => {
    if (!open || !project?.slug) {
      return;
    }

    requestSequenceRef.current += 1;
    const requestId = requestSequenceRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

    setStatus("loading");
    setNotice(null);
    setConflictProject(null);

    try {
      const nextMetadata = await fetchProjectMetadata(project.slug, {
        signal: controller.signal,
      });

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      applyMetadata(nextMetadata);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      setStatus("error");
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar as informações do projeto.",
      );
    } finally {
      if (requestId === requestSequenceRef.current) {
        requestControllerRef.current = null;
      }
    }
  }, [applyMetadata, open, project?.slug]);

  const requestClose = useCallback(() => {
    if (status === "saving") {
      return;
    }

    if (
      dirty &&
      typeof window !== "undefined" &&
      !window.confirm("Descartar as alterações não salvas?")
    ) {
      return;
    }

    clearSuccessTimer();
    onClose();
  }, [clearSuccessTimer, dirty, onClose, status]);

  useEffect(() => {
    if (!open) {
      requestSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      clearSuccessTimer();
      setStatus("closed");
      setMetadata(null);
      setConflictProject(null);
      setForm(EMPTY_FORM);
      setInitialForm(EMPTY_FORM);
      setNotice(null);
      return;
    }

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    void loadMetadata();
  }, [clearSuccessTimer, loadMetadata, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (status === "ready") {
        nameInputRef.current?.focus();
      } else {
        closeButtonRef.current?.focus();
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, status]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const previous = returnFocusRef.current;

      if (previous?.isConnected) {
        previous.focus();
      } else if (project?.name) {
        const fallback = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            'button[aria-haspopup="menu"]',
          ),
        ).find(
          (button) =>
            button.getAttribute("aria-label") ===
            `Mais ações do projeto ${project.name}`,
        );

        fallback?.focus();
      }
    }

    wasOpenRef.current = open;
  }, [open, project?.name]);

  useEffect(
    () => () => {
      requestSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      clearSuccessTimer();
    },
    [clearSuccessTimer],
  );

  function handleDialogKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const drawer = drawerRef.current;

    if (!drawer) {
      return;
    }

    const focusable = Array.from(
      drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true",
    );

    if (focusable.length === 0) {
      event.preventDefault();
      drawer.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!metadata || status === "saving") {
      return;
    }

    const normalized = normalizeForm(form);

    if (normalized.name.length < 3) {
      setStatus("error");
      setNotice("O título deve ter pelo menos 3 caracteres.");
      nameInputRef.current?.focus();
      return;
    }

    if (normalized.name.length > 120) {
      setStatus("error");
      setNotice("O título deve ter no máximo 120 caracteres.");
      nameInputRef.current?.focus();
      return;
    }

    if (normalized.description.length > 1000) {
      setStatus("error");
      setNotice("A descrição deve ter no máximo 1.000 caracteres.");
      return;
    }

    if (sameForm(normalized, normalizeForm(initialForm))) {
      onClose();
      return;
    }

    clearSuccessTimer();
    setStatus("saving");
    setNotice(null);
    setConflictProject(null);

    try {
      const updated = await updateProjectMetadata(metadata.slug, {
        name: normalized.name,
        description: normalized.description,
        metadataVersion: metadata.metadataVersion,
      });

      const updatedForm = formFromMetadata(updated);

      setMetadata(updated);
      setForm(updatedForm);
      setInitialForm(updatedForm);
      setStatus("success");
      setNotice("Informações atualizadas com sucesso.");
      onUpdated(updated);

      successTimerRef.current = window.setTimeout(() => {
        successTimerRef.current = null;
        onClose();
      }, 700);
    } catch (error) {
      if (
        error instanceof ProjectMetadataApiError &&
        error.status === 409
      ) {
        setConflictProject(error.currentProject);
        setStatus("conflict");
        setNotice(error.message);
        return;
      }

      setStatus("error");
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar as informações do projeto.",
      );
    }
  }

  function loadConflictVersion() {
    if (conflictProject) {
      applyMetadata(conflictProject);
      return;
    }

    void loadMetadata();
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  const organizationName =
    metadata?.organization?.name || "Não informada";
  const creatorName = metadataActorName(
    metadata?.createdBy,
    "Criador não identificado",
  );
  const updaterName = metadataActorName(
    metadata?.updatedBy,
    "Último editor não identificado",
  );

  return createPortal(
    <div
      className="mm-project-metadata-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <section
        ref={drawerRef}
        className="mm-project-metadata-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={status === "loading" || status === "saving"}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="mm-project-metadata-panel__header">
          <div>
            <p className="mm-project-metadata-panel__eyebrow">
              Informações do projeto
            </p>
            <h2 id={titleId}>Editar projeto</h2>
            <p id={descriptionId}>
              Altere somente o título e a descrição. Identificação, autoria e
              organização permanecem protegidas.
            </p>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            className="mm-project-metadata-panel__close"
            aria-label="Fechar edição do projeto"
            disabled={status === "saving"}
            onClick={requestClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="mm-project-metadata-panel__body">
          {status === "loading" ? (
            <div
              className="mm-project-metadata-panel__loading"
              role="status"
              aria-live="polite"
            >
              <span className="mm-project-metadata-panel__spinner" />
              <strong>Carregando informações atualizadas…</strong>
              <p>Os dados são consultados novamente antes da edição.</p>
            </div>
          ) : null}

          {notice ? (
            <div
              className={`mm-project-metadata-notice is-${status}`}
              role={
                status === "error" || status === "conflict"
                  ? "alert"
                  : "status"
              }
              aria-live="polite"
            >
              <p>{notice}</p>

              {status === "conflict" ? (
                <button
                  type="button"
                  className="mm-project-metadata-notice__action"
                  onClick={loadConflictVersion}
                >
                  Carregar versão atual
                </button>
              ) : null}

              {status === "error" && !metadata ? (
                <button
                  type="button"
                  className="mm-project-metadata-notice__action"
                  onClick={() => void loadMetadata()}
                >
                  Tentar novamente
                </button>
              ) : null}
            </div>
          ) : null}

          {metadata ? (
            <form
              className="mm-project-metadata-form"
              onSubmit={handleSubmit}
              noValidate
            >
              <section
                className="mm-project-metadata-form__section"
                aria-labelledby={`${titleId}-editable`}
              >
                <div className="mm-project-metadata-form__section-heading">
                  <div>
                    <h3 id={`${titleId}-editable`}>Informações editáveis</h3>
                    <p>Esses dados aparecem no card e nas listagens.</p>
                  </div>
                </div>

                <label className="mm-project-metadata-field">
                  <span>Título</span>
                  <input
                    ref={nameInputRef}
                    name="name"
                    type="text"
                    minLength={3}
                    maxLength={120}
                    required
                    value={form.name}
                    disabled={status === "saving" || status === "success"}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }));

                      if (status === "error") {
                        setStatus("ready");
                        setNotice(null);
                      }
                    }}
                  />
                  <small>{form.name.length}/120 caracteres</small>
                </label>

                <label className="mm-project-metadata-field">
                  <span>Descrição</span>
                  <textarea
                    name="description"
                    rows={6}
                    maxLength={1000}
                    value={form.description}
                    disabled={status === "saving" || status === "success"}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }));

                      if (status === "error") {
                        setStatus("ready");
                        setNotice(null);
                      }
                    }}
                  />
                  <small>{form.description.length}/1.000 caracteres</small>
                </label>
              </section>

              <section
                className="mm-project-metadata-form__section"
                aria-labelledby={`${titleId}-protected`}
              >
                <div className="mm-project-metadata-form__section-heading">
                  <div>
                    <h3 id={`${titleId}-protected`}>
                      Identificação e histórico
                    </h3>
                    <p>Campos somente leitura, mantidos pelo sistema.</p>
                  </div>
                  <span className="mm-project-metadata-readonly-badge">
                    Somente leitura
                  </span>
                </div>

                <dl className="mm-project-metadata-history">
                  <div>
                    <dt>Slug</dt>
                    <dd title={metadata.slug}>{metadata.slug}</dd>
                  </div>
                  <div>
                    <dt>Organização</dt>
                    <dd>{organizationName}</dd>
                  </div>
                  <div>
                    <dt>Criado por</dt>
                    <dd>{creatorName}</dd>
                  </div>
                  <div>
                    <dt>Criado em</dt>
                    <dd>{formatMetadataDate(metadata.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Última alteração por</dt>
                    <dd>{updaterName}</dd>
                  </div>
                  <div>
                    <dt>Última alteração em</dt>
                    <dd>{formatMetadataDate(metadata.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Versão dos metadados</dt>
                    <dd>{metadata.metadataVersion}</dd>
                  </div>
                </dl>
              </section>

              <footer className="mm-project-metadata-panel__footer">
                <div
                  className="mm-project-metadata-panel__dirty-status"
                  aria-live="polite"
                >
                  {dirty
                    ? "Alterações não salvas"
                    : "Nenhuma alteração pendente"}
                </div>

                <div className="mm-project-metadata-panel__footer-actions">
                  <button
                    type="button"
                    className="mm-project-metadata-button is-secondary"
                    disabled={status === "saving"}
                    onClick={requestClose}
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="mm-project-metadata-button is-primary"
                    disabled={
                      status === "saving" ||
                      status === "success" ||
                      status === "conflict"
                    }
                  >
                    {status === "saving"
                      ? "Salvando…"
                      : status === "success"
                        ? "Salvo"
                        : "Salvar alterações"}
                  </button>
                </div>
              </footer>
            </form>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
};

export default ProjectMetadataPanel;
export type { PanelState, ProjectMetadataPanelProps };
