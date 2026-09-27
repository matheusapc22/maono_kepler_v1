# ADR CC-06 — quarentena e scanner de anexos

**Status:** decisão arquitetural; scanner real fora do escopo funcional da CC-06.

## Contexto

Um upload confiável precisa distinguir “bytes recebidos pelo provider” de “arquivo disponível ao produto”. Hoje o fluxo histórico ativa o attachment após o `finish` remoto. A CC-06 acrescenta verificação de size/path/content hash e precisa reservar um ponto de extensão para inspeção futura sem alegar proteção que não existe.

## Decisão

1. `FINALIZING` significa que o arquivo ainda não está disponível aos leitores normais.
2. A CC-06 verifica metadata e Dropbox Content Hash antes da publicação D1 `ACTIVE`.
3. Um scanner futuro poderá introduzir estado/hook adicional entre provider commit e `ACTIVE`.
4. Nenhum campo, label ou UI usará termos como “escaneado”, “seguro” ou “sem malware” enquanto não existir serviço de scanning, política, observabilidade e resposta a incidentes aprovados.
5. Se um scanner for implementado no futuro, falha/timeout deve ser fail-closed para novos downloads até verdict ou decisão operacional documentada.

## Consequências

- A CC-06 melhora integridade e durabilidade, não detecção de malware.
- O reconciler pode confirmar um arquivo remoto sem torná-lo público antes de todos os gates de publicação aplicáveis.
- A migration 0029 não precisa acoplar a solução a um fornecedor de scanner específico.
