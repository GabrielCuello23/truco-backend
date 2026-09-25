import { and, desc, eq, isNull, lt } from 'drizzle-orm';

import type { Database } from '../../database/client';
import { roomMembers, roomMessages, rooms, users } from '../../database/schema';
import { AppError } from '../../shared/errors';
import type { RoomChatMessage } from './chat.types';

type ChatMessageQuery = {
  limit: number;
  before?: Date;
};

async function assertRoomMember(database: Database, roomId: string, userId: string): Promise<void> {
  const [room] = await database.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId));
  if (!room) {
    throw new AppError(404, 'ROOM_NOT_FOUND', 'Sala no encontrada.');
  }

  const [membership] = await database
    .select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.userId, userId),
        isNull(roomMembers.leftAt),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new AppError(403, 'ROOM_ACCESS_DENIED', 'No perteneces a esta sala.');
  }
}

function toRoomChatMessage(
  message: typeof roomMessages.$inferSelect,
  displayName: string,
): RoomChatMessage {
  return {
    id: message.id,
    roomId: message.roomId,
    userId: message.userId,
    displayName,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function listRoomMessages(
  database: Database,
  roomId: string,
  userId: string,
  query: ChatMessageQuery,
): Promise<RoomChatMessage[]> {
  await assertRoomMember(database, roomId, userId);

  const messages = await database
    .select({ message: roomMessages, displayName: users.displayName })
    .from(roomMessages)
    .innerJoin(users, eq(users.id, roomMessages.userId))
    .where(
      and(
        eq(roomMessages.roomId, roomId),
        query.before ? lt(roomMessages.createdAt, query.before) : undefined,
      ),
    )
    .orderBy(desc(roomMessages.createdAt), desc(roomMessages.id))
    .limit(query.limit);

  return messages
    .map(({ message, displayName }) => toRoomChatMessage(message, displayName))
    .sort((first, second) => {
      const byDate = first.createdAt.localeCompare(second.createdAt);
      return byDate !== 0 ? byDate : first.id.localeCompare(second.id);
    });
}

export async function createRoomMessage(
  database: Database,
  roomId: string,
  userId: string,
  body: string,
): Promise<RoomChatMessage> {
  await assertRoomMember(database, roomId, userId);

  const [message] = await database
    .insert(roomMessages)
    .values({ roomId, userId, body })
    .returning();

  if (!message) {
    throw new AppError(500, 'CHAT_MESSAGE_CREATION_FAILED', 'No se pudo enviar el mensaje.');
  }

  const [messageWithAuthor] = await database
    .select({ message: roomMessages, displayName: users.displayName })
    .from(roomMessages)
    .innerJoin(users, eq(users.id, roomMessages.userId))
    .where(eq(roomMessages.id, message.id))
    .limit(1);

  if (!messageWithAuthor) {
    throw new AppError(500, 'CHAT_MESSAGE_CREATION_FAILED', 'No se pudo leer el mensaje enviado.');
  }

  return toRoomChatMessage(messageWithAuthor.message, messageWithAuthor.displayName);
}
