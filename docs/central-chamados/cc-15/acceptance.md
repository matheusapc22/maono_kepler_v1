# Aceite e pendências CC15

## Execução local

```sh
node --test tests/ticket-feedback.test.mjs
node scripts/central-chamados/operator/smoke-feedback-local.mjs
node --test tests/ticket-*.test.mjs
npx playwright test tests/browser/ticket-feedback.spec.ts tests/browser/ticket-metrics.spec.ts --project=chromium
npm run test:preview-safety
npm run build
node scripts/audit-user-error-sinks.mjs --baseline scripts/user-error-sink-baseline.json --strict-baseline
```

CT47: fechar sem responder, repetir resposta igual/divergente, reabrir explicitamente e fechar um novo ciclo. CT48: 10 convites maduros/4 respostas =40%,6 não respostas;3 imaturos/2 respostas permanecem separados. Incluir recusa, retirada, expiração, versões e denominador zero. Testes SQL reais verificam tenant, ACL/grants revogados durante batch, atomicidade, outbox, schema fresh/upgrade e integração/replay CC11.

## Janela autenticada controlada após merge/migration

1. Confirmar SHA servido, ledger0038/integridade e flags. Registrar atores solicitante, gestor, não destinatário, privado e outra organização. Não emitir a usuários reais fora da allowlist autorizada.
2. Aprovar instrumento/consentimento/retencão, publicar por UI e encerrar fixture canônica. Reconciliar e processar CC07. Conferir convite único e só o destinatário.
3. Executar CT47/48, revogar ACL/membership entre leitura/envio/entrega; repetir depois de timeout e falha. Validar retirada e que nenhum comentário chegou à conversa, outbox ou export.
4. Confirmar caso sem configuração, OFF e entrega com falha: fechamento deve continuar normal. Medir backlog, erro/latência/D1 e cobertura da emissão com orçamento aprovado.
5. Fazer QA assistivo real e mobile, registrar evidências por SHA. Preservar ACL e histórico ao conter a feature. Não apagar tabelas/fixtures por SQL genérico.

## Pendências abertas

- B14/G05: PR201 do operador segue aberta com conflito; suíte autenticada CC15, atores e cleanup precisam ser registrados no dispatcher revisado. O smoke local não é execução do operador de produção.
- B15: review humano e merge da PR CC15; CI deve ser vinculado ao SHA exato.
- B16/G06: audit, autorização humana específica, apply isolado0038 e pós-validação.
- G01/D01–D08: responsáveis e decisões comerciais/operacionais pendentes. Configuração não foi publicada em produção.
- B17/G07: SHA servido, CT47/48 autenticados, QA assistivo manual e carga real.
- B18/G08: canário, observação, retenção, cleanup e handoff.
- Mantidas as 10 pendências CC14 e 10 heranças CC13 na planilha; nenhum merge ou teste local as baixa automaticamente.

Homologação isolada permanece dispensada conforme decisão anterior do usuário; isso não dispensa aceite controlado em produção. Preview continua fail-closed e não foi utilizado para mutações.
