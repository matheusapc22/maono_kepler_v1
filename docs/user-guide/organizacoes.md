# Gestão de Organizações — Manual de funcionamento

**Candidato em revisão. Gates locais documentados; lint global bloqueado por baseline. Consulte CI por SHA na PR draft.**

Base inspecionada: `e47deac18888195b945a244dadb9e27c5902638f`.

## 01. Antes de usar
Estado da entrega e condições de acesso

Esta revisão acompanha a branch feat/admin-organizations-management reconciliada com o produto após a PR 253. Passaram 545 regressões locais, TypeScript, build e os testes de navegador. O lint global possui falhas preexistentes; a entrega permanece candidata em PR draft. Não houve merge desta funcionalidade, deploy direto ou ativação em Produção.

> Estado: candidato para revisão. O CI do SHA publicado e suas limitações estão na PR. Testes locais não certificam D1, Dropbox, Preview ou Produção.

### Quem pode acessar

O módulo é destinado ao Super Admin. O servidor verifica a autorização, e cada item de uma operação coletiva passa por nova validação. A autonomia para gerir organizações não concede acesso global a proprietários, editores ou usuários de consulta.

### Como chegar à subaba

1. Entre na plataforma com uma conta autorizada.
2. Abra Painel Admin e selecione Gestão de Organizações na barra lateral.
3. Aguarde os indicadores e a tabela. Dados não recebidos aparecem como indisponíveis, não como zero.

### O que precisa estar preparado

| Camada | Condição |
| --- | --- |
| Interface | Build com VITE_ORGANIZATION_MANAGEMENT_V1=true. |
| Servidor | ORGANIZATION_MANAGEMENT_V1=true e schema de gestão completo. |
| Capacidade de projetos | PROJECT_QUOTA_RESERVATION_V1=true para criação e edição operacional de planos/quotas. |
| Banco | Migration candidata 0042 previamente revisada e aplicada no ambiente de QA autorizado. Em Produção, seguir o operador protegido do repositório. |

Com a flag da interface desligada, o Admin mantém a tabela anterior. Com o servidor ou o schema indisponível, a API retorna erro explícito e não simula sucesso. O fluxo legado foi testado antes da 0042, com a flag ausente e desligada. A aplicação remota está adiada; esta PR não a executa nem agenda.

## 02. A tela principal
Indicadores, tabela e significado dos dados

A subaba utiliza o shell compacto existente: logo, usuário, breadcrumb e navegação permanecem. No cabeçalho aparecem Solicitações, Importar e Nova organização. Não há botão geral Atualizar; a consulta é revalidada após operações e pode ser repetida quando ocorre um erro.

| Indicador global | Como interpretar |
| --- | --- |
| Organizações | Todas as organizações do escopo administrativo, inclusive pausadas. |
| Ativas | Organizações com estado ativo. O percentual usa o mesmo total do primeiro indicador. |
| Usuários totais | Pessoas distintas com conta ativa e vínculo em organização ativa. Uma pessoa em duas organizações conta apenas uma vez. |
| Arquivos | Arquivos ativos vinculados a organizações, com status ACTIVE, fora da lixeira e não expurgados. Não soma revisões binárias internas. |

### Os filtros não alteram os indicadores globais

A busca modifica as linhas da tabela e a quantidade exibida no rodapé. Os quatro indicadores continuam mostrando o escopo global. Essa diferença evita interpretar uma página de dez registros como se fosse toda a plataforma.

### Como ler uma linha

A organização apresenta nome e identificador, plano, responsável principal, contagens de projetos/pessoas/arquivos, estado administrativo, estado técnico de armazenamento e última atividade do novo módulo. Clicar no nome abre o painel de gestão.

> “Não definido” no responsável e “Sem registro” na atividade são estados reais. O módulo não escolhe o primeiro usuário como responsável nem inventa datas históricas.

As ações por linha abrem Pessoas, Documentos, Plano e limites ou Dados gerais. O histórico consultado nesta versão cobre eventos registrados a partir da nova gestão e alterações detectadas depois da migration.

## 03. Buscar e organizar
Filtros, paginação, seleção e exportação

### Buscar e aplicar filtros

1. Digite parte do nome ou do identificador da organização.
2. Escolha Ativas, Pausadas ou Todos os status. Selecione o plano e a ordenação.
3. Pressione Aplicar. A consulta começa na primeira página. Limpar filtros restaura os padrões.

A ordenação oferece Mais recentes, Nome A–Z e Cadastro atualizado. As opções de página são 10, 20 ou 50 registros. O servidor também limita o tamanho da página; não existe seleção automática de toda a base.

### Navegação preservada

Os filtros aplicados, a página, o painel selecionado e a operação aberta usam parâmetros próprios na URL. Voltar e avançar no navegador recuperam esse contexto. Ao retornar de Pessoas, use Voltar às organizações. A preservação visual de scroll deve ser conferida na homologação de navegador.

### Selecionar linhas

O checkbox do cabeçalho seleciona somente os registros carregados na página atual. O texto informa “selecionados nesta página”. Aplicar uma consulta diferente ou mudar de página limpa a seleção para impedir uma ação sobre itens que deixaram de estar visíveis.

### Exportar seleção

1. Marque as organizações desejadas.
2. Use Exportar seleção.
3. O navegador salva um CSV com ID, nome, identificador, plano, estado e contagens.

A exportação representa a seleção autorizada já carregada; não inclui arquivos, senhas ou conteúdo de documentos. O código neutraliza células que poderiam ser interpretadas como fórmulas por uma planilha.

> Não trate um CSV exportado como uma cópia completa de segurança. Ele contém apenas os campos do cadastro apresentados na tabela.

## 04. Criar organização
Cadastro, responsável e preparação de armazenamento

1. Selecione Nova organização.
2. Informe nome, identificador, descrição opcional, plano e e-mail de um usuário existente e ativo.
3. Revise a confirmação de cadastro e vínculo de proprietário.
4. Pressione Criar organização e acompanhe o resultado por item na própria tela.

| Campo | Regra |
| --- | --- |
| Nome | Obrigatório; até 160 caracteres. |
| Identificador | Até 64 caracteres; letras minúsculas, números e hífens. Define a identidade técnica da nova organização. |
| Descrição | Opcional; até 3.000 caracteres. |
| Plano | Básico (free), Profissional (pro) ou Empresarial (enterprise). |
| Responsável | Conta existente e ativa. Recebe vínculo owner na nova organização, sem alteração do papel global. |

O servidor define a pasta de armazenamento. O formulário não aceita uma raiz Dropbox arbitrária nem cria credenciais de usuário. Identificador ou pasta já pertencentes a outro cadastro são rejeitados, inclusive em importações.

### Quando o cadastro existe, mas a preparação não terminou

O resultado pode ser Parcial: a organização foi persistida, porém o armazenamento ou a configuração inicial ainda não foram confirmados. O número do registro é mostrado quando conhecido. Não crie outra organização com outro nome para contornar a mensagem.

> Use Minhas operações para consultar a tentativa. Retome apenas itens marcados como recuperáveis. A retomada da mesma criação utiliza a identidade da operação e não deve criar um cadastro duplicado.

O botão pode ficar indisponível quando a quota operacional de projetos não está habilitada. Essa condição exige preparação do ambiente pelo operador técnico; o usuário não deve tentar resolver ativando flags por conta própria.

## 05. Editar dados e responsável
Rascunhos, versões e proteção contra sobrescrita

### Dados gerais

1. Clique no nome da organização ou na ação de edição.
2. Na área Dados gerais, altere nome ou descrição. O identificador permanece somente para leitura.
3. Informe uma justificativa de 5 a 500 caracteres e pressione Salvar dados.
4. Confira a operação registrada e consulte a versão atual antes de iniciar outra alteração sobre o mesmo cadastro.

Renomear não muda a pasta nem move documentos. Alterações de identificador ou raiz técnica não fazem parte desse formulário. A versão carregada acompanha a gravação para detectar alterações concorrentes.

### Quando outra pessoa alterou o cadastro

A gravação com versão antiga é recusada. O formulário continua com o conteúdo digitado; não há sobrescrita automática da alteração de outra pessoa. Consultar versão atual substitui o formulário depois de confirmação: copie antes o que deseja reaproveitar.

### Designar responsável principal

1. Abra Pessoas dentro do painel da organização.
2. Escolha um usuário ativo que já tenha vínculo de proprietário na organização.
3. Informe a justificativa e pressione Designar responsável.

A designação não altera o papel global do usuário e não remove o proprietário anterior. As proteções do banco exigem substituição do responsável principal antes de remover seu vínculo, rebaixar esse vínculo ou desativar a conta.

> Não confunda “responsável principal” com “Super Admin”. A primeira designação é restrita à organização; a segunda é um papel global da plataforma.

## 06. Pausar e reativar
Interrupção reversível, sem excluir recursos

### Pausar uma organização

1. Abra a organização e selecione Pausar organização.
2. Leia a confirmação com o nome do cadastro.
3. Confirme e acompanhe o resultado. A alteração usa atualização do ciclo de vida, não DELETE.

A pausa mantém pessoas, projetos, arquivos e histórico. Com o módulo habilitado, operações de sessões existentes reconsultam o estado da organização e bloqueiam o contexto pausado. O Admin conserva o acesso para recuperação; outros contextos elegíveis continuam disponíveis. Esse comportamento foi verificado localmente com sessões e permissões reais.

### Reativar ou verificar o armazenamento

Na organização pausada, use Reativar / verificar armazenamento. Se o cadastro estiver ativo e o armazenamento pendente, consulte a versão atual e use Verificar armazenamento. O resultado permanece Parcial até confirmar prontidão. Pastas legadas incompatíveis exigem revisão operacional; a tela não muda a raiz silenciosamente.

| Estado | Significado |
| --- | --- |
| Ativa / Pausada | Situação administrativa da organização. |
| Pronto | Estado técnico READY, ACTIVE ou CONFIGURED informado pelo serviço. |
| Preparando | Provisionamento técnico PENDING. |
| Falha | Estado técnico de falha registrado. |
| Desativado | Armazenamento marcado DISABLED após a pausa. |
| Não informado | Ausência de um estado técnico reconhecido; não significa pronto. |

> Não há exclusão permanente ou remoção de pasta Dropbox nesta tela. O endpoint destrutivo legado não é utilizado para a pausa.

Se uma reativação ficar parcial, consulte a versão atual e execute uma nova verificação autorizada. Operações sem confirmação não devem ser repetidas cegamente.

## 07. Plano e quota de projetos
Uma política de capacidade, sem cobrança automática

Em Plano e limites, a tela mostra o uso de projetos, as reservas ativas e a capacidade restante. Os valores usam o mesmo resolvedor operacional de política de projetos, em vez de um catálogo independente da interface.

1. Abra Plano e limites e confira a origem da quota, uso e reservas.
2. Para manter o limite herdado, deixe desmarcada a opção de limite específico. Para criar um override, marque-a e informe a quantidade.
3. Revise plano, limite e justificativa. Desmarcar um override existente restaura a herança.
4. Pressione Salvar plano e quota e acompanhe a operação.

Mudar apenas o plano preserva defaults e overrides não editados. Uma redução abaixo de projetos em uso e reservas válidas é bloqueada. Reservas iniciadas com uma versão antiga da política são recusadas; os recursos existentes não são apagados para reduzir o uso.

| Recurso | Comportamento desta versão |
| --- | --- |
| Projetos | Limite editável com quota operacional habilitada, controle de versão e consideração de reservas. |
| Armazenamento | Uso e limite informativos; não editáveis neste módulo. |
| Usuários e exportações | Sem edição de limite no novo painel. Não são apresentados como capacidade efetivamente aplicada por este código. |
| Planos | Identificadores free, pro e enterprise, com rótulos comerciais uniformes. |
| Cobrança | Não há integração financeira, pagamento ou alteração automática de assinatura. |

> Não habilite a quota de projetos em Produção apenas para liberar um botão. A ativação depende da revisão e do processo operacional da plataforma.

A revisão local cobre herança, overrides, concorrência entre quota e reserva, aprovação de pedidos e preservação de recursos. A validação remota exige uma etapa operacional separada.

## 08. Pessoas e documentos
Reutilização das áreas existentes da plataforma

### Pessoas

O painel lista os membros da organização, seu e-mail, nível de vínculo e situação da conta. Gerenciar vínculos e permissões abre a área existente de Usuários e Permissões já filtrada pela organização.

1. Abra Pessoas na linha desejada.
2. Use Gerenciar vínculos e permissões para acessar o gerenciador existente.
3. Faça a operação permitida por esse gerenciador.
4. Use Voltar às organizações para recuperar o contexto da subaba.

O atalho de pessoas não muda silenciosamente a organização ativa da sessão. As regras de último proprietário e atribuição de owner devem permanecer válidas nas operações existentes.

### Documentos

Nesta versão, Documentos mostra uma lista de arquivos ativos do cadastro selecionado, paginada em grupos de vinte. O carregamento ocorre somente ao abrir essa área, sem consultar Dropbox para preencher todas as linhas da tabela principal.

1. Abra Documentos na organização.
2. Confira os arquivos e use Carregar mais documentos quando disponível.
3. Para enviar, mover, criar pastas ou usar a lixeira, selecione Abrir esta organização em Projetos.
4. Confirme a mudança de organização ativa. Em Projects, escolha Arquivos e Documentos.

> A consulta de documentos no painel é somente leitura. Não foi criado um segundo sistema de upload, lixeira ou edição de configurações de mapas. O gerenciamento continua na experiência existente.

O botão de encaminhamento fica indisponível para organização pausada. A troca de contexto usa a sessão existente e pode ser recusada pelo servidor se o acesso não for elegível.

## 09. Solicitações
Pedidos reais, revisão e aplicação da decisão

O botão Solicitações apresenta a quantidade real de pedidos pendentes de plano e limites. O painel permite alternar entre Pendentes, Aprovadas e Recusadas, com vinte registros por página.

1. Selecione o pedido e confira organização, solicitante, justificativa e plano solicitado.
2. Para um pedido de quota de projetos, informe o limite aprovado.
3. Escreva uma justificativa da decisão com 5 a 500 caracteres.
4. Escolha Aprovar e aplicar ou Recusar e confirme a ação.

### Aprovar e aplicar

Para planos e aumento da quota de projetos, a decisão e a alteração de política são gravadas na mesma transação, com versões do pedido e da organização. Se a precondição falhar, a solicitação não deve ficar aprovada sem a política correspondente.

### Recusar

A recusa registra revisor, data e justificativa, sem alterar o plano ou a quota. A decisão também entra no histórico administrativo. Um pedido já revisado não pode ser aplicado novamente como se ainda estivesse pendente.

| Tipo de solicitação | Disponibilidade |
| --- | --- |
| Plano (plan_upgrade) | Consulta, aprovação com aplicação e recusa. |
| Projetos (projects_increase) | Consulta, revisão do limite, aprovação com aplicação e recusa. |
| Usuários, armazenamento ou exportações | Consulta e recusa; aprovação operacional não implementada nesta versão. |

> A tela não usa o contador fixo da antiga subaba Solicitações. Também não inventa uma fila de criação de organizações. O botão tem finalidade delimitada a pedidos de plano e capacidade.

O schema de pedidos é compatibilizado pela migration candidata. A aplicação em um banco remoto exige conferir suas colunas reais antes de executar qualquer alteração.

## 10. Importar organizações
CSV validado antes da criação

Importar recebe um CSV UTF-8 de novas organizações. A primeira versão aceita até 100 linhas de dados e 128 KiB por arquivo. Ela não atualiza registros já existentes silenciosamente.

```text
nome,slug,descricao,plano,responsavel_email
Empresa QA,empresa-qa,Exemplo sintético,free,qa@example.test
```

1. Use Baixar modelo e preencha as cinco colunas, sem alterar o cabeçalho.
2. Escolha o arquivo e pressione Validar arquivo.
3. Revise o resultado de cada linha. Corrija duplicidades, planos inválidos e responsáveis inexistentes ou inativos.
4. Marque a confirmação dos vínculos de proprietário.
5. Pressione Confirmar importação e acompanhe os resultados por organização.

A prévia faz leituras e validações, mas não cria organizações. No momento da execução, cada linha é validada novamente: um arquivo que passou na prévia pode encontrar um conflito criado por outra operação nesse intervalo.

### Retomar sem repetir cadastros

A operação e seus itens ficam registrados no servidor. A tela processa uma etapa por vez, mantendo o progresso confirmado. Depois de uma interrupção, abra Minhas operações, selecione a tentativa e use Continuar pendências ou Retomar próximo item recuperável.

> Não há processamento em background após fechar a página. Os próximos itens só avançam quando a tela volta a enviar etapas. Um item em processamento precisa concluir ou ter sua reserva de execução expirada antes da retomada.

O importador não recebe senhas, papéis globais, URLs externas ou caminhos técnicos arbitrários. Dados pessoais do arquivo não são armazenados em localStorage nem em cache público; o payload operacional fica no servidor para a retomada autorizada.

## 11. Ações em lote e operações
Resultados individuais, continuidade e recuperação

### Executar um lote

1. Selecione organizações na página atual e abra Ações em lote.
2. Escolha Pausar ou Reativar. Revise nomes e quantidade.
3. Informe uma justificativa e marque a confirmação.
4. Execute o lote e confira cada resultado.

Cada organização passa por autorização e versão próprias. Uma falha em um item não é apresentada como sucesso do conjunto. Também não há promessa de uma transação global que abranja várias organizações e o Dropbox.

| Resultado | Ação do operador |
| --- | --- |
| Pendente | Usar Continuar pendências. |
| Em processamento | Consultar novamente; uma etapa ativa não deve ser executada duas vezes. |
| Concluído | Operação confirmada para esse item. |
| Parcial | Cadastro ou estado salvo, mas alguma etapa não foi confirmada. Ler a mensagem e o ID. |
| Falhou | Ler o motivo. Conflito de versão exige revisão; não repetir o mesmo rascunho automaticamente. |

### Minhas operações

O botão lista as vinte tentativas mais recentes da conta atual. Abrir uma operação apenas consulta seu estado; o processamento depende de continuar explicitamente. O endereço contém a referência da tentativa para recuperação.

Retomar próximo item recuperável trata um item elegível por clique. Operações concluídas não são executadas novamente. A chave da tentativa relaciona ator, tipo e conteúdo, rejeitando o uso da mesma chave para outro pedido.

> O resultado “Parcial” não autoriza apagar o cadastro como rollback. Primeiro consulte o registro e o armazenamento. A tela não fornece exclusão definitiva em lote.

## 12. Histórico, erros e segurança
Rastreabilidade e ações diante de falhas

### Histórico

A aba Histórico apresenta eventos reais do novo módulo: criação, configuração, edição, pausa, reativação, política e decisão de pedidos. São mostrados tipo, ator quando conhecido, justificativa, data/hora e versão. A paginação usa o último evento como referência.

Alterações realizadas por caminhos legados depois da migration invalidam a versão de gestão e podem aparecer como operação legada sem atribuição de ator. Eventos antigos não são reconstruídos nem agregados retrospectivamente nesta entrega.

| Situação | Conduta |
| --- | --- |
| Sessão expirada ou acesso negado | A tela retira dados do contexto e oferece nova entrada. Não insistir com uma operação de outra conta. |
| Versão alterada | Preservar o rascunho, consultar a versão atual e revisar antes de salvar. |
| Duplicidade | Escolher um identificador realmente novo ou consultar o cadastro existente. |
| Armazenamento parcial | Consultar Minhas operações e retomar somente quando o resultado indicar recuperação permitida. |
| Limite abaixo do uso | Rever o valor; não excluir recursos para contornar a regra. |
| Feature/schema indisponível | Solicitar a preparação controlada do ambiente; não alterar flags ou migrations sem autorização. |

### Proteções deliberadas

Não há elevação de papel global, mudança silenciosa de pasta, exclusão permanente, cache público de dados administrativos ou disparo de migration pela interface. As gravações exigem origem compatível, JSON, autorização e identificação da operação.

> Reverter o código não reverte os dados já gravados. Quotas, vínculos, eventos e pastas precisam ser tratados por procedimentos próprios de recuperação.

## 13. Entrega técnica e validação
Evidência local de 27/10/2026; limites de aceite

| Verificação | Resultado desta revisão |
| --- | --- |
| Node e SQLite | 545 testes aprovados; 2 skips de scripts Bash no Windows. Inclui 17 integrações do módulo com schema, sessão, ACL, lifecycle e quotas do produto; três cenários cobrem o banco anterior à 0042. |
| Frontend | TypeScript e build completos aprovados. Lint dos 10 arquivos TS/TSX do escopo: sem erros ou avisos. |
| Navegador | 20 casos locais: 19 no build compilado com flag ligada e um no servidor dev com flag desligada. Cinco viewports, toque, teclado/foco, filtros/URL, revogação, resposta atrasada, CSV e falhas seguras. Quatro fluxos usam handlers reais. |
| Lint global | 109 erros e 44 avisos anteriores. Todos os arquivos com problemas e a configuração são iguais à base do produto. Nenhuma regra foi relaxada. |
| Escala local | 6, 50 e 500 organizações; 30 amostras após aquecimento. p50/p95 e statements registrados em docs/ops/organization-management-benchmark.json. Não mede latência de rede nem rows_read do D1. |
| CI e ambientes | Consultar o resultado por SHA na PR draft. Nenhuma homologação em Preview, Produção ou provedor real; nenhuma migration remota executada. |

### Limitações que permanecem

O histórico anterior à migration não foi incorporado. Documentos são apenas consulta. Usuários, armazenamento e exportações não têm quota editável. Lotes não avançam após fechar a página. Não houve teste humano com leitor de tela nem comparação com a imagem aprovada, que não foi fornecida.

> A migration 0042 foi testada somente em SQLite isolado. Reverter código não desfaz quotas, vínculos, eventos ou pastas; as proteções SQL continuam presentes. Produção exige o processo protegido do repositório.

Base do produto: e47deac18888195b945a244dadb9e27c5902638f. Consulte a matriz de critérios e os detalhes de evidência em docs/ops/organization-management-acceptance.md.
