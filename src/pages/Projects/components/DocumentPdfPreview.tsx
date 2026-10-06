import { useEffect, useId, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { MAX_IMAGE_PIXELS, type PreviewErrorReason } from "../../../lib/document-preview";

import { readPreviewText } from "../../../lib/document-preview-text";

GlobalWorkerOptions.workerSrc = workerUrl;
const ASSETS = "/assets/pdfjs-6.4.299/";

/** A canvas-only renderer: no PDF scripts, forms, links, attachments or HTML. */
export default function DocumentPdfPreview({ blob, zoom, onError }: { blob: Blob; zoom: number; onError: (reason: PreviewErrorReason) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [rendering, setRendering] = useState(true);
  const [pageText, setPageText] = useState("");
  const [textUnavailable, setTextUnavailable] = useState(false);
  const textId = useId();
  const [width, setWidth] = useState(640);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(160, host.clientWidth - 32)));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    const timeout = window.setTimeout(() => {
      if (!active) return;
      active = false;
      void task?.destroy();
      errorRef.current("pdf-timeout");
    }, 30_000);
    void blob.arrayBuffer().then(data => {
      if (!active) return;
      task = getDocument({ data: new Uint8Array(data), enableXfa: false, maxImageSize: MAX_IMAGE_PIXELS, canvasMaxAreaInBytes: 16_000_000,
        cMapUrl: `${ASSETS}cmaps/`, standardFontDataUrl: `${ASSETS}standard_fonts/`, wasmUrl: `${ASSETS}wasm/`, iccUrl: `${ASSETS}iccs/`,
        disableAutoFetch: true, disableRange: true, disableStream: true, stopAtErrors: true, verbosity: 0 });
      return task.promise.then(document => { if (active) { window.clearTimeout(timeout); setPdf(document); } });
    }).catch(error => {
      if (!active) return;
      window.clearTimeout(timeout);
      errorRef.current(error?.name === "PasswordException" ? "pdf-password" : "pdf-open");
    });
    return () => { active = false; window.clearTimeout(timeout); void task?.destroy(); };
  }, [blob]);
  useEffect(() => {
    if (!pdf) return;
    let active = true;
    let render: RenderTask | undefined;
    let page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | undefined;
    setRendering(true);
    setPageText("");
    setTextUnavailable(false);
    const textController = new AbortController();
    const canvas = canvasRef.current;
    // Never leave pixels from a previous page visible while a new one loads.
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    const timeout = window.setTimeout(() => {
      if (!active) return;
      active = false;
      render?.cancel();
      errorRef.current("pdf-page-timeout");
    }, 30_000);
    void pdf.getPage(pageNumber).then(async nextPage => {
      page = nextPage;
      if (!active || !canvas) { nextPage.cleanup(); return; }
      const natural = page.getViewport({ scale: 1 });
      if (!Number.isFinite(natural.width) || !Number.isFinite(natural.height) || natural.width <= 0 || natural.height <= 0) throw new Error("Invalid page");
      const displayScale = Math.min(width / natural.width, 1.5) * zoom;
      const display = page.getViewport({ scale: displayScale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / display.width, 4096 / display.height, Math.sqrt(4_000_000 / (display.width * display.height)));
      const viewport = page.getViewport({ scale: displayScale * ratio });
      canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${display.width}px`; canvas.style.height = `${display.height}px`;
      render = page.render({ canvas, viewport, annotationMode: 0 });
      await render.promise;
      if (!active) return;
      window.clearTimeout(timeout);
      setRendering(false);
      // Text is optional. A stream/decoder failure must not discard valid pixels.
      const textTimeout = window.setTimeout(() => textController.abort(), 10_000);
      try {
        const text = await readPreviewText(page.streamTextContent(), textController.signal);
        if (active) setPageText(text);
      } catch {
        if (active) setTextUnavailable(true);
      } finally { window.clearTimeout(textTimeout); }
    }).catch(error => {
      if (!active || error?.name === "RenderingCancelledException") return;
      window.clearTimeout(timeout);
      errorRef.current("pdf-page");
    });
    return () => { active = false; textController.abort(); window.clearTimeout(timeout); render?.cancel(); if (render) void render.promise.catch(() => {}).then(() => page?.cleanup()); else page?.cleanup(); if (canvas) { canvas.width = 0; canvas.height = 0; } };
  }, [pdf, pageNumber, width, zoom]);
  return <div className="mm-preview-pdf" ref={hostRef}>
    <div className="mm-preview-pages" role="group" aria-label="Navegação do PDF">
      <button type="button" disabled={!pdf || pageNumber <= 1} onClick={() => setPageNumber(value => value - 1)} aria-label="Página anterior">Anterior</button>
      <span aria-live="polite">{pdf ? `Página ${pageNumber} de ${pdf.numPages}` : "Abrindo PDF..."}</span>
      <button type="button" disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => setPageNumber(value => value + 1)} aria-label="Próxima página">Próxima</button>
    </div>
    {rendering ? <p className="mm-preview-rendering" role="status">Preparando página...</p> : null}
    <div className="mm-preview-canvas-scroll" tabIndex={0} role="region" aria-label="Página do PDF, use as setas para rolar"><canvas ref={canvasRef} role="img" aria-label={`Página ${pageNumber} do documento PDF.`} aria-describedby={pageText || textUnavailable ? textId : undefined} /></div>
    {/* Keep the page readable to assistive technology without a visible text panel. */}
    {pageText || textUnavailable ? <p id={textId} className="mm-preview-sr-only">{pageText || "O texto desta página não está disponível. Você pode baixar o original."}</p> : null}
  </div>;
}
