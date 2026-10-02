import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OrganizationDocumentFolder } from "../../../lib/api";
import { normalizeUserError } from "../../../lib/user-error-catalog";
import { DocumentIcon } from "./DocumentsUi";
import "./DocumentActionDialogs.css";

type DialogProps = {
  title: string;
  icon: "file" | "folder";
  className: string;
  subtitle?: string;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  pendingLabel: string;
  submitDisabled?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
};

/** Native top layer supplies inertness; explicit wrapping keeps Tab in the app. */
function DocumentActionDialog({ title, icon, className, subtitle, busy, error, submitLabel, pendingLabel, submitDisabled, footer, children, onClose, onSubmit }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const section = previousFocus?.closest(".mm-docs");
    dialog?.showModal();
    // Do not use React autoFocus here: WebKit clears the opener before showModal.
    const input = dialog?.querySelector<HTMLInputElement>("input");
    input?.focus({ preventScroll: true });
    if (input?.type === "text") input.select();
    return () => {
      // Layout cleanup closes while connected, releasing WebKit modal inertness.
      dialog?.close();
      window.setTimeout(() => {
        if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected && !dialog?.contains(active)) return;
        const focusTarget = previousFocus?.isConnected && !previousFocus.matches(":disabled") && previousFocus.getClientRects().length
          ? previousFocus
          : section?.isConnected ? section.querySelector<HTMLButtonElement>('.mm-docs-breadcrumb button[aria-current="page"]') : null;
        focusTarget?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);

  return <dialog ref={dialogRef} className={`mm-docs-dialog ${className}`} aria-labelledby={titleId} aria-describedby={subtitle ? descriptionId : undefined} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!busy && event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
    }}>
    <form noValidate onSubmit={event => { event.preventDefault(); if (!busy && !submitDisabled) onSubmit(); }}>
      <header className="mm-docs-dialog-header">
        <div className="mm-docs-dialog-heading"><DocumentIcon name={icon} /><h3 id={titleId}>{title}</h3></div>
        <button type="button" className="mm-docs-dialog-close" aria-label="Fechar" disabled={busy} onClick={onClose}><DocumentIcon name="close" /></button>
      </header>
      {subtitle ? <p id={descriptionId} className="mm-docs-dialog-subtitle">{subtitle}</p> : null}
      <div className="mm-docs-dialog-body">{children}</div>
      {error ? <p id={errorId} className="mm-docs-dialog-error" role="alert">{error}</p> : null}
      <footer className="mm-docs-dialog-footer">
        {footer ? <div className="mm-docs-dialog-destination" aria-live="polite">{footer}</div> : null}
        <div className="mm-docs-dialog-actions"><button type="button" className="mm-docs-button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="mm-docs-button is-primary" disabled={busy || submitDisabled}>{busy ? pendingLabel : submitLabel}</button></div>
      </footer>
    </form>
  </dialog>;
}

function actionError(error: unknown) {
  const presentation = normalizeUserError(error);
  return presentation.supportReference ? `${presentation.message} (${presentation.supportReference})` : presentation.message;
}

function splitName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? { basename: name.slice(0, dot), extension: name.slice(dot) } : { basename: name, extension: "" };
}

export function DocumentNameDialog({ name, onClose, onSubmit }: { name?: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const rename = name !== undefined;
  const original = splitName(name || "");
  const [value, setValue] = useState(original.basename);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const inputId = useId();
  const extensionId = useId();
  async function submit() {
    if (inFlight.current) return;
    const trimmed = value.trim().replace(/\s+/g, " ");
    const complete = trimmed + original.extension;
    // Names reject control characters before any whitespace normalization.
    // eslint-disable-next-line no-control-regex
    const invalidFolder = trimmed === "." || trimmed === ".." || /[\\/\u0000-\u001f\u007f]/.test(value);
    // eslint-disable-next-line no-control-regex
    const invalidFile = /^[.]/.test(trimmed) || /[\\/:*?"<>|#%{}^~[\]`\u0000-\u001f\u007f]/.test(value) || complete.endsWith(".");
    if (!trimmed) { setError(rename ? "Informe um nome para o documento." : "Informe um nome para a pasta."); return; }
    if (rename ? invalidFile : invalidFolder) { setError("O nome contém caracteres inválidos."); return; }
    if (complete.length > (rename ? 160 : 120)) { setError(`O nome excede ${rename ? 160 : 120} caracteres.`); return; }
    if (rename && complete === name) { onClose(); return; }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try { await onSubmit(complete); }
    catch (requestError) { setError(actionError(requestError)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <DocumentActionDialog title={rename ? "Renomear documento" : "Nova pasta"} icon={rename ? "file" : "folder"} className={rename ? "mm-docs-rename-dialog" : "mm-docs-folder-name-dialog"} busy={busy} error={error} submitLabel={rename ? "Renomear" : "Criar pasta"} pendingLabel={rename ? "Renomeando..." : "Criando..."} onClose={onClose} onSubmit={() => void submit()}>
    <label className="mm-docs-dialog-label" htmlFor={inputId}>{rename ? "Nome do documento" : "Nome da pasta"}</label>
    <div className="mm-docs-name-control"><input id={inputId} type="text" value={value} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={rename ? extensionId : undefined} onChange={event => { setValue(event.target.value); setError(null); }} />
      {rename ? <span id={extensionId} className="mm-docs-name-extension" aria-label={`Extensão fixa: ${original.extension || "sem extensão"}`}>{original.extension || "Sem extensão"}</span> : null}
    </div>
  </DocumentActionDialog>;
}

type FolderNode = { id: string; name: string; parentId: string; path: OrganizationDocumentFolder[] };
function accessibleTree(folders: OrganizationDocumentFolder[], organizationId: string): FolderNode[] {
  const owned = folders.filter(folder => String(folder.organizationId) === organizationId);
  const byId = new Map(owned.map(folder => [String(folder.id), folder]));
  return owned.flatMap(folder => {
    const path: OrganizationDocumentFolder[] = [];
    const seen = new Set<string>();
    let current: OrganizationDocumentFolder | undefined = folder;
    while (current) {
      const id = String(current.id);
      if (seen.has(id)) return [];
      seen.add(id);
      path.unshift(current);
      if (current.parentId == null) break;
      current = byId.get(String(current.parentId));
      if (!current) return []; // Never offer an orphan or a cross-organization chain.
    }
    return [{ id: String(folder.id), name: folder.name, parentId: folder.parentId == null ? "root" : String(folder.parentId), path }];
  });
}

function readRecent(key: string | null): string[] {
  if (!key) return [];
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 20) : [];
  } catch { return []; }
}

export function DocumentMoveDialog({ kind, name, itemId, currentParentId, folders, organizationId, userId, onClose, onSubmit }: {
  kind: "file" | "folder";
  name: string;
  itemId: number | string;
  currentParentId: string;
  folders: OrganizationDocumentFolder[];
  organizationId: number | string;
  userId?: number | string | null;
  onClose: () => void;
  onSubmit: (destinationId: string) => Promise<void>;
}) {
  const nodes = useMemo(() => accessibleTree(folders, String(organizationId)), [folders, organizationId]);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const sourceDepth = byId.get(String(itemId))?.path.length || 1;
  const subtreeHeight = Math.max(1, ...nodes.filter(node => node.path.some(folder => String(folder.id) === String(itemId))).map(node => node.path.length - sourceDepth + 1));
  const eligible = nodes.filter(node => kind !== "folder" || (!node.path.some(folder => String(folder.id) === String(itemId)) && node.path.length + subtreeHeight <= 5));
  const eligibleIds = new Set(eligible.map(node => node.id));
  const [tab, setTab] = useState("suggestions");
  const [query, setQuery] = useState("");
  const [browsedId, setBrowsedId] = useState("root");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const recentKey = userId == null ? null : `maono:document-destinations:${encodeURIComponent(String(userId))}:${encodeURIComponent(String(organizationId))}`;
  const [recentIds, setRecentIds] = useState(() => readRecent(recentKey));
  const tabsId = useId();
  const searchId = useId();
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const search = normalize(query.trim());
  const currentPath = (id: string) => id === "root" ? "Raiz" : byId.has(id) ? `Raiz / ${byId.get(id)!.path.map(folder => folder.name).join(" / ")}` : "Pasta indisponível";
  const validDestination = selectedId !== null && selectedId !== currentParentId && (selectedId === "root" || eligibleIds.has(selectedId));
  const sorted = (items: FolderNode[]) => [...items].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  const visible = search ? sorted(eligible.filter(node => normalize(node.name).includes(search)))
    : tab === "recent" ? recentIds.flatMap(id => eligible.find(node => node.id === id) || [])
    : sorted(eligible.filter(node => node.parentId === browsedId));
  // Suggestions use genuine direct children; root is a destination only for nested items.
  const showRoot = browsedId === "root" && currentParentId !== "root" && (!search || normalize("Raiz").includes(search)) && (tab !== "recent" || recentIds.includes("root") || Boolean(search));
  const breadcrumb = byId.get(browsedId)?.path || [];
  function enter(id: string) {
    if (busy) return;
    // Keep keyboard focus in the modal before the selected row unmounts.
    document.getElementById(searchId)?.focus({ preventScroll: true });
    setBrowsedId(id);
    setSelectedId(id);
    setQuery("");
    setTab("all");
    setError(null);
  }
  function changeTab(value: string) {
    setTab(value); setBrowsedId("root"); setSelectedId(null); setQuery(""); setError(null);
  }
  async function submit() {
    if (inFlight.current || !validDestination || selectedId === null) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await onSubmit(selectedId);
      const recent = [selectedId, ...recentIds.filter(id => id !== selectedId)].slice(0, 20);
      setRecentIds(recent);
      if (recentKey) { try { sessionStorage.setItem(recentKey, JSON.stringify(recent)); } catch { /* Optional session history must not block a move. */ } }
    } catch (requestError) { setError(actionError(requestError)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const tabNames = [{ id: "suggestions", label: "Sugestões" }, { id: "recent", label: "Recentes" }, { id: "all", label: "Todas as pastas" }];
  return <DocumentActionDialog title={kind === "file" ? "Mover documento" : "Mover pasta"} icon={kind === "file" ? "file" : "folder"} className="mm-docs-move-dialog" subtitle={`Escolha o destino para “${name}”.`} busy={busy} error={error} submitLabel="Mover" pendingLabel="Movendo..." submitDisabled={!validDestination} onClose={onClose} onSubmit={() => void submit()} footer={<><strong>Destino:</strong> {selectedId === null ? "Selecione uma pasta" : currentPath(selectedId)}</>}>
    <div className="mm-docs-current-location"><strong>Local atual:</strong><span><DocumentIcon name="folder" />{currentPath(currentParentId)}</span></div>
    <div className="mm-docs-destination-tools">
      <div className="mm-docs-destination-tabs" role="tablist" aria-label="Pastas de destino">{tabNames.map((item, index) => <button key={item.id} id={`${tabsId}-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`${tabsId}-panel`} tabIndex={tab === item.id ? 0 : -1} disabled={busy} onClick={() => changeTab(item.id)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
        changeTab(tabNames[next].id);
        document.getElementById(`${tabsId}-${tabNames[next].id}`)?.focus();
      }}>{item.label}</button>)}</div>
      <label className="mm-docs-destination-search" htmlFor={searchId}><DocumentIcon name="search" /><input id={searchId} type="search" aria-label="Buscar pastas" placeholder="Buscar pastas" value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setSelectedId(null); setError(null); }} /></label>
    </div>
    <nav className="mm-docs-destination-breadcrumb" aria-label="Caminho do destino"><button type="button" disabled={busy} aria-current={browsedId === "root" ? "page" : undefined} onClick={() => enter("root")}>Raiz</button>{breadcrumb.map(folder => <span key={String(folder.id)}><DocumentIcon name="chevron" /><button type="button" disabled={busy} aria-current={browsedId === String(folder.id) ? "page" : undefined} onClick={() => enter(String(folder.id))}>{folder.name}</button></span>)}</nav>
    <div id={`${tabsId}-panel`} className="mm-docs-destination-list" role="tabpanel" aria-labelledby={`${tabsId}-${tab}`}>
      {showRoot ? <button type="button" className="mm-docs-destination-row" disabled={busy} onClick={() => enter("root")}><DocumentIcon name="folder" /><span>Raiz</span><DocumentIcon name="chevron" /></button> : null}
      {visible.map(node => <button key={node.id} type="button" className="mm-docs-destination-row" disabled={busy} aria-label={node.name} title={currentPath(node.id)} onClick={() => enter(node.id)}><DocumentIcon name="folder" /><span>{node.name}{search ? <small>{currentPath(node.parentId)}</small> : null}</span><DocumentIcon name="chevron" /></button>)}
      {!showRoot && visible.length === 0 ? <p className="mm-docs-destination-empty">{search ? "Nenhuma pasta encontrada." : tab === "recent" ? "Nenhuma pasta recente disponível." : "Esta pasta não possui subpastas disponíveis."}</p> : null}
    </div>
    {selectedId === currentParentId ? <p className="mm-docs-destination-hint">O item já está nesta pasta. Escolha outro destino.</p> : null}
  </DocumentActionDialog>;
}
