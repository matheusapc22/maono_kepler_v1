# Progressive Loading: limite global do job

Evidência observada em 28/10/2026, no commit
`f796dbe6003ef7a07070efa00ab750592234adf4` da PR #261:

- Run: https://github.com/matheusapc22/maono_kepler_v1/actions/runs/40608804678
- Job: https://github.com/matheusapc22/maono_kepler_v1/actions/runs/40608804678/job/122554943244
- Conclusão: `cancelled`. A anotação do GitHub informa:
  `The job has exceeded the maximum execution time of 35m0s`.
- Instalação, contratos, lint e build passaram. A instalação dos navegadores
  terminou às 00:32:06 UTC; o navegador foi interrompido às 01:02:07 UTC.
- O log anunciou 579 testes e registrou 565 aprovações, sem falha de assertion
  observada antes do corte. Os 14 casos restantes não foram concluídos.
  Isso não constitui aprovação da matriz completa.
- Artefato preservado pelo workflow: `12782674839`, SHA-256 do ZIP
  `11489c2406e7a362a41e505287ba4b68aa16a6076bf0b3d5a1a6776e16d8af20`.

O limite global passa de 35 para 45 minutos para comportar instalação, build e
a matriz serial completa. Os limites de 45 segundos por teste e 10 segundos por
assertion, um worker, três navegadores, seleção de casos, regras de lint,
assertions, gatilhos, artefatos e critérios de falha permanecem inalterados.
Não há retry adicional nem tratamento de timeout como sucesso.

O ajuste não modifica código de produto ou dados. A confirmação da matriz
completa depende do CI do commit que contém esta correção; o run cancelado
permanece como evidência histórica. Nenhum run foi cancelado por este executor.
Para reverter somente este ajuste, restaure o limite global anterior no
workflow, preservando este registro do diagnóstico.
