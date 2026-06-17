# Sprint 6 — Backend e D1 para permissões granulares

## Arquivos

Criar/substituir:

- `migrations/0005_permissions_granular.sql`
- `functions/_lib/permissions.js`

## Aplicar no banco local

```bat
npx wrangler d1 execute maono_maps --local --file=migrations/0005_permissions_granular.sql
```

Validar tabelas novas:

```bat
npx wrangler d1 execute maono_maps --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('role_permissions','user_permissions','organization_limits','organization_feature_flags','tickets','ticket_comments','audit_logs');"
```

## Banco oficial

Não aplique direto no banco oficial antes de validar localmente.

Depois da validação local e revisão humana, o comando remoto segue o mesmo arquivo com `--remote`:

```bat
npx wrangler d1 execute maono_maps --remote --file=migrations/0005_permissions_granular.sql
```

## Uso básico em endpoints

```js
import { requireProjectPermission } from "../../_lib/permissions.js";

const { user, context } = await requireProjectPermission(
  env,
  request,
  "project.favorite",
  slug,
  {
    auditAction: "project.favorite",
    resourceType: "project"
  }
);
```

Para permissão por organização:

```js
import { requirePermission } from "../_lib/permissions.js";

const { user } = await requirePermission(
  env,
  request,
  "users.create",
  { organizationId },
  {
    auditAction: "users.create",
    resourceType: "user"
  }
);
```

## Decisões implementadas

- `super_admin` tem acesso global.
- `admin` depende de permissão explícita em `user_permissions` ou `role_permissions`.
- `owner` é limitado à organização.
- `editor` e `viewer` são restritos por padrão.
- `project.save` depende de acesso de projeto `editor`/`owner` ou permissão explícita.
- O backend nega por padrão.
- Eventos sensíveis podem ser registrados em `audit_logs`.

## Próxima etapa

Depois desta base, aplique `requirePermission(...)` endpoint por endpoint, começando por:

1. `functions/api/projects/[slug]/favorite.js`
2. `functions/api/projects/[slug]/config.js`
3. endpoints de admin/users/organizations
4. endpoints de documentos/exportações/chamados
