import React, {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type ProjectCreationStage =
  | "ready"
  | "capturing"
  | "creating_record"
  | "preparing_files"
  | "linking_user"
  | "finalizing"
  | "success"
  | "error";

type ProjectCreateInput = {
  name: string;
  description: string;
};

type ProjectCreatePanelProps = {
  open: boolean;
  organizationName: string;
  initialName?: string;
  initialDescription?: string;
  busy: boolean;
  stage: ProjectCreationStage;
  failedStage?: Exclude<
    ProjectCreationStage,
    "ready" | "success" | "error"
  > | null;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: ProjectCreateInput) => void | Promise<void>;
};

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const STEPS = [
  {
    id: "creating_record",
    label: "Criando registro",
  },
  {
    id: "preparing_files",
    label: "Preparando arquivos",
  },
  {
    id: "linking_user",
    label: "Vinculando usuário",
  },
  {
    id: "finalizing",
    label: "Finalizando",
  },
] as const;

function effectiveStage(
  stage: ProjectCreationStage,
  failedStage: ProjectCreatePanelProps["failedStage"],
) {
  return stage === "error" ? failedStage || "creating_record" : stage;
}

const ProjectCreatePanel: React.FC<ProjectCreatePanelProps> = ({
  open,
  organizationName,
  initialName = "",
  initialDescription = "",
  busy,
  stage,
  failedStage = null,
  error = null,
  onClose,
  onSubmit,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] =
    useState<string | null>(null);

  const normalizedName = name.trim().replace(/\s+/g, " ");
  const normalizedDescription = description.trim();
  const activeStage = effectiveStage(stage, failedStage);
  const activeIndex = useMemo(
    () => STEPS.findIndex((step) => step.id === activeStage),
    [activeStage],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const frame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      returnFocusRef.current?.focus();
    }

    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription);
      setValidationError(null);
    }
  }, [initialDescription, initialName, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function requestClose() {
    if (busy) {
      return;
    }

    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );

    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (
      event.shiftKey &&
      document.activeElement === first
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === last
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (busy) {
      return;
    }

    if (normalizedName.length < 3) {
      setValidationError(
        "O título deve ter pelo menos 3 caracteres.",
      );
      titleInputRef.current?.focus();
      return;
    }

    if (normalizedName.length > 120) {
      setValidationError(
        "O título deve ter no máximo 120 caracteres.",
      );
      titleInputRef.current?.focus();
      return;
    }

    if (normalizedDescription.length > 1000) {
      setValidationError(
        "A descrição deve ter no máximo 1.000 caracteres.",
      );
      return;
    }

    setValidationError(null);
    void onSubmit({
      name: normalizedName,
      description: normalizedDescription,
    });
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[12000] flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/15 bg-slate-950 text-white shadow-2xl sm:max-h-[92dvh] sm:rounded-3xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-300">
              Novo projeto
            </p>
            <h2
              id={titleId}
              className="text-xl font-black sm:text-2xl"
            >
              Salvar mapa na Maõno
            </h2>
            <p
              id={descriptionId}
              className="mt-2 text-sm leading-6 text-slate-300"
            >
              O slug será gerado pelo servidor. O projeto só aparecerá na
              lista depois que arquivos, vínculo e ativação forem concluídos.
            </p>
          </div>

          <button
            type="button"
            aria-label="Fechar criação do projeto"
            disabled={busy}
            onClick={requestClose}
            className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/20 bg-slate-900 text-xl font-bold transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="mb-5 rounded-2xl border border-emerald-300/20 bg-emerald-950/35 px-4 py-3">
            <span className="block text-xs font-bold uppercase tracking-wider text-emerald-300">
              Organização ativa
            </span>
            <strong className="mt-1 block break-words text-sm text-white">
              {organizationName || "Organização ativa"}
            </strong>
          </div>

          <form
            id="maono-project-create-form"
            onSubmit={handleSubmit}
            className="grid gap-5"
            noValidate
          >
            <label className="grid gap-2 text-sm font-bold text-slate-100">
              Título
              <input
                ref={titleInputRef}
                name="name"
                type="text"
                required
                minLength={3}
                maxLength={120}
                value={name}
                disabled={busy || stage === "error"}
                onChange={(event) => {
                  setName(event.target.value);
                  setValidationError(null);
                }}
                className="min-h-12 w-full rounded-xl border border-white/20 bg-slate-900 px-4 py-3 text-base text-white outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/30 disabled:cursor-wait disabled:opacity-65"
              />
              <span className="justify-self-end text-xs font-medium text-slate-400">
                {name.length}/120
              </span>
            </label>

            <label className="grid gap-2 text-sm font-bold text-slate-100">
              Descrição
              <textarea
                name="description"
                rows={6}
                maxLength={1000}
                value={description}
                disabled={busy || stage === "error"}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setValidationError(null);
                }}
                className="min-h-36 w-full resize-y rounded-xl border border-white/20 bg-slate-900 px-4 py-3 text-base leading-6 text-white outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/30 disabled:cursor-wait disabled:opacity-65"
              />
              <span className="justify-self-end text-xs font-medium text-slate-400">
                {description.length}/1.000
              </span>
            </label>

            {validationError || error ? (
              <div
                role="alert"
                className="rounded-xl border border-red-300/40 bg-red-950/60 px-4 py-3 text-sm font-semibold text-red-100"
              >
                {validationError || error}
              </div>
            ) : null}
          </form>

          {stage !== "ready" ? (
            <section
              aria-label="Progresso da criação"
              className="mt-6 rounded-2xl border border-white/10 bg-slate-900/70 p-4"
            >
              <h3 className="text-sm font-black text-white">
                Progresso
              </h3>

              {stage === "capturing" ? (
                <p
                  role="status"
                  className="mt-3 text-sm font-semibold text-emerald-200"
                >
                  Preparando configuração e visualização do mapa…
                </p>
              ) : null}

              <ol className="mt-4 grid gap-3">
                {STEPS.map((step, index) => {
                  const completed =
                    stage === "success" ||
                    (stage !== "error" &&
                      activeIndex >= 0 &&
                      index < activeIndex);
                  const active =
                    stage !== "success" &&
                    index === activeIndex;
                  const failed =
                    stage === "error" &&
                    index === activeIndex;

                  return (
                    <li
                      key={step.id}
                      className="flex items-center gap-3 text-sm"
                    >
                      <span
                        aria-hidden="true"
                        className={[
                          "grid h-7 w-7 flex-none place-items-center rounded-full border text-xs font-black",
                          completed
                            ? "border-emerald-300 bg-emerald-500 text-slate-950"
                            : failed
                              ? "border-red-300 bg-red-900 text-red-100"
                              : active
                                ? "border-emerald-300 bg-emerald-950 text-emerald-200"
                                : "border-white/20 bg-slate-950 text-slate-400",
                        ].join(" ")}
                      >
                        {completed ? "✓" : failed ? "!" : index + 1}
                      </span>
                      <span
                        className={
                          completed || active
                            ? "font-bold text-white"
                            : failed
                              ? "font-bold text-red-100"
                              : "text-slate-400"
                        }
                      >
                        {step.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
          <button
            type="button"
            disabled={busy}
            onClick={requestClose}
            className="min-h-12 rounded-xl border border-white/20 bg-slate-900 px-5 py-3 text-sm font-extrabold text-white transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            type="submit"
            form="maono-project-create-form"
            disabled={busy}
            className="min-h-12 rounded-xl border border-emerald-300/50 bg-emerald-600 px-5 py-3 text-sm font-extrabold text-white shadow-xl transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
          >
            {busy
              ? "Criando projeto…"
              : stage === "error"
                ? "Tentar novamente"
                : "Criar e salvar projeto"}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default ProjectCreatePanel;
export type { ProjectCreateInput, ProjectCreatePanelProps };
