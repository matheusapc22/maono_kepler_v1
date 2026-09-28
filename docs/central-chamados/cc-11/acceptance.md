# Acceptance controlado CC-11

## Pré-condições

Review/merge, audit/apply/pós-validação da 0034 por operador protegido; organização QA restrita e duas identidades reais com permissões distintas. Manter todas as pendências CC09/10. A evidência local não substitui os cenários abaixo. Não é exigido criar D1 físico de staging: usar o processo protegido de QA previamente escolhido, com autorização e recursos controlados. Integração da suíte no operador protegido segue pendente; não criar executor com token de produção no runtime do agente.

1. Registrar SHA deployado, banco, organização QA, flags anteriores, usuários e IDs dos recursos sintéticos; confirmar consentimento operacional para h e SLA. Preparar política/roster/calendar sintéticos sem confundir com meta de cliente.
2. CT37: tickets com/sem resposta, ciclos fechados/abertos e legado; comparar n, cobertura, censura e percentis brutos com eventos; útil incompleto deve ficar indisponível. Confirmar unidade horas e recortes de abertura/encerramento/snapshot.
3. CT38: h aprovado; reabrir dentro/fora de h e incluir encerramento imaturo. Confirmar denominador maduro e taxa indisponível em população vazia; consultar configuração anterior sem alteração retroativa.
4. CT39: reconstruir com janela/asOf fixos duas vezes; segunda não cria checkpoint. Inserir evento canônico atrasado usando suporte de QA autorizado e repetir; verificar novo hash/revisão, watermark e igualdade com bruto. Simular concorrência/falha, sem checkpoint órfão. Correção sem semântica temporal revisada deve produzir desconhecido, não número inventado.
5. CT40: legado sem resposta/ciclo, espera ativa longa, pausas sobrepostas e intervalo fechado entre reaberturas; desconhecidos não viram zero; backlog e espera visíveis.
6. Segurança: org diferente, privado negado, nota interna, revogação durante requisição, troca de organização e URL direta. Total/qualidade/watermark devem usar só fontes autorizadas. Viewer não define h nem reconstrói.
7. Mobile, teclado, cabeçalhos/legenda da tabela, erros e retry ambíguo; consulta >200 tickets ou >2000 fontes deve falhar explicitamente sem exibir população parcial.
8. Medir p95/tempo D1 com volume declarado, incluindo batch de reconstrução; orçamento e escala aprovados pela operação, sem inferir desempenho de SQLite.
9. Registrar resultados, recursos, limpeza e restauração das flags. Rollout amplo permanece separado e não autorizado por testes.

Resultado atual: **pendente remoto** em CT37–40; nenhum dado real foi criado pelo agente.
