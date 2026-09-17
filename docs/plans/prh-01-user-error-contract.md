# PRH-01 — Kernel central de apresentação de erros

Base de implementação: `mano_kepler_v1` após merge da PR #162.

## Objetivo

Criar a fronteira entre diagnóstico técnico e mensagem de produto antes da migração das superfícies E01–E19/E25–E29.

## Decisões implementadas

- `src/lib/error-contract.ts` concentra `ApiError`, contrato técnico e diagnóstico.
- `src/lib/user-error-catalog.ts` concentra mensagens, severidade, ação, retryability e support reference.
- `src/lib/api.ts` não usa corpo textual bruto para construir mensagem visual.
- resposta JSON inválida/não-JSON em endpoint JSON vira fallback tipado seguro.
- falha de rede vira `INFRASTRUCTURE_NETWORK_FAILURE` tipado.
- `correlationId` permanece no diagnóstico; a UI pode usar uma referência curta `MNO-*` quando apropriado.
- `ExportsSection.tsx` é o consumidor de referência desta PR.
- o ratchet ignora identificadores operacionais somente nos dois módulos centrais não visuais, mantendo a regra ativa para componentes e demais fontes.
- o antigo teste de SAVE deixa de exigir que `correlationId` seja parte da copy pública; observabilidade continua responsável por preservá-lo.

## Fora do escopo

- migração massiva de E01–E19;
- limpeza completa de SAVE/CREATE;
- Change Requests;
- migrations D1;
- Self-Healing de storage/organizações;
- revisão geral de loaders, empty states e copy.

## Gate

- testes do contrato de apresentação;
- testes do scanner;
- ratchet sem aumento de sinks high-signal;
- `npm run build`;
- PR mergeable contra `mano_kepler_v1`.
