import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { DataStore } from '../storage/data-store.js';

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

const wrap = (handler: AsyncHandler) => {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error('[admin] Database error', error);
      res.status(500).json({ message: 'Erro ao executar operação no banco de dados.' });
    }
  };
};

export const createAdminRouter = (store: DataStore): Router => {
  const router = createRouter();

  router.get('/users', wrap(async (_req, res) => {
    const users = await store.listUsers();
    res.json(users);
  }));

  router.post('/users', wrap(async (req, res) => {
    const { email, name } = req.body ?? {};

    if (!email || !name) {
      res.status(400).json({ message: 'Campos "email" e "name" são obrigatórios.' });
      return;
    }

    const user = await store.createUser({ email, name });
    res.status(201).json(user);
  }));

  router.put('/users/:id', wrap(async (req, res) => {
    const { id } = req.params;
    const { email, name } = req.body ?? {};

    const payload: { email?: string; name?: string } = {};
    if (email) payload.email = email;
    if (name) payload.name = name;

    if (Object.keys(payload).length === 0) {
      res.status(400).json({ message: 'Envie ao menos um campo para atualizar.' });
      return;
    }

    const user = await store.updateUser(id, payload);
    res.json(user);
  }));

  router.get('/projects', wrap(async (_req, res) => {
    const projects = await store.listProjects();
    res.json(projects);
  }));

  router.post('/projects', wrap(async (req, res) => {
    const { name, description, ownerId } = req.body ?? {};

    if (!name || !ownerId) {
      res.status(400).json({ message: 'Campos "name" e "ownerId" são obrigatórios.' });
      return;
    }

    const project = await store.createProject({ name, description, ownerId });
    res.status(201).json(project);
  }));

  router.put('/projects/:id', wrap(async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body ?? {};

    const payload: { name?: string; description?: string | null } = {};
    if (typeof name !== 'undefined') payload.name = name;
    if (typeof description !== 'undefined') payload.description = description;

    if (Object.keys(payload).length === 0) {
      res.status(400).json({ message: 'Informe "name" ou "description" para atualizar.' });
      return;
    }

    const project = await store.updateProject(id, payload);
    res.json(project);
  }));

  return router;
};

export default createAdminRouter;
