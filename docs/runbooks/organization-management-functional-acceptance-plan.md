# Organization Management: especificacao de aceite controlado

Status: preparacao offline, nao registrada como suite executavel. Este documento
nao autoriza merge, deploy, migration, janela de aceite nem ativacao permanente.

## Dependencias e decisoes antes da implementacao remota

1. Operador 0043 corrigido e validado no SHA produto final; audit completo,
   autorizacao humana do hash exato, apply isolado e postvalidate aprovado.
2. Reconciliacao funcional #270 testada no SHA final. Nova pos-validacao 0043
   imediatamente antes do rollout coordenado API/UI. Certificacao antiga 0042
   nao substitui o perfil post-0043; o coletor 0042 deve continuar recusando 0043.
3. Confirmar configuracao real de deploy automatico antes de qualquer merge.
4. Inventario sanitizado de QA com IDs exatos, sem dados reais nem credenciais.
5. Contrato administrativo revisado: a API exige Super Admin, mas a politica
   proibe credencial pessoal/Super Admin no CI e manualAdministration atualmente
   bloqueia /api/admin. Nao relaxar isso apenas para fazer um teste passar.
   Proposta a revisar: passos administrativos em sessao humana existente,
   escopo sintetico fixo e evidencias observadas verificadas offline; CI usa
   somente identidades QA nao privilegiadas. Ausencia dessa prova deixa o
   resultado incompleto. Nao adicionar comandos/URLs/SQL arbitrarios ao operador.
6. Contrato de cleanup revisado antes de criar qualquer organizacao. A gestao
   nao oferece exclusao permanente. Pausar nao apaga pastas nem todos os dados:
   definir retencao/desativacao permitida, recursos exatos e comprovacao observada.
7. Extensao revisada da allowlist de flags, registry e testes do operador. Hoje
   ORGANIZATION_MANAGEMENT_V1 e flags relacionadas sao somente observaveis e
   continuam proibidas como managedFlags de suites funcionais.

## Proposta de janela, sem alterar configuracao agora

Observar separadamente ORGANIZATION_MANAGEMENT_V1 (API),
VITE_ORGANIZATION_MANAGEMENT_V1 (build da UI) e PROJECT_QUOTA_RESERVATION_V1.
Nao ativar quota global implicitamente. Definir baseline, activeValue e safeValue
por flag com justificativa e autorizacao; nao presumir que restaurar tudo para
false e correto. Se a baseline nao for a esperada, parar antes da primeira escrita.

Fixar SHA, deployment canonico, D1 binding, origens e identidades. Nao iniciar
com deployment nao terminal. Armar restauracao antes da primeira mutacao.
Exigir RUN_PRODUCTION_ACCEPTANCE e aprovacao do Environment. Controles do
workflow protegido e orcamentos existentes continuam intactos.

Para a janela migration/runtime antigo, mapear UI, endpoints legados, importacao,
lifecycle e jobs em andamento. Pausa de todos os escritores exige autorizacao
operacional especifica. Sem pausa comprovada, documentar corrida residual:
pos-validacao detecta conflitos, mas nao bloqueia escrita concorrente posterior.

## Matriz de casos e evidencias

| Caso | Prova local antes de producao | Aceite real minimo e evidencia |
| --- | --- | --- |
| Permissoes | Sessao/ACL reais com SQLite; owner, usuario comum, expirado e outro operador | QA nao privilegiado recebe negacao sem dados; IDs e status sanitizados |
| Criacao | Nome Unicode, pausada, colisao, owner ativo/inativo e email exato | Uma organizacao sintetica com ID, owner, plano, evento inicial e storage READY/ACTIVE/CONFIGURED confirmados |
| Idempotencia | Duplo envio, replay, resposta perdida, lease, corrida e parcial | Retomar a mesma operacao/ID; nenhuma organizacao ou pasta duplicada |
| Interface | Build real, debounce obsoleto, teclado/foco, erros, URL e filtros | Loading e sucesso somente apos consulta fresca; captura sem dados reais |
| Cadastro | CAS, rename preservando slug/pasta, pausa e reativacao | Mudanca sintetica preserva vinculos/projetos/arquivos e registra atividade |
| Quota | Uso + reservas, ultima vaga concorrente, downgrade e pedido duplicado | Plano exibido corresponde ao enforcement; recusa sem efeito colateral |
| Importacao | CSV 100 linhas/128 KiB, linhas invalidas, Unicode e retomada | Somente se incluida no budget/cleanup: lote sintetico pequeno com resultados por item |
| Storage | Provider simulado com timeout, drift e resposta parcial | Confirmacao real da pasta e estado; nao injetar falha global no provider |
| Encerramento | Falha em cada etapa e restauracao offline | IDs sinteticos encerrados conforme contrato, flags e SHA restaurados, deployment terminal |

A producao nao deve repetir stress, milhares de fixtures, falhas injetadas globais
ou toda a suite de CI. Esses cenarios ficam offline. Uma falha em producao nao
permite transformar automaticamente um teste pequeno em teste de carga.

## Regras de resultado

- done nao significa sucesso: exigir item succeeded, consulta fresca do result.id,
  organizacao ativa, owner ativo correto, plano/evento inicial e storage confirmado.
- Timeout do cliente nao cancela escrita no servidor. Consultar estado antes de
  retomar; manter idempotency key e lease. Nao criar outra tentativa independente.
- Quotas de usuarios, armazenamento e exportacoes continuam informativas e nao
  editaveis. Nao anunciar enforcement dessas categorias.
- Falha da listagem apos sucesso confirmado nao transforma criacao em falha.
- Dados/nomes/emails/SQL bruto/credenciais nao entram em logs ou artifacts.
  Relatorios devem limitar-se a IDs sinteticos permitidos, codigos, hashes e prova.
- Resultado incompleto quando faltar prova de limpeza, identidade, storage real,
  UI compilada ou restauracao, mesmo que alguns passos tenham passado.

## Contratos offline exigidos para a futura suite

- Recusar suite nao registrada, flag fora da allowlist, origem externa, SHA errado,
  binding errado, baseline divergente, deploy pendente e escopo nao sintetico.
- Recusar run sem confirmacao e sem identidade/escopo aprovados, antes da mutacao.
- Nao aceitar caixa de selecao humana como substituto de evidencia observada.
- Provar sanitizacao adversarial de erros, headers, corpos e caminhos de provider.
- Provar journal, recurso criado antes da resposta perdida, cleanup idempotente,
  falha de cleanup e falha de restauracao; nenhum falso complete=true.
- Provar que restauracao ocorre mesmo com cleanup administrativo pendente.
- Provar que closure restaura o estado seguro antes de qualquer nova janela.
- Manter readiness preflightOnly, sem login, requests ao app ou mutacoes de flags.

## Recuperacao e criterio de conclusao

Apply incerto: somente leitura de ledger/schema/integridade antes de agir.
Erro de guard: novo audit e autorizacao, nao reutilizar o hash anterior.
Falha funcional: conter escritores conforme autorizacao e decidir rollback do
codigo compativel. OFF nao desfaz migration nem e garantia de confidencialidade.
Time Travel exige decisao separada, pode perder escritas posteriores e nao
reverte Dropbox. Nunca remover indices/triggers como atalho.

Encerrar a janela somente com cleanup/retencao e restauracao comprovados.
Ativacao permanente e outra decisao explicita. CI local, readiness Pages,
preview ou migration aplicada isoladamente nao equivalem a aceite funcional.

## Rastreabilidade desta preparacao

Reconciliacao local: #270 cef2a9058f6621b7216e55f150072d84ad8fe06c com base
1577a2bb2b02338a97c0d5407494d7cb1a474f5a (#272), sem conflitos textuais.
A base posterior bcd1b16f49c427e2fa9caf86d1a3e1b0434733b0 (#273) foi integrada
localmente sem conflito textual. O novo contrato workerd precisou do mesmo
baseline pre-0043 ja usado pelas outras fixtures audit/apply, pois schema.sql
funcional inclui 0043. Nenhum resultado remoto e afirmado aqui.

## Percurso organizacao -> criacao de projeto

READY e necessario, mas nao comprova que um membro com perfil adequado consegue
entrar no fluxo de criar projeto. A futura janela deve incluir um caso separado:
com identidade QA nao privilegiada, vinculo ativo e permissoes conferidas,
selecionar a organizacao sintetica, entrar na criacao de projeto, confirmar
capacidade usada/reservada e concluir um projeto minimo somente dentro do escopo
aprovado. Verificar o recurso no armazenamento real e a leitura posterior pelo
mesmo perfil. Negar o percurso ao perfil sem permissao, sem vazar dados.

Registrar IDs sinteticos, resultado da reserva, status/codigos sanitizados e
prova de leitura; nao tratar READY isolado ou acesso de Super Admin como aceite.
Incluir projeto, arquivos, pasta e reserva no inventario de cleanup/retencao.
Timeout exige consultar a mesma operacao antes de tentar novamente. Este caso
nao afirma defeito atual nem autoriza criar dados reais ou ampliar a janela.
