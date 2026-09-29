import { Router } from 'express';
import { z } from 'zod';

import type { Database } from '../../database/client';
import { requireAdmin, requireAuth } from '../../middlewares/auth';
import { getUserById, loginAdminUser } from '../auth/auth.service';
import {
  listCompanies,
  listCompanyRooms,
  listCompanyUsers,
  type AdminRoomStatus,
} from './admin.service';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

const companyIdSchema = z.string().trim().min(1).max(40);
const roomStatusSchema = z
  .enum(['all', 'active', 'pending', 'finished', 'abandoned'])
  .default('all');

export function createAdminRouter(database: Database): Router {
  const router = Router();

  router.post('/auth/login', async (request, response) => {
    const input = loginSchema.parse(request.body);
    const result = await loginAdminUser(database, input);
    response.status(200).json(result);
  });

  router.use(requireAuth, requireAdmin);

  router.get('/auth/me', async (request, response) => {
    const user = await getUserById(database, request.auth!.userId);
    response.status(200).json({ user });
  });

  router.get('/companies', async (_request, response) => {
    const companies = await listCompanies(database);
    response.status(200).json({ companies });
  });

  router.get('/companies/:companyId/users', async (request, response) => {
    const companyId = companyIdSchema.parse(request.params.companyId);
    const pagination = paginationSchema.parse(request.query);
    const search = z.string().trim().max(120).optional().parse(request.query.search);
    const result = await listCompanyUsers(database, companyId, pagination, search);
    response.status(200).json(result);
  });

  router.get('/companies/:companyId/rooms', async (request, response) => {
    const companyId = companyIdSchema.parse(request.params.companyId);
    const pagination = paginationSchema.parse(request.query);
    const status = roomStatusSchema.parse(request.query.status) as AdminRoomStatus;
    const search = z.string().trim().max(120).optional().parse(request.query.search);
    const result = await listCompanyRooms(database, companyId, pagination, status, search);
    response.status(200).json(result);
  });

  return router;
}
