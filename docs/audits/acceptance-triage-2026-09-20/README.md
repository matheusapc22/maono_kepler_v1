# OB-04 e OB-05 — aceite e triagem após o merge

## Base e limites

- Produto: `mano_kepler_v1`, SHA inicial `b49dbb6620e86e268ff6119e76317d3272509ec7`.
- PR #185 integrada em 2026-09-20 às 17:32:06 UTC. Merge não comprova implantação em Production.
- Controle: [planilha de trabalhos obrigatórios](https://docs.google.com/spreadsheets/d/1U3vCQ-4u0pZYIEgtBHEBoDf1JAlb2ZBZVpZf8SzdLj8/edit), OB-04/05 e R17/18.
- Preservar `docs/operations/production-db-preview-testing.md`, `docs/ops/product-reliability-prh08-acceptance.md` e as restrições do solicitante: nenhuma migration remota, operador ativado, mudança em Production, habilitação de mutações Preview ou reativação de Change Requests.

## Plano de execução

1. Fixar o SHA pós-merge, reproduzir a suíte ampliada antes de editar testes e guardar a saída original.
2. OB-04: verificar URL, versão, acesso e escopo operacional. Executar o smoke existente somente em leitura; preparar os casos abaixo. Exigir sessões legítimas e autorização específica de ambiente antes dos casos mutantes.
3. OB-05: classificar cada falha por evidência e histórico. Seguir os componentes atuais; preservar cada intenção útil dos testes antigos. Exercitar contratos de permissões, catálogo e clustering diretamente quando viável.
4. Manter gates existentes; incluir os testes recuperados no gate que já protege a área. Rodar a suíte ampliada, Foundation, build e mutações seletivas que demonstrem poder de detecção.
5. Publicar PR revisável separando testes de documentação/evidências. Atualizar o controle distinguindo código/testes concluídos de aceite operacional pendente.

## OB-04 — matriz operacional

Os identificadores A/B são papéis no roteiro, não organizações criadas ou sessões provisionadas. Não reutilizar o contexto de Super Admin para demonstrar isolamento de usuário comum.

| Caso | Pré-condição e execução | Critério/evidência | Estado inicial |
| --- | --- | --- | --- |
| A01 | GET de saúde pelo `scripts/preview/smoke-preview.mjs`, URL imutável publicada pelo bot da PR #185 | HTTP 200, runtime Preview e D1 alcançável; registrar SHA do comentário separadamente da versão implantada | Executado em leitura |
| A02 | Sessão legítima A; listar projetos e ler config-stream Golden pelo mesmo smoke | HTTP 200, transporte stream e bytes; identidade pseudonimizada e organização ativa conferidas | Pendente de sessão |
| A03 | Editor A, ambiente e janela com mutações expressamente autorizados; criar mapa pequeno pela UI real | Projeto ACTIVE, revisão consistente, quota e arquivo na raiz autorizada; hash/tamanho/revisão sem dados do mapa no relatório | Pendente de ambiente e sessão |
| A04 | Editar e salvar A, reabrir e baixar; comparar conteúdo lógico e hash Dropbox | Revisão avança uma vez; configuração fiel; D1 e Dropbox concordam | Pendente de A03 |
| A05 | Duas abas A com a mesma revisão inicial; salvar em sequência concorrente controlada | Um vencedor; conflito explícito no perdedor, sem sobrescrever versão vencedora | Pendente de A03 |
| A06 | Usuário B sem vínculo com A; tentar listar, abrir slug/config e baixar arquivo de A | Projeto/arquivo oculto e acesso negado; nenhum conteúdo revelado. 401 anônimo não equivale a este aceite | Pendente de segunda organização/sessão |
| A07 | Viewer A e usuário A/B com organização ativa alternada | Viewer não salva; organização ativa isola projetos; GeoJSON só com concessão explícita no escopo correto | Pendente de sessões/perfis |
| A08 | Falha controlada de provedor ou RECYCLE apenas em ambiente de teste autorizado | Estado preservado; retomada/reconciliação conforme runbook OB-02, sem adoção/exclusão de órfão por inferência | Pendente de janela; não acionar operador |

### Preflight observado

O comentário do bot em [PR #185](https://github.com/matheusapc22/maono_kepler_v1/pull/185#issuecomment-5751402808) aponta `https://1a44738f.maono-kepler-v1.pages.dev` e head `7c10209`. O smoke existente passou health/runtime/D1 e pulou explicitamente a parte autenticada por ausência de `MAONO_PREVIEW_SESSION_COOKIE`. A observação não prova que o merge `b49dbb6` esteja implantado, nem comprova Dropbox ou isolamento remoto.

Não há sessão Preview/QA configurada no ambiente de execução. Não foram fabricadas sessões. O aceite remoto continua pendente. Para retomar: disponibilizar sessões legítimas por canal seguro, selecionar duas organizações e os perfis, identificar implantação/bindings e autorizar nominalmente o ambiente/janela/ações mutantes; até lá, preservar as proibições existentes.

## OB-05 — reprodução inicial

Comando: `node --experimental-strip-types --test tests/*.test.mjs scripts/audit-user-error-sinks.test.mjs`.

Base: **1.222 testes, 1.213 aprovados, 9 falhas**, sem alterações. Três falhas são módulos que nem chegam a executar seus casos por imports antigos; a contagem final aumentará quando esses casos forem recuperados.

## Achados reproduzidos e hipótese causal

Todos os itens abaixo são defeitos confirmados **dos testes antigos**. Nenhum deles, isoladamente, confirma falha funcional ou vulnerabilidade em produção. O impacto comum é sinal vermelho persistente na suíte ampliada e perda de detecção quando um arquivo nem carrega.

| ID | Reprodução/evidência na base | Causa confirmada no histórico/código | Cobertura recuperada |
| --- | --- | --- | --- |
| T01 | `geojson-organization-access`: falta literal `SUPER_ADMIN_REQUIRED` na rota | `c11d9a0` encaminhou a decisão a `authorizeOrganizationPermissionMutation`; a concessão ampla está fora do teto delegado | Rota deve chamar autorização antes da concessão; engine e autorizador reais, schema/SQL em memória, grant/revoke negados para perfis comuns e autorizados para Super Admin |
| T02 | `point-clustering-integration`: módulo `point-cluster-count-layer.ts` ausente | `5849fa5` substituiu par Redux pela camada lógica v2; `b83e12f` moveu painel; `12e90d6` preservou semântica nativa | Migração idempotente, cluster manual independente, GeoJSON, flag desligada, limite 300 mil, store, dados/accessors reais e conexão loader/hidratação/painel/runtime |
| T03 | `point-clustering-policy`: export `pointClusterLayerId` ausente | `5849fa5` separou IDs legado/runtime; `6014c16` fixou raio espacial nativo em 40 | Versões 1→2 e futura rejeitada, defaults, limites/eligibilidade e IDs explícitos; os casos anteriores de geometrias inválidas continuam |
| T04 | `point-clustering-zoom`: export `resolveVisibilityChanges` ausente | v2 troca representação transitória sem alterar visibilidade lógica persistida | Limiares exatos e sequência de histerese com renderLayer real; repetição estável, flag/política e clique/zoom |
| T05 | `project-change-request-visualization-static`: wrapper não contém strings de operações | `60dd87b` compôs runtime legado e persistente sobre store coordenado | Verifica montagem do legado e operações persistíveis no componente efetivo; viewport permanece fora daquela captura; não habilita Change Requests |
| T06 | `user-access-commercial`, vocabulário: antigo entrypoint tornou-se reexport | `977877c` tornou a tela uma visão operacional; gestão central/delegada substituiu controles antigos | Entry segue Overview; rótulos atuais, link Admin restrito e gestão delegada condicionada |
| T07 | Mesmo arquivo, catálogo: expectativa de texto no arquivo errado e regex de propriedades na mesma linha | Catálogo real multilinha e grupo atual Auditoria; nomes/perfis são dados exportados | Executa mapeamento técnico/comercial, alias client, caixa, grupos e unicidade; não depende da quebra de linha |
| T08 | Mesmo arquivo, perfil personalizado: literal procurado no reexport | Fallback está no Overview e no catálogo real | Combinações desconhecidas retornam null sem promoção; UI usa Perfil personalizado; permissões desconhecidas preservam código e descrição |
| T09 | `user-management-evolution`: rótulos antigos de edição/senha/organizações | Administração atual usa shell + Legacy com Dados do usuário/Nova senha/Organizações | Mantém cinco capacidades, verifica montagem do componente e handlers/formulários reais, inclusive restrição a Super Admin |

Reproduzir por arquivo com `node --experimental-strip-types --test tests/<arquivo>.test.mjs`. Para T02–T04, o erro de importação ocorria antes de executar os casos. Não confundir as falhas de montagem da fixture durante desenvolvimento (campos brush/textLabels ausentes) com bugs do produto: foram corrigidas exclusivamente no adaptador de teste.

## Matriz de cobertura e limites

| Área | Caminho real exercitado | Evidência local | Limite remoto/visual |
| --- | --- | --- | --- |
| Criação, salvamento, concorrência e RECYCLE | Serviços e SQL/DropboxClient incorporados pela PR #185 | Suíte ampliada e Foundation incluem os 32 testes OB-02/03, com provedor HTTP controlado | D1/Dropbox autenticados e recuperação operacional continuam em OB-04/OB-02 |
| Isolamento e GeoJSON | `permissions.js`, `access-governance.js`, rotas; testes anteriores de organização ativa | SQL em memória e decisões reais; negação e concessão explícita | Não representa sessão autenticada no Preview |
| Fidelidade do mapa | Controller/store v2, `MaonoAdaptivePointLayer`, `MaonoAdaptiveGeoJsonLayer`, deck.gl real | Migração/identidade dos dados, renderLayer, limites de zoom e desligamento | Não é comparação de pixels/GPU nem aceite com mapa de cliente |
| Interface e catálogo | Entry → Overview, Admin shell → Legacy, funções reais do catálogo | Contratos estruturais de montagem/handlers mais testes comportamentais do catálogo | A revisão estrutural não substitui interação autenticada no navegador |
| Change Requests | Runtime composto → Legacy, review/API/backend | Contratos existentes mantidos e operação de viewport excluída do legado | Rollout, migrations e reativação fora do escopo |

Hipóteses descartadas neste recorte: ausência de proteção GeoJSON por mero desaparecimento do literal na rota; perda das capacidades administrativas por mudança de rótulo; necessidade de restaurar pares de cluster v1; promoção silenciosa dos perfis desconhecidos pelo catálogo atual. Isso não certifica ausência universal desses riscos: vale para os caminhos e estados exercitados.

Hipóteses pendentes: integridade no provedor real, bindings/versão do merge implantado, isolamento entre sessões reais, concorrência remota, recuperação operacional e fidelidade visual de mapas reais. Permanecem pendentes por falta das pré-condições A02–A08, não por bug confirmado.

## Mudanças revisáveis

- Apenas testes, adaptador local, comando/gate e documentação; nenhum módulo funcional, migration, dependência, tolerância ou baseline de erro alterado.
- Todos os sete arquivos antigos foram mantidos; 28 casos antes ocultos pelas três falhas de importação voltaram a executar. Nenhum teste foi excluído, marcado skip ou afrouxado para acomodar erro funcional.
- A intenção antiga de criar/alternar pares foi migrada para a decisão de produto já vigente: camada única persistida e representação transitória. O histórico acima fundamenta essa atualização de contrato.
- `test:point-clustering` passou a incluir os três arquivos recuperados. `test:change-requests` inclui o contrato estático recuperado. `test:expanded` executa a mesma seleção completa usada na reprodução.
- O workflow existente Access governance preserva seus gates e passa a executar também a suíte ampliada, com gatilho para testes `.mjs`. Nenhum gate foi removido.
- `scripts/audit-ob05-mutations.mjs` usa o mesmo isolamento do runner anterior: seis mutações seletivas, cópia temporária, baseline aprovado por mutante, timeout limitado e morte por assertion. Não modifica o checkout nem acessa provedor.

Resultados finais e checks do head publicado: ver `evidence.json` e a PR de entrega. Aceite autenticado de OB-04 deve continuar pendente na planilha mesmo se todos os testes locais/CI passarem.


## Resultado local final

| Validação | Resultado |
| --- | --- |
| Base pós-merge, suíte ampliada | 1.213/1.222; nove falhas reproduzidas |
| Suíte ampliada corrigida | **1.247/1.247**, zero falhas, zero skips |
| Sete arquivos diretamente recuperados | **45/45** |
| Foundation gate | **875/875**; inclui 28 casos de clustering e três de visualização agora no gate |
| MACRO C | **4/4** |
| Mutation testing seletivo | **6/6** mutantes detectados, baseline aprovado em cada caso |
| TypeScript + Vite | Aprovados; avisos preexistentes de dependências registrados |
| Ratchet estrito de erros | Aprovado, baseline inalterado |
| Preview remoto, somente GET | health/runtime/D1 aprovados; `/api/projects` anônimo retorna 401 |
| Aceite autenticado / Production | **Pendente**, sem sessão legítima e sem nova autorização de ambiente mutante |

Os testes locais correspondem ao commit `71ce99889cfa5eef7690ecef92deb085fee39a45`; o commit publicado de código `061b826c95f78979d920ec4a837387ea5902d349` tem a mesma árvore `43810b73d15810cf7553afba683b2d41e5c5a9b5`. A documentação/evidência é acrescentada em commit separado. A revisão/integração desta entrega e o aceite operacional permanecem decisões distintas.

Os logs completos estão compactados em `evidence/*.log.gz`, com checksums SHA-256 do arquivo e conteúdo original em `evidence.json`. Leia, por exemplo, com `gzip -cd docs/audits/acceptance-triage-2026-09-20/evidence/baseline-expanded.log.gz`.
