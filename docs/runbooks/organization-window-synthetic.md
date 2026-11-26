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
