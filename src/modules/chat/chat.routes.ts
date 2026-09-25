import { Router } from 'express';

import type { Database } from '../../database/client';
import { requireAuth } from '../../middlewares/auth';
import { realtimeEvents } from '../../realtime/events';
import { createChatMessageSchema, chatRoomIdSchema, listChatMessagesSchema } from './chat.schemas';
import { createRoomMessage, listRoomMessages } from './chat.service';

export function createChatRouter(database: Database): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:roomId/messages', async (request, response) => {
    const roomId = chatRoomIdSchema.parse(request.params.roomId);
    const query = listChatMessagesSchema.parse(request.query);
    const messages = await listRoomMessages(database, roomId, request.auth!.userId, {
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
    });

    response.status(200).json({ messages });
  });

  router.post('/:roomId/messages', async (request, response) => {
    const roomId = chatRoomIdSchema.parse(request.params.roomId);
    const { body } = createChatMessageSchema.parse(request.body ?? {});
    const message = await createRoomMessage(database, roomId, request.auth!.userId, body);

    realtimeEvents.emit('chat:message', message);
    response.status(201).json({ message });
  });

  return router;
}
