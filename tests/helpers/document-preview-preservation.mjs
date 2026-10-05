import assert from "node:assert/strict";
const changes = [
  {
    "before": "",
    "after": "import DocumentPreviewDialog from \"./DocumentPreviewDialog\";\n"
  },
  {
    "before": "",
    "after": "  const [previewFile, setPreviewFile] = useState<OrganizationFile | null>(null);\n"
  },
  {
    "before": "",
    "after": "    setPreviewFile(null);\n"
  },
  {
    "before": "  async function handleDownload(file: OrganizationFile) {\n",
    "after": "  async function handleDownload(file: OrganizationFile, reportFailure = false) {\n"
  },
  {
    "before": "",
    "after": "      if (reportFailure) throw requestError;\n"
  },
  {
    "before": "",
    "after": "      {previewFile && canDownload && documentState === \"active\" ? <DocumentPreviewDialog key={`${organizationId}:${previewFile.id}`} file={previewFile} organizationId={organizationId} canDownload={canDownload} downloadBusy={transferBusy} onDownload={file => handleDownload(file, true)} onClose={() => setPreviewFile(null)} /> : null}\n"
  },
  {
    "before": "",
    "after": "        onPreview={file => { if (canDownload && !accessDeniedRef.current) setPreviewFile(file); }}\n"
  },
  {
    "before": "",
    "after": "  onPreview: (file: OrganizationFile) => void;\n"
  },
  {
    "before": "function DocumentFileIdentity({ file, folderOrigin }: { file: OrganizationFile; folderOrigin?: string }) {\n",
    "after": "function DocumentFileIdentity({ file, folderOrigin, onPreview }: { file: OrganizationFile; folderOrigin?: string; onPreview?: () => void }) {\n"
  },
  {
    "before": "  return <div className=\"mm-docs-file-identity\"><span className={`mm-docs-file-icon is-${visual.tone}`} aria-hidden=\"true\"><span>{visual.mark}</span></span><span className=\"mm-docs-file-copy\"><span className=\"documents-file-name\" title={file.name}>{file.name}</span>{file.projectName ? <span className=\"documents-file-project\">{file.projectName}</span> : null}{folderOrigin ? <span className=\"documents-file-origin\" title={folderOrigin}><DocumentIcon name=\"folder\" />Pasta: {folderOrigin}</span> : null}</span></div>;\n",
    "after": "  return <div className=\"mm-docs-file-identity\"><span className={`mm-docs-file-icon is-${visual.tone}`} aria-hidden=\"true\"><span>{visual.mark}</span></span><span className=\"mm-docs-file-copy\">{onPreview ? <button type=\"button\" className=\"documents-file-name mm-docs-preview-trigger\" title={file.name} aria-label={`Abrir prévia de ${file.name}`} onClick={event => { event.currentTarget.focus({ preventScroll: true }); onPreview(); }}>{file.name}</button> : <span className=\"documents-file-name\" title={file.name}>{file.name}</span>}{file.projectName ? <span className=\"documents-file-project\">{file.projectName}</span> : null}{folderOrigin ? <span className=\"documents-file-origin\" title={folderOrigin}><DocumentIcon name=\"folder\" />Pasta: {folderOrigin}</span> : null}</span></div>;\n"
  },
  {
    "before": "          return <tr key={file.id}><td><DocumentFileIdentity file={file} folderOrigin={props.folderOrigin?.(file)} /></td><td title={file.mimeType || undefined}><span className=\"mm-docs-type-badge\">{file.fileType ? fileTypeLabel(file.fileType) : file.mimeType || \"—\"}</span></td><td>{formatBytes(file.size)}</td><td>{formatDate(file.updatedAt || file.createdAt)}</td><td><ActiveDocumentActions {...props} file={file} busy={busy} /></td></tr>;\n",
    "after": "          return <tr key={file.id}><td><DocumentFileIdentity file={file} folderOrigin={props.folderOrigin?.(file)} onPreview={props.canDownload && !busy && !props.transferBusy ? () => props.onPreview(file) : undefined} /></td><td title={file.mimeType || undefined}><span className=\"mm-docs-type-badge\">{file.fileType ? fileTypeLabel(file.fileType) : file.mimeType || \"—\"}</span></td><td>{formatBytes(file.size)}</td><td>{formatDate(file.updatedAt || file.createdAt)}</td><td><ActiveDocumentActions {...props} file={file} busy={busy} /></td></tr>;\n"
  },
  {
    "before": "        return <article className=\"mm-docs-file-card\" role=\"listitem\" key={file.id}><DocumentFileIdentity file={file} folderOrigin={props.folderOrigin?.(file)} /><div className=\"mm-docs-file-card-meta\"><span><small>Tipo</small><strong>{file.fileType ? fileTypeLabel(file.fileType) : file.mimeType || \"—\"}</strong></span><span><small>Tamanho</small><strong>{formatBytes(file.size)}</strong></span><span><small>Atualizado em</small><strong>{formatDate(file.updatedAt || file.createdAt)}</strong></span></div><ActiveDocumentActions {...props} file={file} busy={busy} /></article>;\n",
    "after": "        return <article className=\"mm-docs-file-card\" role=\"listitem\" key={file.id}><DocumentFileIdentity file={file} folderOrigin={props.folderOrigin?.(file)} onPreview={props.canDownload && !busy && !props.transferBusy ? () => props.onPreview(file) : undefined} /><div className=\"mm-docs-file-card-meta\"><span><small>Tipo</small><strong>{file.fileType ? fileTypeLabel(file.fileType) : file.mimeType || \"—\"}</strong></span><span><small>Tamanho</small><strong>{formatBytes(file.size)}</strong></span><span><small>Atualizado em</small><strong>{formatDate(file.updatedAt || file.createdAt)}</strong></span></div><ActiveDocumentActions {...props} file={file} busy={busy} /></article>;\n"
  }
];
export function restoreDocumentPreview(source) {
 for (const { before, after } of changes) {
  assert.equal(source.split(after).length - 1, 1, "exact document preview integration change");
  source = source.replace(after, before);
 }
 return source;
}
