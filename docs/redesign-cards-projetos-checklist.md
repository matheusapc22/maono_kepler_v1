# Redesign dos cards de projetos — Checklist de QA

## Validação automatizada

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test:project-cards`

## Breakpoints

- [ ] 320 px: uma coluna e sem rolagem horizontal.
- [ ] 768 px: duas colunas.
- [ ] 1280 px: três colunas.
- [ ] 1920 px: três colunas.
- [ ] Zoom de 200% sem corte horizontal.

## Estados funcionais

- [ ] Todos os Projetos.
- [ ] Recentes.
- [ ] Favoritos.
- [ ] Lista vazia.
- [ ] Busca sem resultado.
- [ ] Falha da API com botão “Tentar novamente”.
- [ ] Thumbnail carregada.
- [ ] Thumbnail quebrada com “Prévia indisponível”.
- [ ] Skeleton inicial.
- [ ] Shimmer sincronizado das thumbnails.
- [ ] Favoritar.
- [ ] Desfavoritar.
- [ ] Favorito em processamento.
- [ ] CTA “Abrir projeto”.
- [ ] CTA “Abrindo...” após acionamento.

## Perfis e permissões

- [ ] Super admin: Proprietário + Pode salvar.
- [ ] Owner: Proprietário + Pode salvar.
- [ ] Editor com permissão: Pode salvar, sem Proprietário.
- [ ] Viewer: Somente leitura.
- [ ] Usuário conectado não aparece como autor.

## Acessibilidade

- [ ] Favorito com `aria-pressed`.
- [ ] Favorito acionável por Enter e Espaço.
- [ ] CTA acionável por Enter.
- [ ] Focus visible verde e contrastante.
- [ ] Texto de status de carregamento anunciado.
- [ ] Fallback perceptível por leitor de tela.
- [ ] `alt` da thumbnail contém o nome do projeto.
- [ ] Reduced motion sem elevação, transições ou shimmer animado.

## Regressão

- [ ] Clicar no corpo do card não navega.
- [ ] Clicar no favorito não navega.
- [ ] Apenas o CTA abre `/projects/:slug/map`.
- [ ] Troca de organização atualiza a lista.
- [ ] Sidebar não recebe shimmer.
- [ ] Nenhuma migration criada.
- [ ] Nenhuma estrutura local de testes incluída na PR.
