# PRH-08 — Registro de implementação e revisão

Data: 19/09/2026. Base: `0843881070a94f5366367092bb24f8d22ac121a9` (`mano_kepler_v1`, PR #170). Branch: `feat/prh-08-final-reliability-ux`.

## Resultado técnico

Recuperação protegida por política de paths, tentativas persistentes e CAS; validação física de pastas; métricas com origem manual/automática; UX de falhas e transferências; operador com target fixo e preflight; gate de SLO que não aprova evidência insuficiente. Instruções completas em [aceite PRH-08](../ops/product-reliability-prh08-acceptance.md).

## Verificação executada

| Verificação local | Resultado |
| --- | --- |
| `npm run test:reliability` | 184 execuções de teste aprovadas |
| `npm run test:foundation-gate` | 796 execuções de teste aprovadas |
| Save observability + Dropbox runtime + large save/lifecycle/watchdog/recycle | 56 execuções de teste aprovadas |
| Revisão de acesso/governança/build contract e CAS de lifecycle | 21 execuções de teste aprovadas |
| `npm run test:reliability-browser` | 11 cenários Chromium aprovados: 3 loading + 8 reliability |
| `npm run build` | TypeScript e Vite aprovados; avisos de bundles grandes/dependências browser permanecem |
| Ratchet estrito de erros | Aprovado; baseline reduzida de 143 para 142 ocorrências high-signal após remover um sink |
| Operador Wrangler 4.112.0 | Empacotamento local `deploy --dry-run` aprovado nos modos disabled/dry-run/apply; nenhum deploy |
| `git diff --check` | Aprovado |

As contagens de diferentes comandos podem incluir os mesmos testes; não são um total de testes únicos. O inventário estático inclui diagnóstico interno e funcionalidades pausadas, e não equivale a 142 vazamentos públicos.

## Revisão independente e correções

- Reparos administrativos não são classificados como automáticos.
- Intervenção manual anterior ao sucesso do cron impede atribuir sucesso autônomo.
- Falha de claim substituído não cria incidente canônico falso.
- Primeira falha ausente torna a classificação inconclusiva em vez de excluir transiente do denominador.
- Readiness de caminho legado bloqueado não promete tentativa automática.
- Mudanças isoladas no operador acionam o gate que o valida.
- Referências de evidência vazias/tipos inválidos não aprovam o SLO.
- Metadata update não reativa organização desativada nem desfaz caminho atualizado por outra requisição.
- Conflito com arquivo não prova existência de pasta; responses fora de ordem não alteram a organização atual na UI.

Após correções e revalidação, nenhum P0/P1 adicional identificado no escopo revisado. Isso não constitui garantia de ausência de bugs ou aceite de ambiente remoto.

## Banco, rollout e pendências

Nenhuma migration criada, alterada ou aplicada. Nenhuma mutação no D1/Dropbox remoto, segredo de produção, ativação do Worker ou fabricação de sessão QA. A 0009 já tem evidência de histórico/schema fornecida pelo usuário; não reexecutar.

Permanecem necessários: merge das PRs técnicas e bootstrap do operador em main, confirmação de bindings, observação dry-run/apply, diagnóstico da organização PENDING, política/inventário da QA ID9 e aceite autenticado. SLO real só pode ser confirmado com inventário/auditoria completos e janela/amostra contratadas. Migrations 0021/0022/0023 e rollout de Change Requests permanecem fora deste trabalho.

O código de rollback deve reconhecer o envelope persistido de retry. Em incidente, desabilitar o Worker primeiro; não restaurar automaticamente o banco nem excluir dados/órfãos.
