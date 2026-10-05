import { Component, type ReactNode, lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { OrganizationFile } from "../../../lib/api";
import { DocumentPreviewError, loadDocumentPreview, type PreviewContent, type PreviewProgress } from "../../../lib/document-preview";
import { isRegionAccessDenied } from "../../../components/loading/region-loading-policy";
import { DocumentIcon } from "./DocumentsUi";
import "./DocumentPreviewDialog.css";
const PdfPreview = lazy(() => import("./DocumentPdfPreview"));
class PreviewBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}
type Props = { file: OrganizationFile; organizationId: number | string; canDownload: boolean; downloadBusy: boolean; onDownload: (file: OrganizationFile) => Promise<void>; onClose: () => void };
function ImagePreview({ content, name, zoom, onError }: { content: PreviewContent; name: string; zoom: number; onError: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { const value = URL.createObjectURL(content.blob); setUrl(value); return () => URL.revokeObjectURL(value); }, [content]);
  return <div className="mm-preview-image-scroll" tabIndex={0} role="region" aria-label="Imagem, use as setas para rolar">{url ? <img src={url} alt={name} onError={onError} style={{ width: `${zoom * 100}%`, maxWidth: `${(content.width || 1200) * zoom}px` }} /> : null}</div>;
}
export default function DocumentPreviewDialog({ file, organizationId, canDownload, downloadBusy, onDownload, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId(); const descriptionId = useId();
  const [content, setContent] = useState<PreviewContent | null>(null);
  const [progress, setProgress] = useState<PreviewProgress>({ loaded: 0, total: null });
  const [error, setError] = useState<DocumentPreviewError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const denied = error?.code === "access" || error?.code === "unavailable";
  useLayoutEffect(() => {
    mountedRef.current = true;
    const dialog = dialogRef.current;
    const opener = document.activeElement as HTMLElement | null;
    const section = opener?.closest(".mm-docs");
    dialog?.showModal(); closeRef.current?.focus({ preventScroll: true });
    return () => {
      mountedRef.current = false;
      dialog?.close();
      window.setTimeout(() => {
        if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected && !dialog?.contains(active)) return;
        const fallback = section?.querySelector<HTMLButtonElement>('.mm-docs-breadcrumb button[aria-current="page"]');
        (opener?.isConnected && !opener.matches(":disabled") && opener.getClientRects().length ? opener : fallback)?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    requestRef.current = controller;
    setContent(null); setError(null); setProgress({ loaded: 0, total: null }); setZoom(1);
    if (!canDownload) { setError(new DocumentPreviewError("access", "Você não tem permissão para abrir este documento.")); return () => controller.abort(); }
    void loadDocumentPreview(organizationId, file, controller.signal, value => { if (active) setProgress(value); }).then(value => {
      if (active && !controller.signal.aborted) setContent(value);
    }).catch(reason => { if (active && !controller.signal.aborted) setError(reason instanceof DocumentPreviewError ? reason : new DocumentPreviewError("network", "Não foi possível carregar a prévia.")); });
    return () => { active = false; controller.abort(); if (requestRef.current === controller) requestRef.current = null; };
  }, [organizationId, file, canDownload, attempt]);
  async function download() {
    setDownloadError(null);
    try { await onDownload(file); }
    catch (reason) {
      if (!mountedRef.current) return;
      const status = Number((reason as { status?: number })?.status);
      if (isRegionAccessDenied(reason) || status === 404 || status === 410) {
        requestRef.current?.abort();
        setContent(null);
        setError(status === 404 || status === 410 ? new DocumentPreviewError("unavailable", "Este documento não está mais disponível.") : new DocumentPreviewError("access", "Seu acesso a este documento não está disponível. Feche a prévia e atualize a página."));
      } else setDownloadError("Não foi possível baixar o original. Tente novamente.");
    }
  }
  function renderError(message: string) { setContent(null); setError(new DocumentPreviewError("invalid", message)); }
  return <dialog ref={dialogRef} className="mm-preview-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]')).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = stops[0]; const last = stops.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
    }}>
    <header className="mm-preview-header"><div className="mm-preview-title"><DocumentIcon name="file" /><div><span>Prévia do documento</span><h2 id={titleId} title={file.name}>{file.name}</h2></div></div><button ref={closeRef} type="button" aria-label="Fechar prévia" onClick={onClose}><DocumentIcon name="close" /></button></header>
    <div className="mm-preview-toolbar"><p id={descriptionId}>PDF e imagens • leitura segura</p><div className="mm-preview-controls" role="group" aria-label="Controles da prévia">
      <button type="button" aria-label="Diminuir zoom" disabled={!content || zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}>−</button><button type="button" aria-label="Ajustar à largura" disabled={!content} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button type="button" aria-label="Aumentar zoom" disabled={!content || zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}>+</button>
      {canDownload ? <button type="button" className="mm-preview-download" disabled={downloadBusy || denied || (!content && !error)} onClick={() => void download()}><DocumentIcon name="download" />{downloadBusy ? "Baixando..." : "Baixar original"}</button> : null}
    </div></div>
    {downloadError ? <p className="mm-preview-download-error" role="alert">{downloadError}</p> : null}
    <div className="mm-preview-body" aria-busy={!content && !error}>
      {error ? <div className="mm-preview-state" role="alert"><DocumentIcon name="file" /><h3>{error.code === "unsupported" ? "Prévia indisponível para este formato" : error.code === "too-large" ? "Arquivo grande para a prévia" : "Não foi possível abrir a prévia"}</h3><p>{error.message}</p>{error.code === "network" ? <button type="button" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</button> : null}</div> : !content ? <div className="mm-preview-state" role="status"><span className="mm-preview-spinner" aria-hidden="true" /><h3>Carregando documento...</h3><progress aria-label="Carregamento do documento" max={progress.total || undefined} value={progress.total ? progress.loaded : undefined} /><p>{progress.loaded ? `${(progress.loaded / 1024 / 1024).toFixed(1)} MB recebidos${progress.total ? ` de ${(progress.total / 1024 / 1024).toFixed(1)} MB` : ""}` : "Preparando arquivo. Você pode fechar a qualquer momento."}</p></div> : content.kind === "image" ? <ImagePreview content={content} name={file.name} zoom={zoom} onError={() => renderError("Não foi possível decodificar esta imagem. Baixe o original para abri-la.")} /> : <PreviewBoundary onError={() => renderError("O leitor de PDF não carregou. Feche e abra a prévia novamente ou baixe o original.")}><Suspense fallback={<div className="mm-preview-state" role="status">Abrindo leitor de PDF...</div>}><PdfPreview blob={content.blob} zoom={zoom} onError={renderError} /></Suspense></PreviewBoundary>}
    </div>
    <footer className="mm-preview-footer"><span>Arquivo original preservado</span><span>Esc para fechar</span></footer>
  </dialog>;
}
