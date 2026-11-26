# AU-AC01-B1 — ensaio local da janela de Organizações

Execute a matriz do operador a partir da raiz do repositório:

```sh
node --test tests/production-acceptance-operator*.test.mjs
```

O teste de integração cria os dois arquivos JSON temporários e invoca o mesmo
ponto de entrada do operador. O cenário contém relógio, manifesto, leitura do
inventário após limpeza e estado simulado dos executores antes da restauração.
A evidência é um arquivo separado, com campos permitidos e limite de 32 KiB.
O operador lê o original e emite seu SHA-256 em relatório separado. Os arquivos
são entradas locais. Uma origem ou autoria declarada aqui é parte da fixture.

A correlação exige execução, tentativa, SHA, origem sintética, binding,
organização, ator e caso. A matriz observa os estados de espera, verificação,
interrupção, limpeza e restauração. Os seis campos de UI exercitam o contrato;
o teste de CLI não abre um navegador. O adaptador em memória restaura Pages,
Worker de exclusão e Worker de recuperação, e o protocolo compara o readback
de cada um ao baseline. A falha parcial impede o fechamento e permite repetir
a restauração na mesma instância. O relatório conserva o caráter sintético.

O ensaio ainda usa um caso e adaptadores em memória. O diário abaixo retoma
as etapas sintéticas. Ainda falta estabelecer a procedência do canal
autenticado e vincular deploy, binding, autoria, HTTP,
UI e histórico a observações independentes. O adaptador remoto precisa usar
baseline por executor, configuração efetiva e confirmação pós-restauração.
O recorte operacional e tokens permanecem no ambiente protegido existente.
A suíte de readiness conserva seu contrato read-only.

### Retomada em outro processo

Em um sistema de arquivos POSIX local que suporte hard links e sincronização
de diretórios, use uma pasta privada nova, sem componentes substituíveis por
terceiros. As duas entradas devem ser idênticas byte a byte nas duas etapas:

```sh
journal=$(mktemp -d)
node scripts/acceptance/operator.mjs organization-window-synthetic scenario.json evidence.json "$journal" accept
node scripts/acceptance/operator.mjs organization-window-synthetic scenario.json evidence.json "$journal" finish
```

`accept` valida a evidência e grava um registro imutável antes de devolver
o estado `cleanup`. `finish` exige esse registro, simula a limpeza e a
restauração e só grava o fechamento após o readback de todos os executores.
Repetir uma etapa concluída devolve o registro, sem executar a etapa de novo.
Uma entrada diferente para a mesma execução, tentativa e caso é recusada.
Uma falha antes da publicação do registro não impede nova tentativa; arquivos
temporários abandonados não são válidos como registros. A publicação é
exclusiva, inclusive entre processos; processos concorrentes ainda podem
calcular a mesma transição em memória antes da publicação.

O diário não autentica autoria e não substitui um armazenamento protegido.
Contém hashes dos arquivos e o relatório sintético, não as entradas originais.
Conserve os dois arquivos e a pasta até verificar o resultado. Nunca use
credenciais, dados de produção ou adaptadores reais neste comando.

### Transporte de evidências pelo GitHub

A prova de transporte é separada do diário sintético. A partir de um plano
revisado, fixe o identificador da execução, o SHA, o caso e o identificador
do artefato esperado. O formato proposto para o produtor é
`organization-evidence-<run>-1-<caso>`, com um único
`organization-evidence.json` contendo `run`, `attempt`, `sha` e `caseId`.
A rotina abaixo recebe o ZIP original do GitHub, não uma cópia recompactada.
O produtor protegido **ainda não publica esse formato**; não dispare uma
janela em produção para testar o verificador.

```sh
python3 scripts/acceptance/verify-organization-artifact.py \
  --run "$RUN_ID" --artifact "$ARTIFACT_ID" --sha "$PRODUCT_SHA" \
  --case "$CASE_ID" --archive "$ORIGINAL_ZIP"
python3 -m unittest discover -s tests -p test_organization_artifact_provenance.py
```

Configure `MAONO_EVIDENCE_GITHUB_TOKEN` como segredo de ambiente, só com
Actions: read no repositório. Não passe o token na linha de comando. O
verificador consulta apenas metadados do GitHub por GET, sem seguir
redirecionamentos. Exige a primeira tentativa bem-sucedida do workflow
esperado, no repositório e na branch de produto esperados. Compara o hash do
ZIP com o digest do provedor, o nome do artefato com o caso esperado e a
identidade do JSON com o run/SHA/caso. Não extrai arquivos no disco e não
imprime o JSON original. Um resultado aprovado prova o transporte e o
vínculo, não comprova interação do usuário, autoria da sessão, efeito no D1
ou aceite funcional. Os testes usam metadados e ZIPs de teste.

### Verificação em duas leituras

Na restauração sintética, a primeira leitura precisa obter deployment e
configuração dos três executores, separadamente. Se qualquer leitura estiver
ausente ou inválida, nenhuma escrita é simulada. Depois de restaurar, cada
executor é lido de novo. Uma leitura ausente fica marcada como não verificada
e impede o encerramento, mesmo quando os dois outros coincidem com o baseline.
Uma nova tentativa relê os três e não repete a restauração de um executor que
já voltou ao baseline. Isso não valida operações Cloudflare; ainda é preciso
vincular os três alvos, configurações e acessos de um ambiente de teste
autorizado.
