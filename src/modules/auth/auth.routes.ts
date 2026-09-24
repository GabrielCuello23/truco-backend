import { Router } from 'express';
import { z } from 'zod';

import type { Database } from '../../database/client';
import { requireAuth } from '../../middlewares/auth';
import {
  getUserById,
  loginUser,
  refreshUserTokens,
  registerUser,
  revokeRefreshToken,
} from './auth.service';

const registerSchema = z.object({
  nickname: z.string().trim().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(32),
});

export function createAuthRouter(database: Database): Router {
  const router = Router();

  router.post('/register', async (request, response) => {
    const input = registerSchema.parse(request.body);
    const result = await registerUser(database, input);
    response.status(201).json(result);
  });

  router.post('/login', async (request, response) => {
    const input = loginSchema.parse(request.body);
    const result = await loginUser(database, input);
    response.status(200).json(result);
  });

  router.post('/refresh', async (request, response) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    const result = await refreshUserTokens(database, refreshToken);
    response.status(200).json(result);
  });

  router.post('/logout', async (request, response) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    await revokeRefreshToken(database, refreshToken);
    response.status(204).send();
  });

  router.get('/me', requireAuth, async (request, response) => {
    const user = await getUserById(database, request.auth!.userId);
    response.status(200).json({ user });
  });

  return router;
}
