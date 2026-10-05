import assert from 'node:assert/strict';

// Only the approved Todos os Projetos header delta is reversed here. These
// hashes were recorded from the pre-header commit, not from normalized output.
export const projectHeaderBaselineCommit = '8d7d6b435cba1bfd95c6a3c7b9c758ed24372458';
export const projectHeaderBaselines = {
  'src/pages/Projects/components/ProjectPagesUi.tsx': '920853928a6007163d9c5175487790abc5f2b9664f8ec8bff0f4308595a9b8f1',
  'src/pages/Projects/components/ProjectPages.css': '4e0f25bf1f58e6b645dbda9e5947ce13f0f5c0c9cb5a8daf4260563ea9d6bcec',
  'src/pages/Projects/components/project-page-query.ts': '494883bd8c7ac5d766a62c31d6d48bc44271e76c35a425ab203b89d8087e8b2d',
};

const changes = {
  'src/pages/Projects/components/ProjectPagesUi.tsx': [{
    before: 'type IconName = "idea" | "clock" | "star" | "search" | "filter" | "plus" | "next" | "previous";',
    after: 'type IconName = "idea" | "map-pinned" | "clock" | "star" | "search" | "filter" | "plus" | "next" | "previous";',
  }, {
    before: '',
    after: '  "map-pinned": "m9 5-6 2v15l6-3 6 3 6-3v-7M9 5v14m0-14 2 1m4 9v7M21 6c0 3-4 7-4 7s-4-4-4-7a4 4 0 0 1 8 0ZM18 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",\n',
  }, {
    before: '      <div className="mm-project-pages__heading">\n' +
      '        <ProjectPageIcon name={copy.icon} />\n' +
      '        <div><h1><StaticLoadingText pending={structurePending}>{copy.title}</StaticLoadingText></h1><p><StaticLoadingText pending={structurePending}>{copy.description}</StaticLoadingText></p></div>\n',
    after: '      <div className={`mm-project-pages__heading${section === "all" ? " mm-project-pages__heading--all" : ""}`}>\n' +
      '        <ProjectPageIcon name={section === "all" ? "map-pinned" : copy.icon} />\n' +
      '        <div><h1><StaticLoadingText pending={structurePending}>{copy.title}</StaticLoadingText></h1>{copy.description ? <p><StaticLoadingText pending={structurePending}>{copy.description}</StaticLoadingText></p> : null}</div>\n',
  }],
  'src/pages/Projects/components/ProjectPages.css': [{
    before: '',
    after: '.mm-project-pages .mm-project-pages__heading.mm-project-pages__heading--all { align-items: center; gap: 14px; }\n' +
      '.mm-project-pages .mm-project-pages__heading.mm-project-pages__heading--all > .mm-project-pages__icon { width: 42px; height: 42px; }\n' +
      '.mm-project-pages .mm-project-pages__heading--all > div, .mm-project-pages .mm-project-pages__heading--all h1 { min-width: 0; }\n',
  }],
  'src/pages/Projects/components/project-page-query.ts': [{
    before: '  all: { title: "Todos os Projetos", description: "Visualize e gerencie todos os seus projetos.", icon: "idea", empty: "Nenhum projeto encontrado." },',
    after: '  all: { title: "Todos os Projetos", description: null, icon: "idea", empty: "Nenhum projeto encontrado." },',
  }],
};

export function restoreApprovedProjectsHeader(path, source) {
  for (const { before, after } of changes[path] ?? []) {
    assert.equal(source.split(after).length - 1, 1, `exact approved project-header edit: ${path}`);
    source = source.replace(after, before);
  }
  return source;
}
