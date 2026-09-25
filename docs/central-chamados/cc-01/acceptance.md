# CC-01 — execução e aceite

## Estado de entrega

Implementação técnica preparada para revisão. O aceite final permanece pendente até revisão humana, CT-02, decisões registradas e gates de integração/release aplicáveis. A ausência de prova de produção não é falha de produção comprovada.

| Evidência | Resultado | Limite |
|---|---|---|
| CT-01 — comparação de fonte, branches e deploy observado | Ver [baseline.md](baseline.md) e [baseline.json](baseline.json) | Sem sessão autenticada; schema remoto e SHA de produção não confirmados |
| Consistência dos contratos e referências | [validation.log](evidence/validation.log): 16 endpoints, 3 enums, 10 fontes e 12 invariantes | Validação de fonte, sem exercitar APIs remotas |
| Regressão existente da Central | [ticket-baseline.log](evidence/ticket-baseline.log): 8/8 passaram | Testes locais do código já existente |
| Política de Preview | [preview-safety.log](evidence/preview-safety.log): 23/23 passaram e gate OK | Validação local; não verifica configuração real do Cloudflare |
| Protótipo | [prototype-smoke.json](evidence/prototype-smoke.json): dúvida/incidente, desktop/móvel, sem requests externos ou erros JS | Simulação automatizada local; não substitui CT-02 humano |
| Build do produto | Não executado localmente nesta entrega documental | Resultado eventual do Pages deve ser associado ao SHA da PR |
| Merge/deploy | Não realizados por esta execução | Registrar separadamente no controle |

Os logs ficam em `evidence/`. Mensagens de aprovação automatizada referem-se apenas ao comando executado. São dados de execução local; não contêm aceite de usuário ou credenciais.

Capturas inspecionadas: [dúvida no desktop](evidence/question-desktop.png) e [incidente no celular](evidence/incident-mobile.png). O [manifesto](evidence/manifest.json) registra hashes, comandos, data e limites desta verificação.

## Registro CT-02

Use o roteiro de tarefas em `journey.md`. Registre uma linha por perfil/cenário. Não preencha identidade, data ou resultado antes da execução real. Não use dados pessoais ou anexos reais no protótipo.

| Perfil | Cenário | Participante/data | Próximo passo identificado? | Responsável identificado? | Resultado esperado identificado? | Dificuldade e ajuste | Resultado |
|---|---|---|---|---|---|---|---|
| Solicitante | Dúvida | Pendente | Pendente | Pendente | Pendente | A coletar | Pendente |
| Solicitante | Incidente | Pendente | Pendente | Pendente | Pendente | A coletar | Pendente |
| Atendente | Dúvida | Pendente | Pendente | Pendente | Pendente | A coletar | Pendente |
| Atendente | Incidente | Pendente | Pendente | Pendente | Pendente | A coletar | Pendente |

Aceitar CT-02 somente após os dois perfis concluírem os dois cenários e as dificuldades bloqueantes serem corrigidas ou terem tratamento explicitamente aceito. A simulação deve deixar claro que criação/vinculação de CR não aprova nem aplica mudança.

## Pendências que exigem evidência própria

- Ratificação de ADR-CC-01 e ADR-CC-02 pelo mantenedor e responsável de atendimento.
- Definição dos parâmetros da ADR-CC-10 pela operação; orçamento de latência/volume antes do ensaio de carga correspondente.
- Leitura de binding, identidade do banco e histórico/schema por ambiente quando autorizado; resolver RISK-CC-02 sem presumir migrations aplicadas.
- Revisão da PR e execução de CT-02 pelos perfis reais.
- Registro de merge, release e aceite no controle, quando ocorrerem.

O risco de excesso de previews é mitigado por uma publicação consolidada após as verificações locais. Uma correção adicional, se necessária, deve ser consolidada e justificada na PR.
