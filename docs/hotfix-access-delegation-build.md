# Hotfix — build da governança de acessos

## Problema

O build de produção falhava em `AdminUserManager.tsx` porque o TypeScript inferia o valor do `Map` de permissões como `{}`, impedindo o acesso a `canGrant` e `canRevoke`.

## Correção

- adiciona o tipo explícito `DelegationPermission`;
- tipa o `Map` como `Map<string, DelegationPermission>`;
- preserva a tupla `[permission, item]` com `as const`;
- adiciona teste de regressão para impedir a remoção acidental da tipagem.

## Resultado esperado

O painel de delegação mantém o mesmo comportamento funcional, enquanto o build volta a compilar sem os erros TS2339 registrados no deployment do PR #24.
