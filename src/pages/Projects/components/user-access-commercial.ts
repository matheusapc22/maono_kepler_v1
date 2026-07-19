export type CommercialProfileId =
  | "responsible"
  | "manager"
  | "collaborator"
  | "consultation"
  | "platform_admin"
  | "custom";

export type CommercialProfile = {
  id: CommercialProfileId;
  name: string;
  shortName: string;
  description: string;
  role: string;
  accessLevel: string;
  summary: string;
  platformOnly?: boolean;
};

export type CommercialAccess = {
  code: string;
  name: string;
  description: string;
  group: string;
  risk?: "sensitive" | "irreversible" | "operational" | "platform";
  ownerGrantable?: boolean;
  platformOnly?: boolean;
};

export const COMMERCIAL_PROFILES: CommercialProfile[] = [
  { id: "responsible", name: "Responsável da organização", shortName: "Responsável", description: "Pessoa principal da conta, responsável pela equipe e pelas configurações.", role: "owner", accessLevel: "owner", summary: "gerenciar pessoas, organização, projetos e solicitações permitidas" },
  { id: "manager", name: "Gestor da organização", shortName: "Gestor", description: "Coordena a operação e administra os recursos autorizados.", role: "admin", accessLevel: "editor", summary: "gerenciar a equipe e a operação conforme os acessos atribuídos" },
  { id: "collaborator", name: "Colaborador", shortName: "Colaborador", description: "Executa atividades e atualiza conteúdos da organização.", role: "editor", accessLevel: "editor", summary: "visualizar, criar e editar os recursos liberados" },
  { id: "consultation", name: "Consulta", shortName: "Consulta", description: "Acompanha informações sem alterar conteúdos.", role: "viewer", accessLevel: "viewer", summary: "consultar projetos, documentos, chamados e roadmap liberados" },
  { id: "platform_admin", name: "Administrador da plataforma", shortName: "Administrador da plataforma", description: "Administração global da Maõno.", role: "super_admin", accessLevel: "owner", summary: "acessar recursos administrativos e de auditoria da plataforma", platformOnly: true },
];

export const COMMERCIAL_ACCESSES: CommercialAccess[] = [
  { code: "project.view", name: "Visualizar projetos", description: "Consultar projetos e seus detalhes.", group: "Projetos", ownerGrantable: true },
  { code: "project.create", name: "Criar novos projetos", description: "Iniciar um novo projeto na organização.", group: "Projetos", ownerGrantable: true },
  { code: "project.edit", name: "Editar projetos existentes", description: "Alterar dados e configurações dos projetos.", group: "Projetos", ownerGrantable: true },
  { code: "project.save", name: "Salvar alterações nos projetos", description: "Registrar modificações feitas nos projetos.", group: "Projetos", ownerGrantable: true },
  { code: "project.favorite", name: "Organizar favoritos", description: "Adicionar ou remover projetos da lista de favoritos.", group: "Projetos", ownerGrantable: true },
  { code: "document.view", name: "Consultar documentos", description: "Ver a lista de documentos da organização.", group: "Arquivos e documentos", ownerGrantable: true },
  { code: "document.upload", name: "Enviar documentos", description: "Adicionar novos arquivos à organização.", group: "Arquivos e documentos", ownerGrantable: true },
  { code: "document.download", name: "Baixar documentos", description: "Fazer download de arquivos autorizados.", group: "Arquivos e documentos", ownerGrantable: true },
  { code: "document.delete", name: "Excluir documentos", description: "Remover arquivos da organização.", group: "Arquivos e documentos", risk: "irreversible", ownerGrantable: true },
  { code: "ticket.view", name: "Acompanhar chamados", description: "Ver chamados e o andamento do atendimento.", group: "Central de chamados", ownerGrantable: true },
  { code: "ticket.create", name: "Abrir novos chamados", description: "Registrar novas solicitações de suporte.", group: "Central de chamados", ownerGrantable: true },
  { code: "ticket.manage", name: "Gerenciar chamados", description: "Alterar situação, prioridade e atendimento dos chamados.", group: "Central de chamados", risk: "operational" },
  { code: "roadmap.view", name: "Consultar roadmap", description: "Acompanhar etapas, tarefas e prazos do serviço.", group: "Roadmap", ownerGrantable: true },
  { code: "roadmap.comment.create", name: "Comentar no roadmap", description: "Registrar observações e interações nas tarefas.", group: "Roadmap", ownerGrantable: true },
  { code: "roadmap.manage", name: "Gerenciar roadmap", description: "Criar, editar, reprogramar e concluir tarefas do roadmap.", group: "Roadmap", risk: "operational" },
  { code: "users.view", name: "Consultar equipe", description: "Ver pessoas e perfis da organização.", group: "Equipe e acessos", risk: "sensitive", ownerGrantable: true },
  { code: "users.create", name: "Adicionar pessoas", description: "Criar novos acessos para a organização.", group: "Equipe e acessos", risk: "sensitive" },
  { code: "users.edit", name: "Atualizar dados das pessoas", description: "Alterar nome e informações básicas.", group: "Equipe e acessos", risk: "sensitive" },
  { code: "users.disable", name: "Suspender acessos", description: "Bloquear temporariamente a entrada de uma pessoa.", group: "Equipe e acessos", risk: "sensitive" },
  { code: "users.manage_access", name: "Administrar acessos", description: "Definir o que cada pessoa pode fazer.", group: "Equipe e acessos", risk: "sensitive" },
  { code: "role.assign", name: "Alterar perfil de participação", description: "Trocar o perfil comercial da pessoa.", group: "Equipe e acessos", risk: "sensitive" },
  { code: "organization.view", name: "Consultar dados da organização", description: "Ver informações gerais da organização.", group: "Organização e capacidade", ownerGrantable: true },
  { code: "organization.edit", name: "Atualizar dados da organização", description: "Modificar dados autorizados da organização.", group: "Organização e capacidade", risk: "sensitive" },
  { code: "organization.metrics.view", name: "Consultar indicadores da organização", description: "Ver números e métricas operacionais.", group: "Organização e capacidade", ownerGrantable: true },
  { code: "limits.view", name: "Consultar limites do plano", description: "Ver capacidades contratadas e utilização atual.", group: "Organização e capacidade", ownerGrantable: true },
  { code: "limits.increase_request", name: "Solicitar mais capacidade", description: "Pedir aumento de pessoas, projetos ou armazenamento.", group: "Organização e capacidade", ownerGrantable: true },
  { code: "admin.panel.access", name: "Acessar administração da plataforma", description: "Entrar na área administrativa da Maõno.", group: "Administração Maõno", risk: "platform", platformOnly: true },
  { code: "audit.view", name: "Consultar histórico de atividades", description: "Ver registros de ações e mudanças.", group: "Administração Maõno", risk: "platform", platformOnly: true },
];

export function profileFromTechnical(role: unknown, accessLevel: unknown): CommercialProfile | null {
  const normalizedRole = String(role || "viewer").toLowerCase();
  const normalizedAccess = String(accessLevel || "viewer").toLowerCase();
  return COMMERCIAL_PROFILES.find((item) => item.role === normalizedRole && item.accessLevel === normalizedAccess) ??
    (normalizedRole === "client" && normalizedAccess === "owner" ? COMMERCIAL_PROFILES[0] : null);
}

export function accessFromCode(code: string): CommercialAccess {
  return COMMERCIAL_ACCESSES.find((item) => item.code === code) ?? {
    code,
    name: "Acesso personalizado",
    description: "Capacidade existente preservada nesta configuração.",
    group: "Outros acessos",
  };
}

export function riskLabel(risk?: CommercialAccess["risk"]): string | null {
  if (risk === "sensitive") return "Acesso sensível";
  if (risk === "irreversible") return "Ação irreversível";
  if (risk === "operational") return "Controle operacional";
  if (risk === "platform") return "Exclusivo Maõno";
  return null;
}
