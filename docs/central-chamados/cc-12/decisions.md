# Decisões CC-12

Escolhas de implementação executadas sob a solicitação de CC-12. Não equivalem a aprovação de quotas, produção, políticas ou rollout.

| Decisão | Implementação | Pendência |
|---|---|---|
| D01 | Snapshot próprio, geração monotônica global, persistência condicionada a geração e lease | Medir contenção e taxa de abortos em D1 real |
| D02 | Cron Worker + D1; partições imutáveis no namespace privado Dropbox `/maono-private-ticket-exports-v1` | Provisionar, medir capacidade e exercitar provedor real |
| D03 | Configuração operacional obrigatória, sem defaults de produção | Produto/Operador aprovarem TTL, quotas, orçamento, retenção de auditoria e alertas |
| D04 | CSV `text-v1`, prefixo literal em toda string, números tipados | Aceite de importação/reabertura nos clientes aprovados |
| D05 | Semântica CC-10/11, políticas versionadas, h ausente permanece desconhecido | Aprovação das políticas e h pelo Produto |
| D06 | CC12-A/B implementadas; causas/incidentes indisponíveis | CC-13 e aceite integrado para encerrar CC-12 |
| D07 | Jobs privados ao autor; ACL atual integral, sem exceção administrativa nova | Perfis QA, responsáveis nominais e janela autorizada |

## Consistência

Triggers de INSERT/UPDATE/DELETE em vinte tabelas de fonte, ACL, membership, usuário, organização e negativas explícitas atualizam uma geração global. O snapshot captura a geração antes da leitura e cerca cada escrita com geração + token de lease. Mutação durante a captura produz falha explícita; não publica subconjunto silencioso. Depois de congelado, os fatos permanecem estáveis e toda leitura continua dependente da autorização atual. Grants opcionais de `user_permissions`/`role_permissions` são consultados pelo resolver atual; não se criam tabelas opcionais nem triggers nelas. Expiração de grants e sessão é tratada por reautorização, não por histórico da geração.

A geração global pode abortar uma captura por alteração em outra organização. É uma escolha conservadora de integridade, com custo de disponibilidade. Não declarar adequação para volume alto antes de medir taxa de falha, tempo de captura, CPU e leituras/escritas D1. Otimização futura por organização deve preservar a cobertura de usuários/grupos e impedir mistura de versões.

## Orçamento finito

- Cinco chamados por passo de captura, cinco passos no total por cron; organizações em rotação, allowlist até vinte.
- Histórico de cinco jobs por página. Não deriva população da lista CC-09.
- Até 500 registros por fonte por chamado; acima disso falha explícita. Fontes serializadas e cada partição CSV até 1 MiB.
- Definições distintas de políticas até 512 KiB antes da desserialização; manifesto até 1 MiB. Nenhum arquivo parcial recebe estado ready.
- Lease de 60 segundos; CAS impede publicação por Worker antigo. Tentativas consecutivas persistidas, reset após progresso. Backoff exponencial respeita Retry-After informado pelo cliente Dropbox.
- Quotas configuráveis com tetos de engenharia: TTL 60–604800 s; 250–50000 linhas; 1024–104857600 bytes; 1–50 jobs ativos por organização; 1–10 tentativas. Esses intervalos NÃO são valores aprovados para produção.
- Limite compartilhado de jobs por organização também limita o abuso por um único autor; uma quota exclusiva por autor e limites de CPU/D1 de produção ainda dependem D03.

## Armazenamento e recuperação

Cada partição abre e finaliza uma upload session com o bloco inteiro, sem append ambíguo. Repetição reconcilia tamanho/content_hash antes de considerar sucesso; conflito nunca sobrescreve conteúdo. O download verifica SHA-256 por partição. Testes de provedor são mocks; aceitação Dropbox real está pendente.

Expiração/cancelamento/revogação bloqueiam publicação e acesso. Cleanup remove objetos em lotes e conserva intenção de limpeza de órfãos; tombstones de IDs/metadados voltam a tentar remoção diária, inclusive para upload que terminou após a primeira limpeza. Dados e filtros do snapshot são purgados no TTL, enquanto auditoria/tombstones sem conteúdo permanecem. Aprovar retenção operacional e medir crescimento antes do rollout. Durante rollback da feature, manter Worker de limpeza e allowlist apropriada; não desligar ACL.
