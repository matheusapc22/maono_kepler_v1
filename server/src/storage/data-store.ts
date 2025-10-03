import type { Prisma, PrismaClient } from '@prisma/client';

type UserCreateInput = Pick<Prisma.UserUncheckedCreateInput, 'email' | 'name'>;
type UserUpdateParams = Partial<Pick<Prisma.UserUncheckedUpdateInput, 'email' | 'name'>>;
type ProjectCreateInput = Pick<Prisma.ProjectUncheckedCreateInput, 'name' | 'description' | 'ownerId'>;
type ProjectUpdateParams = Partial<Pick<Prisma.ProjectUncheckedUpdateInput, 'name' | 'description'>>;
type LayerCreateInput = Pick<Prisma.LayerUncheckedCreateInput, 'name' | 'type' | 'config' | 'projectId'>;
type LayerUpdateParams = Partial<Pick<Prisma.LayerUncheckedUpdateInput, 'name' | 'type' | 'config'>>;

export class DataStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listUsers() {
    return this.prisma.user.findMany({
      include: {
        projects: {
          include: {
            layers: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        projects: {
          include: { layers: true },
        },
      },
    });
  }

  async createUser(input: UserCreateInput) {
    return this.prisma.user.create({ data: input });
  }

  async updateUser(id: string, input: UserUpdateParams) {
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (typeof input.email !== 'undefined') data.email = input.email;
    if (typeof input.name !== 'undefined') data.name = input.name;

    return this.prisma.user.update({ where: { id }, data });
  }

  async listProjects() {
    return this.prisma.project.findMany({
      include: {
        owner: true,
        layers: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listProjectsByUser(userId: string) {
    return this.prisma.project.findMany({
      where: { ownerId: userId },
      include: { layers: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findProjectById(id: string) {
    return this.prisma.project.findUnique({
      where: { id },
      include: { owner: true, layers: true },
    });
  }

  async createProject(input: ProjectCreateInput) {
    return this.prisma.project.create({ data: input });
  }

  async updateProject(id: string, input: ProjectUpdateParams) {
    const data: Prisma.ProjectUncheckedUpdateInput = {};
    if (typeof input.name !== 'undefined') data.name = input.name;
    if (typeof input.description !== 'undefined') data.description = input.description;

    return this.prisma.project.update({ where: { id }, data });
  }

  async listLayers(projectId: string) {
    return this.prisma.layer.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLayerById(id: string) {
    return this.prisma.layer.findUnique({ where: { id } });
  }

  async createLayer(input: LayerCreateInput) {
    return this.prisma.layer.create({ data: input });
  }

  async updateLayer(id: string, input: LayerUpdateParams) {
    const data: Prisma.LayerUncheckedUpdateInput = {};
    if (typeof input.name !== 'undefined') data.name = input.name;
    if (typeof input.type !== 'undefined') data.type = input.type;
    if (typeof input.config !== 'undefined') data.config = input.config;

    return this.prisma.layer.update({ where: { id }, data });
  }
}

export type DataStoreType = DataStore;
