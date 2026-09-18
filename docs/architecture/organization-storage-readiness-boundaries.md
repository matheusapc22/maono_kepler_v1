# Organization Storage Readiness Boundaries — PRH-06

| Superfície | Classe | Regra |
| --- | --- | --- |
| `GET /api/organizations/:id/files` | D1_ONLY | Lista metadata do D1 e apenas reporta readiness. Não chama provider e não faz healing. |
| `POST /api/organizations/:id/files` | STORAGE_WRITE | Exige READY antes de upload; não inicia healing no request. |
| `GET /api/organizations/:id/files/:fileId/download` | STORAGE_READ | Exige READY imediatamente antes do download físico. |
| `DELETE /api/organizations/:id/files/:fileId` | STORAGE_WRITE | Se houver objeto físico, exige READY antes da exclusão no provider. |
| Ticket attachments: iniciar/criar/download/delete ativo | STORAGE_WRITE/READ | Exige READY; criação de subpasta de attachment é parte da operação já autorizada, não healing do lifecycle. |
| `GET/POST /api/admin/organizations/:id/files` | STORAGE_READ/WRITE | Superfície física de Dropbox; exige READY. |
| `POST /api/admin/organizations/repair-storage` | RECOVERY_ADMIN | Healing explícito e auditado; suporta dry-run, fair order e backoff. |
| Worker `organization-storage-recovery` | RECOVERY_BACKGROUND | Healing agendado, sem sessão de usuário, protegido por feature flag/kill switch/dry-run. |
| `GET /api/dropbox/list` | STORAGE_READ_GLOBAL_ADMIN | Operação global de provider sem contexto de organização; não usa organization readiness. |

Princípio: **readiness é leitura de estado sem side effect; recovery é uma operação explícita separada**.
