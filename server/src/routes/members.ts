import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { DataStore } from '../storage/data-store.js';

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

const wrap = (handler: AsyncHandler) => {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error('[members] Database error', error);
      res.status(500).json({ message: 'Erro ao executar operação no banco de dados.' });
    }
  };
};

export const createMembersRouter = (store: DataStore): Router => {
  const router = createRouter();

  router.get('/users/:userId/projects', wrap(async (req, res) => {
    const { userId } = req.params;
    const projects = await store.listProjectsByUser(userId);
    res.json(projects);
  }));

  router.get('/projects/:projectId/layers', wrap(async (req, res) => {
    const { projectId } = req.params;

    const project = await store.findProjectById(projectId);
    if (!project) {
      res.status(404).json({ message: 'Projeto não encontrado.' });
      return;
    }

    const layers = await store.listLayers(projectId);
    res.json({ project, layers });
  }));

  router.post('/projects/:projectId/layers', wrap(async (req, res) => {
    const { projectId } = req.params;
    const { name, type, config } = req.body ?? {};

    if (!name || !type) {
      res.status(400).json({ message: 'Campos "name" e "type" são obrigatórios.' });
      return;
    }

    const project = await store.findProjectById(projectId);
    if (!project) {
      res.status(404).json({ message: 'Projeto não encontrado.' });
      return;
    }

    const layer = await store.createLayer({ name, type, config, projectId });
    res.status(201).json(layer);
  }));

  router.put('/layers/:layerId', wrap(async (req, res) => {
    const { layerId } = req.params;
    const { name, type, config } = req.body ?? {};

    if (!name && !type && typeof config === 'undefined') {
      res.status(400).json({ message: 'Nenhum dado enviado para atualização.' });
      return;
    }

    const existing = await store.findLayerById(layerId);
    if (!existing) {
      res.status(404).json({ message: 'Camada não encontrada.' });
      return;
    }

    const layer = await store.updateLayer(layerId, { name, type, config });
    res.json(layer);
  }));

  return router;
};

export default createMembersRouter;
