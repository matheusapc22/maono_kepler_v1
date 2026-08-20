# C0.05 — Baseline de build e Foundation Gate

Data: 2026-08-20

## Base de referência

- `mano_kepler_v1`
- merge commit: `46fbf2ec434be9d22e51d1575eb608e83f9d5cdb`
- conteúdo funcional imediatamente validado antes do merge: head da PR #70 `9e63099c1ad586435ce335acc2640f283a137fe8`

## Evidência de GitHub Actions

Workflow run `31548623661` — `Access governance validation`.

Job `validate`: SUCCESS.

| Etapa | Resultado |
| --- | --- |
| Checkout | SUCCESS |
| Setup Node | SUCCESS |
| Install dependencies | SUCCESS |
| Build | SUCCESS |
| Access governance and runtime tests | SUCCESS |
| GATE A — Foundation stability | SUCCESS |

## Interpretação

O merge commit da PR #70 não recebeu uma nova execução `pull_request`; a execução acima pertence ao head que foi incorporado pela base `mano_kepler_v1`. Ela é a evidência congelada de baseline anterior ao C0.

A PR #72 deve executar novamente build e `npm run test:foundation-gate` no seu próprio head. O resultado da PR #72 é o gate de regressão do C0; esta página não substitui CI atual.

## Regras

- Não usar números de benchmark da S08 como requisito do C0.
- Não alterar o GATE A para acomodar a Macro C.
- `test:macro-c-gate` é adicional e não chama `test:foundation-gate` internamente.
- Falha de build ou GATE A na PR #72 é stop-the-line.
