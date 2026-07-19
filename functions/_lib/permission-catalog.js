export const ACCESS_DELEGATION_PERMISSION =
  "organization.users.permissions.delegate";

const CATALOG = Object.freeze([
  { code: "document.view", name: "Consultar documentos", group: "Documentos", risk: "standard", ownerDelegable: true },
  { code: "document.upload", name: "Enviar documentos", group: "Documentos", risk: "operational", ownerDelegable: true },
  { code: "document.download", name: "Baixar documentos", group: "Documentos", risk: "standard", ownerDelegable: true },
  { code: "document.delete", name: "Excluir documentos", group: "Documentos", risk: "irreversible", ownerDelegable: true },
  { code: "ticket.view", name: "Acompanhar chamados", group: "Chamados", risk: "standard", ownerDelegable: true },
  { code: "ticket.create", name: "Abrir chamados", group: "Chamados", risk: "operational", ownerDelegable: true },
  { code: "ticket.comment", name: "Comentar em chamados", group: "Chamados", risk: "operational", ownerDelegable: true },
  { code: "export.view", name: "Consultar exportações", group: "Exportações", risk: "standard", ownerDelegable: true },
  { code: "export.create", name: "Criar exportações", group: "Exportações", risk: "operational", ownerDelegable: true },
  { code: "users.view", name: "Consultar equipe", group: "Equipe", risk: "sensitive", ownerDelegable: true },
  { code: "organization.view", name: "Consultar organização", group: "Organização", risk: "standard", ownerDelegable: true },
  { code: "organization.metrics.view", name: "Consultar indicadores", group: "Organização", risk: "standard", ownerDelegable: true },
  { code: "limits.view", name: "Consultar limites", group: "Limites", risk: "standard", ownerDelegable: true },
  { code: "limits.increase_request", name: "Solicitar capacidade", group: "Limites", risk: "operational", ownerDelegable: true },
  { code: "organization.projects.geojson.view", name: "Visualizar GeoJSON amplo", group: "Projetos", risk: "sensitive", ownerDelegable: false, superAdminOnly: true, reason: "Somente Super Admin." },
  { code: ACCESS_DELEGATION_PERMISSION, name: "Delegar acessos da organização", group: "Governança", risk: "sensitive", ownerDelegable: false, superAdminOnly: true, reason: "A meta-permissão nunca é delegável." },
  { code: "admin.panel.access", name: "Acessar administração global", group: "Plataforma", risk: "platform", ownerDelegable: false, superAdminOnly: true, reason: "Acesso global da plataforma." },
  { code: "audit.view", name: "Consultar auditoria", group: "Plataforma", risk: "platform", ownerDelegable: false, superAdminOnly: true, reason: "Auditoria não integra o teto organizacional." },
]);

const BY_CODE = new Map(CATALOG.map((item) => [item.code, item]));

export function permissionCatalog() {
  return CATALOG.map((item) => ({
    scope: "organization",
    targetLevels: item.ownerDelegable ? ["viewer", "editor"] : [],
    ...item,
  }));
}

export function ownerDelegablePermissions() {
  return CATALOG.filter((item) => item.ownerDelegable).map((item) => item.code);
}

export function getPermissionMetadata(permission) {
  return BY_CODE.get(String(permission || "")) || null;
}

export function isOwnerDelegablePermission(permission) {
  return getPermissionMetadata(permission)?.ownerDelegable === true;
}
