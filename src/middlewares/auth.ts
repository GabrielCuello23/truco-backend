import type { RequestHandler } from 'express';
import { jwtVerify } from 'jose';

import { env } from '../config/env';
import { AppError } from '../shared/errors';

const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);

export const requireAuth: RequestHandler = async (request, _response, next) => {
  try {
    const authorization = request.header('authorization');

    if (!authorization?.startsWith('Bearer ')) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Se requiere autenticación.');
    }

    const token = authorization.slice('Bearer '.length);
    const { payload } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] });

    if (payload.type !== 'access' || typeof payload.sub !== 'string') {
      throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'El access token no es válido.');
    }

    const role = payload.role === 'admin' ? 'admin' : 'player';
    request.auth = { userId: payload.sub, role };
    next();
  } catch (error) {
    next(
      error instanceof AppError
        ? error
        : new AppError(401, 'INVALID_ACCESS_TOKEN', 'El access token no es válido.'),
    );
  }
};
