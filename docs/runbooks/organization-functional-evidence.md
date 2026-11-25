# AU-AC01-A — coleta e verificação de evidências de Organizações

## O que esta entrega executa

Esta entrega fornece um coletor de navegador, um contrato de evidência, um
verificador offline, uma CLI e um gate de testes com a interface compilada. O
coletor usa a sessão humana já aberta e faz somente GETs fixos. Observa o DOM e
os quadros de animação; não clica, submete formulários, autentica pessoas, muda
flags ou executa recuperação. Os testes usam contas e respostas HTTP sintéticas.

**AU-AC01-A não é uma suíte operacional registrada.** O certificado sempre
mantém `complete: false` e `acceptanceIncomplete: true`, inclusive quando a CLI
termina com código 0. Nenhum checkbox converte carregamento, avisos, efeito,
limpeza ou restauração em algo observado.

| Etapa | Executável nesta preparação | Evidência ainda necessária |
| --- | --- | --- |
| AU-AC01-A | Coleta somente leitura, observação humana da UI, validação offline e testes locais/CI | Os arquivos de uma coleta real ainda dependem da sessão e do ambiente autorizados |
| AU-AC01-B | Não implementada por esta entrega | Janela funcional registrada, identidade e inventário sintético, orçamento, baseline e restauração de Pages/Workers, autorização para ações manuais, efeitos e limpeza verificados |

O runner existente continua bloqueando `/api/admin`. Não foram ampliados
`manualAdministration`, registry, perfis de credencial ou allowlists de flags.
A única alteração no operador é incluir `workflowRunId`/`workflowRunAttempt`
válidos em novos relatórios de `organization-management-readiness`; continuam
os mesmos dois GETs de control-plane e a recusa de `run`/`closure` nessa suíte.
Relatórios históricos sem esses metadados permanecem sem vínculo confirmado.

## Arquivos e responsabilidades

- `scripts/acceptance/organization-functional-evidence.js`: helper completo a
  ser inspecionado e carregado no navegador humano.
- `scripts/acceptance/organization-functional-evidence.mjs`: contrato estrito,
  correlação e certificado offline.
- `scripts/acceptance/verify-organization-functional-evidence.mjs`: CLI sem rede,
  leitura limitada e certificado novo com escrita exclusiva.
- `tests/organization-functional-*.test.mjs`: transportes, casos positivos e
  negativos, processo CLI e composição do workflow.
- `tests/acceptance-browser/organization-functional-evidence.spec.ts`: quatro
  casos com o produto compilado e HTTP sintético, incluindo retorno de foco ao
  botão de origem ao fechar os detalhes depois de consultar uma operação.
- `playwright.organization-evidence.config.ts` e
  `.github/workflows/organization-functional-evidence.yml`: gate próprio, fora
  da descoberta genérica de `tests/browser`, com flags de build habilitadas.

O plano antigo `organization-management-functional-acceptance-plan.md` não
deve ser usado como contrato executável desta fase. Ele antecede a exclusão
permanente atual, a retirada da importação CSV e os frames de auditoria.

## Limites de confiança e do ambiente

O certificado verifica estrutura, escopo, sequência temporal, consistência das
medições e correlação **dos arquivos recebidos**. Um hash comprova a identidade
dos bytes fornecidos, não a identidade de quem coletou os dados. A exportação
humana não é uma atestação criptográfica; pode ser alterada fora do coletor. O
verificador não afirma ter observado o HTTP, os pixels, o runtime remoto ou o
provedor de armazenamento de forma independente.

`expectedCommit` e `expectedDeploymentId` são expectativas informadas ao coletor.
Sozinhas, não vinculam o navegador a um deploy. Para `environment.matched: true`
é obrigatório fornecer os bytes de um relatório externo real, revisado, seu
SHA-256 e a URL do run que o produziu. O vínculo compara SHA, deployment, projeto,
branch, binding D1, organização reservada, run e tentativa. O relatório deve
ter terminado **antes da coleta e no máximo 15 minutos antes**. O hash calculado
apenas sobre um arquivo inventado não cria procedência.

O contrato externo desta versão usa a identidade canônica já revisada:
`maono-kepler-v1`, branch `mano_kepler_v1`, origem
`https://maono-kepler-v1.pages.dev` e D1
`5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`. Isso não autoriza novas escritas em
Produção. Preview e localhost podem produzir observações estruturais, mas não
recebem vínculo canônico por analogia. Não anexar um relatório de Produção a
uma coleta de Preview. Uma futura janela QA/Preview exige contrato próprio.

O relatório de control-plane não comprova o bundle servido, as flags efetivas
de Auditoria, a estrutura do banco, uma janela funcional ou a restauração de
Workers. A resposta de domínio e as capabilities são condições de coleta,
não substitutos dessas evidências.

### Migrations

Esta preparação não cria nem aplica migration. A funcionalidade de auditoria
depende de `0045_operation_audit_frames.sql` (M45), que introduz estruturas
duráveis de eventos e observações de reconciliação, com restrições de integridade e
imutabilidade. O alvo é o D1 realmente ligado ao ambiente escolhido para a
funcionalidade. A confirmação deve identificar banco, ambiente e evidência da
aplicação/estrutura antes de ativar o contrato de Auditoria nesse destino.

**MIGRATION PENDENTE DE CONFIRMAÇÃO no ambiente operacional.** Build, CI, GET
da aplicação ou certificado offline não removem essa pendência. O certificado
mantém `migrationVerified: false`; esta entrega não fornece nem executa um
comando de aplicação por inferência.

## Preparação da sessão humana

1. Fixar o SHA dos arquivos revisados e obter a referência externa real antes
   de iniciar. Não editar os arquivos exportados para completar campos ausentes.
2. Confirmar a identidade do ambiente e o ID exato do recurso autorizado. Não
   presumir que a organização QA9 pertence a esta execução.
3. Abrir a sessão existente de Super Admin na própria plataforma. Nenhum cookie,
   token, senha ou perfil administrativo deve ser copiado para CLI, CI ou prompt.
4. Para diagnóstico, usar somente o caso `snapshot`. Ele não exige criar nem
   renomear organizações. Para casos funcionais, a janela AU-AC01-B deve estar
   autorizada separadamente e a organização deve estar no inventário exato.
5. Na futura janela funcional, o nome sintético precisa ser exatamente
   `QA Auditoria <runId>`, com o UUID minúsculo da execução. Esse marcador é
   uma defesa adicional de escopo; não comprova propriedade nem autorização.
6. Ler o helper completo no checkout fixado e carregá-lo como um snippet local
   no DevTools da aba `/admin`. O helper não é baixado dinamicamente de uma URL.
   Sua instalação é única por página; para reiniciar, recarregar a página e
   carregar novamente o arquivo revisado.

Em terminal, na raiz do checkout, este bloco permite conferir o arquivo inteiro
e seu digest antes de criar o snippet:

```bash
set -euo pipefail
git rev-parse HEAD
sha256sum scripts/acceptance/organization-functional-evidence.js
cat scripts/acceptance/organization-functional-evidence.js
```

Depois de executar o snippet completo, o bloco abaixo inicia **somente o
diagnóstico por leitura**, solicitando os identificadores reais. Ele não abre
uma janela funcional nem executa uma ação administrativa:

```javascript
await (async () => {
  const runId = window.prompt('UUID minúsculo desta coleta:');
  const organizationId = Number(window.prompt('ID exato da organização autorizada para leitura:'));
  const expectedCommit = window.prompt('SHA completo de 40 caracteres do deployment revisado:');
  const expectedDeploymentId = window.prompt('UUID do deployment revisado:');
  return window.MaonoOrganizationEvidence.start({
    runId, organizationId, expectedCommit, expectedDeploymentId,
    mode: 'diagnostic', requestedCases: ['snapshot'],
  });
})();
```

A exportação abaixo usa `copy`, helper do console do Chromium. Salvar o texto
JSON copiado em um arquivo novo, por exemplo `organization-evidence.json`, sem
alterá-lo. O resultado não inclui nomes, emails, descrições ou rascunhos brutos:

```javascript
copy(JSON.stringify(await window.MaonoOrganizationEvidence.export(), null, 2));
```

### Casos funcionais, somente na janela posteriormente autorizada

O helper também observa casos funcionais. O bloco seguinte é completo, porém
seu uso não concede autorização para executar as ações. O operador informa um
caso de cada vez, mantém o mesmo escopo e realiza a ação pela UI:

```javascript
await (async () => {
  const runId = window.prompt('UUID da janela funcional autorizada:');
  const organizationId = Number(window.prompt('ID exato do inventário sintético autorizado:'));
  const expectedCommit = window.prompt('SHA completo de 40 caracteres do deployment revisado:');
  const expectedDeploymentId = window.prompt('UUID do deployment revisado:');
  const caseId = window.prompt('Caso autorizado: save_success, save_error, recovery_query ou deletion_observed');
  return window.MaonoOrganizationEvidence.start({
    runId, organizationId, expectedCommit, expectedDeploymentId,
    mode: 'functional', requestedCases: [caseId],
  });
})();
```

| Caso | Ação humana separada da coleta | O que precisa ser observado |
| --- | --- | --- |
| `snapshot` | Nenhuma mutação | Detalhe, prévia e auditoria válidos, do mesmo escopo, sem truncamento |
| `save_success` | Alterar a descrição sintética e salvar pela UI | Mesmo formulário durante busy, círculo dourado, aviso inferior direito por 3 s, diálogo aberto, versão +1 e frame novo de sucesso correlacionado |
| `save_error` | Executar apenas o cenário de erro previamente delimitado na janela; não provocar falhas em recursos reais | Rascunho preservado, aviso superior direito por 10 s com fechar, diálogo aberto, estado sem alteração e frame novo de falha/impedimento correlacionado |
| `recovery_query` | Usar `Consultar resultado` em uma operação autorizada | Carregamento/aviso medidos e nova observação de consulta/reconciliação da mesma operação |
| `deletion_observed` | Exclusão apenas quando explicitamente autorizada pela janela e pelo inventário | Antes existente, depois 404 e exclusão concluída sem erro, com frame novo de exclusão da mesma operação, ator e período |

**`Consultar resultado` executa POST de recuperação/reconciliação.** Não é um
GET inocente de diagnóstico. `Tentar novamente`, `Retomar` e excluir também
permanecem ações de domínio separadas; o coletor nunca as executa.

Para `save_success`, `save_error` ou `recovery_query`: preencher o rascunho e
abrir o formulário/detalhe correto antes de começar. Este bloco inicia a
gravação e uma captura anterior; executar a ação manual somente depois de
receber o resultado de `begin`:

```javascript
await window.MaonoOrganizationEvidence.begin(
  window.prompt('Caso já iniciado nesta coleta: save_success, save_error ou recovery_query')
);
```

Manter a aba visível e a janela sem redimensionar. Esperar o fim do carregamento
e o desaparecimento natural do aviso, mantendo o diálogo aberto por mais de
400 ms. Não fechar o aviso manualmente em um caso que mede duração. Depois:

```javascript
await window.MaonoOrganizationEvidence.finish();
copy(JSON.stringify(await window.MaonoOrganizationEvidence.export(), null, 2));
```

Para `deletion_observed`, `start` já coleta o antes. Depois da ação humana
autorizada, `capture` coleta o depois; este caso não afirma ter medido spinner,
avisos ou o fluxo visual de exclusão:

```javascript
await window.MaonoOrganizationEvidence.capture();
copy(JSON.stringify(await window.MaonoOrganizationEvidence.export(), null, 2));
```

Para interromper uma gravação, sem concluir nem repetir a operação:

```javascript
await window.MaonoOrganizationEvidence.stop();
```

Uma gravação interrompida, expirada, sem carregamento observado ou sem rastro
correlacionado fica incompleta. Não refazer uma operação de resultado incerto
apenas para produzir evidência. Reconciliação exige a ação autorizada e suas
regras de autoria, concorrência e idempotência.

## O que é coletado e como é medido

Os únicos destinos são `/api/session`, o detalhe e a prévia da organização
configurada, a lista de Auditoria filtrada por esse ID, até três detalhes
descobertos nessa lista e, quando descoberta ali, a consulta de uma exclusão
da mesma organização. Não há parâmetros para URL arbitrária, método, corpo,
SQL, credencial ou replay. Todas as chamadas usam `mode: same-origin`,
`credentials: same-origin`, `redirect: error`, `cache: no-store` e prazo de 10 s.

Cada resposta é limitada a 256 KiB; o conjunto a 2 MiB, 96 requests, 12 capturas,
30 minutos e até quatro gravações. A gravação usa no máximo 120 s e 1.300
amostras. O verificador rejeita evidência com mais de 24 h. HTTP 401/403,
troca de ator, contexto incompatível, leitura truncada, erro de transporte ou
JSON inválido descartam o contexto exportável. A saída mostra códigos locais
controlados, sem copiar mensagens ou corpos remotos.

Nome, slug, descrição e valores de campos tornam-se digests SHA-256 vinculados
ao UUID da execução. São identificadores derivados, não criptografia nem prova
de anonimização contra ataques por tentativa. A exportação continua restrita ao
escopo de governança. Comparar digests permite comprovar continuidade e mudança
de rascunho sem exportar seu conteúdo.

As gravações atuais declaram `sampling: 'animation_frame'`. Mutations e o
intervalo de 100 ms são coalescidos para o próximo `requestAnimationFrame`;
início e fim também recebem amostras. O coletor não registra todo microestado
de um commit React, nem grava todos os 60 quadros por segundo. Cobertura temporal,
lacunas, retângulos, nó do formulário, digests e scroll são validados. Um salto
ou rascunho alterado em um quadro medido continua falhando.

As medições são DOM/computed style em limites de frame, **não capturas de
pixels**. A cor dourada vem da propriedade calculada do círculo. Primeira
amostra deve ocorrer até 100 ms; lacunas maiores que 500 ms, viewport alterado
ou gravação sem quadro final suficiente não recebem observação completa.
Se o navegador atrasar um timeout, o timestamp real é preservado e o caso
permanece incompleto. A tolerância máxima de um segundo após o prazo aplica-se
somente a gravações interrompidas ou expiradas; nunca a uma gravação concluída.
Nenhum arredondamento inventa conclusão no prazo.

O toast precisa corresponder a um resultado observado, aparecer depois do
início da ação, permanecer pelo período previsto, desaparecer e deixar o
diálogo aberto. Ele pode coexistir com o fim do overlay enquanto o formulário
atualiza dados já confirmados. Retângulos são comparados durante carregamento;
a exibição de controles de recuperação após uma falha pode ampliar a janela
ociosa. O retorno de foco ao botão da tabela ao fechar detalhes é um requisito
distinto da posição do foco durante cada comando.

Os traces iniciais baseados em MutationObserver permanecem evidência do
protótipo. Eles não são renomeados para `animation_frame`. Na integração local,
dois alertas de microestados não se confirmaram como deslocamento do formulário
nos quadros de carregamento. A observação de foco em BODY após desabilitar a
ação de Auditoria é separada da verificação de retorno ao fechar. Na sequência
local de teclado, o primeiro Tab levou ao chrome do navegador
(`document.hasFocus: false`); o segundo voltou a um botão do diálogo e o terceiro
ao controle de detalhes técnicos. Fechar o painel após a consulta devolveu o
foco ao botão de origem na tabela, conforme o requisito do plano.

## Verificação offline sem alterar os originais

No terminal, na raiz do checkout revisado, executar o bloco completo. Ele pede
os arquivos existentes, o digest externo já revisado e a URL exata do run. Não
calcular um digest novo para fazer passar um artefato divergente. Para tentativa
posterior à primeira, a URL deve incluir `/attempts/N` correspondente:

```bash
set -u
read -r -p 'Arquivo JSON exportado pelo coletor: ' ORG_EVIDENCE_FILE
read -r -p 'Relatório externo original revisado: ' ORG_ENVIRONMENT_FILE
read -r -p 'SHA-256 previamente conferido do relatório externo: ' ORG_ENVIRONMENT_DIGEST
read -r -p 'URL exata do GitHub run/attempt que produziu o relatório: ' ORG_ENVIRONMENT_SOURCE
read -r -p 'Caminho novo para o certificado: ' ORG_CERTIFICATE_FILE
node scripts/acceptance/verify-organization-functional-evidence.mjs \
  --evidence "$ORG_EVIDENCE_FILE" \
  --environment-report "$ORG_ENVIRONMENT_FILE" \
  --environment-sha256 "$ORG_ENVIRONMENT_DIGEST" \
  --environment-source "$ORG_ENVIRONMENT_SOURCE" \
  --output "$ORG_CERTIFICATE_FILE"
ORG_VERIFY_EXIT=$?
printf 'Código do verificador: %s\n' "$ORG_VERIFY_EXIT"
```

Para examinar somente consistência do export, sem vínculo externo, usar este
bloco independente. O código esperado continua sendo 2 enquanto falta a prova
externa, mesmo que os casos solicitados estejam observados:

```bash
set -u
read -r -p 'Arquivo JSON exportado pelo coletor: ' ORG_EVIDENCE_FILE
read -r -p 'Caminho novo para o certificado: ' ORG_CERTIFICATE_FILE
node scripts/acceptance/verify-organization-functional-evidence.mjs \
  --evidence "$ORG_EVIDENCE_FILE" \
  --output "$ORG_CERTIFICATE_FILE"
ORG_VERIFY_EXIT=$?
printf 'Código do verificador: %s\n' "$ORG_VERIFY_EXIT"
```

| Código | Significado |
| --- | --- |
| 0 | Os casos solicitados e o vínculo externo passaram nas verificações offline; **não** significa aceite operacional |
| 2 | Evidência ou vínculo incompletos; o certificado explica as pendências |
| 1 | Entrada inválida, vínculo incompatível, limite, leitura ou escrita recusados; erro saneado |

O certificado tem um caminho novo, escrita `wx` e permissão 0600. Um arquivo
existente não é sobrescrito; o export e o relatório externo original permanecem
intactos. Guardar esses dois originais, o certificado, o SHA do código, o run e
os logs como artefatos distintos. Não substituir o relatório operacional pelo
certificado derivado.

## Gate local/CI reproduzível

O gate testa a preparação, não realiza ações administrativas remotas. Não usa
credenciais de Produção. O build normal do CI e os quatro testes de navegador
são obrigatórios quando os caminhos de produto, coletor, fixtures, configuração
ou workflow pertinentes mudam; não há `skip`, `grep` ou `continue-on-error`.

Na raiz do checkout, com Node 22:

```bash
set -euo pipefail
npm install --legacy-peer-deps --no-audit --no-fund
node --experimental-strip-types --test tests/organization-functional-*.test.mjs tests/production-acceptance-operator-organization-readiness.test.mjs
npm run lint
npx tsc -b --pretty false
VITE_ADMIN_AUDIT_OPERATIONS_V1=true \
VITE_ORGANIZATION_MANAGEMENT_V1=true \
VITE_MAONO_MAP_SHELL_V1=true \
VITE_MAONO_LAYER_MANAGER_V1=true \
VITE_MAONO_MAP_OVERLAY_V1=true \
npm run build
node scripts/install-ci-browsers.mjs chromium
npx playwright test --config=playwright.organization-evidence.config.ts --reporter=list,json
```

Reutilização local de um dist anterior exige prova de igualdade das fontes de
aplicação/build e registro do artefato reaproveitado. Ela não pode ser descrita
como nova compilação. O workflow dedicado sempre faz o build normal.

## Encaminhamento para AU-AC01-B

A preparação A pode ser concluída por revisão de contrato, código, testes e
runbook. A janela B exige, em etapa separada, definir e registrar ambiente,
identidades, inventário exato, casos autorizados, orçamento de requests/tempo,
journal, condição de parada, estado anterior de flags e meios de restauração
observados. Os efeitos e a limpeza precisam ser comprovados depois da execução
no mesmo escopo; um GET de exclusão da organização não prova a limpeza completa
de recursos, provider ou restauração de infraestrutura.

Sem essas provas, permanecem falsos `registeredProductionSuite`,
`operationalAcceptanceExecuted`, `cleanupVerified`, `restorationVerified` e
`migrationVerified`. A identidade humana e a janela real são bloqueios de
acesso/evidência de B; não impedem entregar e testar esta preparação A.
