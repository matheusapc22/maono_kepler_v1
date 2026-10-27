# Proposta pendente: adaptador legado Carto

Estado em 27/10/2026: **não implementada**. A revisão automática de aprovação rejeitou a criação do helper `task-4/type-lint-carto.py`: a proposta alterava login/logout, sobrescrita, erros e contratos além de uma correção de tipos com comportamento preservado. O helper não foi criado, o patch não foi aplicado e não houve repetição da ação.

O lint completo da manutenção ficou com um erro, `@typescript-eslint/ban-ts-comment` na linha 3 de `src/pages/Kepler/cloud-providers/carto/carto-provider.ts`. Remover essa supressão somente em memória revelou 64 diagnósticos nesse arquivo. A maior parte exige declarar campos e parâmetros; outros expõem estados ausentes e contratos legados diferentes do SDK atual.

## Mudanças de comportamento que exigem autorização específica

1. Login: retornar a Promise do OAuth e o usuário após conclusão, propagando rejeições; atualmente o método retorna antes da conclusão e seu try/catch não captura rejeição assíncrona.
2. Logout: aceitar ausência do callback legado, como faz o consumidor atual; atualmente o callback é chamado sem verificação.
3. Sobrescrita: rejeitar explicitamente quando não há mapa corrente, antes de chamar o storage; atualmente o acesso a `currentMap.id` lança uma exceção indireta.
4. Recibo: rejeitar explicitamente uma resposta nula de gravação, preservando o mapa corrente; atualmente o acesso a `result.id` lança uma exceção indireta.
5. URL de mapa: usar o campo real `isprivate` do registro Carto; o código legado lê `isPrivate`, que não consta no registro tipado.
6. Thumbnail: rejeitar resultado de FileReader que não seja string; o leitor deve produzir uma data URL.
7. Parâmetros de download: normalizar o indicador privado recebido antes de comparar; atualmente assume uma string presente.

Essas mudanças requerem testes isolados de resolução/rejeição, callback opcional, recibo nulo, preservação de estado, URL privada e leitura de thumbnail. Os testes devem executar o código real do adaptador com fronteiras OAuth/storage simuladas. Isso não constitui aceite com Carto real.

Declarações locais também precisariam representar fielmente os recibos CSV e de compartilhamento legados e os parâmetros de criação aceitos pelo toolkit, sem `any` genérico, nova supressão ou mudança nas regras de lint. Não se propõe migrar dados, ligar flags, criar credenciais, executar OAuth real ou alterar Produção.

## Estado independente

As correções de lint dos demais módulos continuam em `chore/product-lint-maintenance`, separadas da PR254. O erro do Carto permanecerá visível enquanto essa ampliação não estiver autorizada e validada. Não há autorização de merge ou auto-merge.
