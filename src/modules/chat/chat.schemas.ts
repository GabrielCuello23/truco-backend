import { z } from 'zod';

export const chatRoomIdSchema = z.string().uuid();

export const listChatMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

export const createChatMessageSchema = z.object({
  body: z.string().trim().min(1).max(500),
});
