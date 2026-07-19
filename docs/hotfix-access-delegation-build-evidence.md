# Evidência do erro corrigido

O deployment que incorporou o PR #24 falhou durante `yarn build` com os erros:

- `TS2339: Property 'canGrant' does not exist on type '{}'`;
- `TS2339: Property 'canRevoke' does not exist on type '{}'`.

A correção deste hotfix explicita o tipo do valor armazenado no mapa de permissões e mantém a entrada como tupla somente leitura, permitindo que o TypeScript reconheça `canGrant` e `canRevoke` de forma segura.
