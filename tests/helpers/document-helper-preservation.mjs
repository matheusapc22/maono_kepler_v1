import assert from 'node:assert/strict';

// Restore only the three screenshot-marked helper paragraphs before checking
// the independently pinned original source. All other bytes remain guarded.
const approvedRemovals = [
  ['<h2 id="mm-docs-title">Arquivos e Documentos</h2>', 'Organize, armazene e compartilhe os documentos do seu projeto em um só lugar.'],
  ['<h3 id="mm-docs-folders-title">Pastas</h3>', 'Organize seus documentos em pastas para facilitar o acesso e a gestão.'],
  ['<h3 id="mm-docs-filter-title">Buscar e filtrar</h3>', 'Encontre documentos rapidamente usando os filtros abaixo.'],
];

export function restoreApprovedDocumentHelperRemoval(path, source) {
  if (!path.endsWith('/DocumentsSection.tsx')) return source;
  for (const [heading, helper] of approvedRemovals) {
    const boundary = `${heading}</div>`;
    assert.equal(source.split(boundary).length - 1, 1, 'each approved heading has no reserved helper element');
    assert.ok(!source.includes(helper), 'the screenshot-marked helper is absent');
    source = source.replace(boundary, `${heading}<p>${helper}</p></div>`);
  }
  return source;
}
