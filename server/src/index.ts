import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createAdminRouter } from './routes/admin.js';
import { createMembersRouter } from './routes/members.js';
import { DataStore } from './storage/data-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

try {
  await prisma.$connect();
  console.log('Conexão com o banco de dados estabelecida.');
} catch (error) {
  console.error('Não foi possível conectar ao banco de dados.', error);
  process.exit(1);
}

const store = new DataStore(prisma);

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/admin', createAdminRouter(store));
app.use('/members', createMembersRouter(store));

const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => {
  console.log(`API server running on port ${port}`);
});

const shutdown = async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
