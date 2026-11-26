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

O ensaio ainda usa um caso por instância e estado em memória. Ainda falta
persistir a janela e deduplicar submissões entre processos, estabelecer
procedência do canal autenticado e vincular deploy, binding, autoria, HTTP,
UI e histórico a observações independentes. O adaptador remoto precisa usar
baseline por executor, configuração efetiva e confirmação pós-restauração.
O recorte operacional e tokens permanecem no ambiente protegido existente.
A suíte de readiness conserva seu contrato read-only.
