# Decisões de implementação CC14

As decisões técnicas abaixo concretizam a execução solicitada. Responsáveis nominais, retenção, budgets, periodicidade editorial e rollout continuam dependentes de aprovação operacional.

## D01 — Estados e independência

Rascunho → revisão → aprovado → publicado. Rejeição retorna a rascunho. Autor e revisor são pessoas diferentes; revisor não altera a revisão que aprova. Aprovação aponta para revisão imutável (título/corpo/audiência/hash), não para texto mutável. Edição ou troca de revisor exige nova revisão editorial. Publicar exige revisor ainda elegível. Retirada remove a referência publicada; republicação exige novo ciclo editorial. Versão publicada anterior permanece disponível durante elaboração de nova versão, até substituição ou retirada explícita.

## D02/D03 — Audiência e origem

Privado: criador e revisor designado, sempre sujeitos a membership ativa e ticket.view. Organização: versão publicada para membros elegíveis. Rascunhos/histórico/decisões ficam restritos à dupla editorial. Não existe bypass administrativo de audiência privada. Não publicar automaticamente ao encerrar um ticket ou restaurar incidente.

Origem é um vínculo privado, imutável e reautorizado: ticket pela CC04; incidente/problema pelo predicado CC13. Nem contagem, placeholder, título ou ID de fonte negada é retornado. Texto é selecionado/redigido pelo humano; anexos/conversas/post-mortem não são copiados. Publicação sanitizada não concede acesso à fonte. O texto livre do artigo exige revisão humana de dados pessoais e segredos.

## D04 — Reuso e envio

Somente revisão **publicada com audiência organização** é sugerida/reutilizada na conversa. Artigos privados não podem ampliar audiência por envio; primeiro devem ganhar nova revisão organizacional aprovada. Seleção durável é vinculada a ator, organização, ticket, kind e revisão. Texto editável permanece no compositor até envio; sair/trocar sessão ou organização descarta o texto local, sem autosave em CC05. Seleção não sobrescreve o rascunho CC05 ordinário nem seus anexos.

No envio, revalidar publicação/revisão, acesso ao ticket, membership, permissões e kind. Retirada/substituição obriga nova seleção/revisão; não desligar proveniência para contornar conflito. Checkbox registra a declaração humana de revisão, não certifica a ausência de dados sensíveis. Corpo final e referência são gravados juntos com evento/outbox. Recibo idempotente preserva resultado de envio confirmado mesmo após retirada; mudança de corpo no replay conflita.

## D05 — Histórico

Revisões, decisões, origem e referências de uso enviado são imutáveis. Correções geram nova revisão. Artigo retirado não reescreve nem recolhe mensagem já enviada; CC05 governa leitura/edição da mensagem. A proveniência só é retornada junto a mensagem já autorizada e não contém conteúdo nem metadados da origem privada. Sem endpoint de purga. Retenção, redação e cleanup de seleções/fixtures continuam pendentes de política específica.

## D06/D07 — Consistência e limites

CAS do agregado; chave idempotente por ator/org/payload; estado/revisão/evento/recibo em D1.batch. Geração CC12 cerca alterações de ACL/membership/fontes e CC14. Grants opcionais role_permissions/user_permissions são capturados antes da autorização e comparados dentro da transação; não se exige criar essas tabelas. Conflitos não publicam efeitos parciais. Snapshots de grants nas leituras detectam alteração durante a resposta.

Título 200 caracteres; conteúdo 12.000; justificativa 1.000; busca 100; HTTP 80.000 bytes. Texto renderizado como texto React, sem HTML/Markdown executável. Páginas: lista/revisões 20; decisões 100. Sem teto de 200 revisões que bloqueie novas mutações. Budgets de D1/CPU/latência, volumes de grants e retenção de seleções devem ser medidos antes de liberar organizações. Geração global conservadora pode provocar conflitos por mudanças paralelas não relacionadas.

## D08 — Operação

Flags inicialmente OFF; rollout exige allowlist/janela, operador revisado, CT45/46 autenticados, carga, cleanup e responsáveis editoriais. Rollback funcional desativa conhecimento preservando ACL e proveniência de mensagens existentes. Não executar down destrutivo ou restauração de banco sem autorização própria.
