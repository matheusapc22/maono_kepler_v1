# Plano da PR única — Redesign dos cards de projetos

## Branch

`feat/redesign-cards-projetos`

## Base

`mano_kepler_v1`

## Título sugerido

`feat(projects): redesenha cards e grade de projetos`

## Arquivos esperados

- `src/pages/Projects.tsx`
- `src/pages/Projects/projects.css`
- `src/pages/Projects/components/project-cards.css`
- `src/pages/Projects/components/project-card-utils.ts`
- `src/pages/Projects/components/ProjectCard.tsx`
- `src/pages/Projects/components/ProjectsSection.tsx`
- `src/components/loading/Skeleton.tsx`
- `src/components/loading/Skeleton.css`
- `tests/project-card-redesign.test.mjs`
- `tests/project-thumbnail-gate.test.mjs`
- `docs/redesign-cards-projetos-checklist.md`
- `docs/redesign-cards-projetos-evidencias.md`
- `package.json`

## Não deve entrar

- playground local;
- fixtures locais;
- seed/reset local;
- `.dev.vars`;
- `.wrangler`;
- bancos SQLite;
- capturas temporárias;
- credenciais, cookies ou tokens.

## Auditoria antes do push

```bat
git status --short
git diff --name-only origin/mano_kepler_v1...HEAD
git diff origin/mano_kepler_v1...HEAD
git ls-files | findstr /i "playground fixture seed-local reset-local .dev.vars .wrangler sqlite"
git grep -n "maono.test"
git grep -n "__dev"
npm run lint
npm run build
npm run test:project-cards
```

## Estratégia de liberação

1. validar localmente;
2. criar PR;
3. usar deploy de preview/homologação da branch;
4. executar smoke test;
5. aprovar merge;
6. monitorar produção;
7. reverter a PR em caso de regressão.

Não é recomendado usar produção como primeiro ambiente de teste.
