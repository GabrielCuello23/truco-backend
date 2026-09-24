import type { RequestHandler } from 'express';

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Ruta no encontrada: ${request.method} ${request.path}`,
    },
  });
};
