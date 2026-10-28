# Adaptador legado Carto: patch aprovado e validação

O patch específico foi autorizado pelo usuário, aceito pela revisão obrigatória e aplicado uma vez a `src/pages/Kepler/cloud-providers/carto/carto-provider.ts`. Não houve OAuth real, alteração de conta, credencial nova, migration, flag remota ou operação em Produção. Este executor não faz merge nem habilita auto-merge; a integração das PRs depende do ensaio conjunto e dos gates do SHA publicado.

## Identidade e histórico

| Artefato | SHA-256 |
| --- | --- |
| Arquivo anterior, bytes CRLF | `b7dd0e3186b05ce8dbdbcbdda45e8f80794ace1cb194692643d952f1f6a277d9` |
| Diff autorizado, bytes CRLF | `4c8679bd7cbc3d643781749289b754fa27b85a30e77369b636c0f646f08987ee` |
| Arquivo aplicado, bytes CRLF | `2e26ee67f1f533391fa69d7eaad2621e25e57f4eebccd3021bf9e1ad336f1c6b` |
| Mesmo arquivo, representação LF do Git | `538247cfd2687cd3b7de0d31a770dc657823da80eebea8743e16237b3dce8fec` |

As propostas anteriores foram bloqueadas antes da execução por ampliarem login/logout, persistência e privacidade sem autorização específica suficiente. A segunda negativa dizia: "This applies a broad, behavior-changing Carto production-code patch affecting OAuth/logout, map persistence, privacy URL handling, and error paths; no trusted user authorization for this exact mutation is present." Não houve aplicação indireta depois dessas negativas. A autorização posterior identificou o arquivo, o diff exato acima, os comportamentos e a publicação na PR261. A nova tentativa foi aceita e terminou com código 0; o hash foi conferido após a aplicação. O hash LF não deve ser confundido com o hash dos bytes CRLF do artefato Windows.

## Mudanças aplicadas

- Retira `@ts-nocheck`, declara campos e contratos e mantém a classe `Provider` real como base, com seu prototype e métodos herdados. Não acrescenta cast de recibo ou supressão.
- Constrói o `OAuthApp` real com as opções existentes. O toolkit 0.0.1-rc.18 aceita scopes textual e combina opções parciais na implementação; suas declarações divergem. `Reflect.construct` preserva argumentos e verifica a instância. Client ID ausente mantém o no-op legado.
- Login aguarda OAuth, chama callback opcional e retorna o usuário; rejeições propagam. Logout preserva clear/sync, usa o accessor público do mesmo provider interno e permite callback ausente.
- Upload valida mapa, título/descrição/configuração, alvo de overwrite e owner antes de gravar. Captura owner e mapa corrente antes dos awaits. Mantém argumentos aceitos pelo storage real, sem inventar timestamp ou thumbnail obrigatório.
- Valida recibo completo antes de substituir `currentMap`; falhas preservam a referência anterior. Compartilhamento usa `isprivate` do recibo; overwrite mantém privacidade armazenada, mesmo com o default `isPublic`.
- Download normaliza booleanos e strings true/false, rejeita privacidade ambígua e mantém verificação de owner para mapas privados. Identificadores ausentes continuam sem I/O. Valida visualização e só preserva descrição textual dos datasets.
- URLs usam `isprivate`, aceitam as duas assinaturas e codificam valores da query. Owner ausente produz valor vazio; management URL sem owner é vazia. Datas são ordenadas numericamente.
- CSV rejeita campos nulos e retorno não textual. FileReader rejeita erro ou resultado não textual; não acrescenta validação de MIME.
- Mantém traduções conhecidas e mensagem propagada ao consumidor. Console padrão recebe texto fixo, sem mensagem bruta de OAuth/storage. Isso não afirma sanitização completa de toda mensagem remota para exibição.

## Cobertura e limites

Os contratos executam o adaptador real e a classe base nativa. OAuth, storage, FileReader e formatter são controlados para observar espera, falha, payload, privacidade e preservação de estado. Os mesmos 22 casos passaram com Kepler 3.2.6 e com Kepler 3.2.0 do lock; são execuções sobrepostas, não 44 cenários distintos. Resultados finais de build, navegador, lint e contratos: [product-lint-carto-validation.json](product-lint-carto-validation.json).

O inventário estrito passou de seis para duas referências sintáticas a `error.message`: a variável validada `message` é reutilizada no switch e nos três matches. Isso não significa remoção de quatro exposições ao usuário. Somente o limite correspondente foi reduzido de 6 para 2 em `scripts/user-error-sink-baseline.json`; scanner, regras e demais limites permanecem iguais. Os testes verificam propagação da mensagem esperada e ausência de conteúdo bruto no console.

Nenhum teste simulado constitui aceite de conta Carto real. A integração das PRs e a compatibilidade anterior às migrations dependem do ensaio separado. Reversão: reverter este commit com testes e redução correspondente do baseline; não remover módulos extraídos de outras rodadas isoladamente. Não há dados ou migration a reverter nesta frente.
