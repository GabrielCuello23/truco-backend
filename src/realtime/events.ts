import { EventEmitter } from 'node:events';

export type GameUpdatedEvent = {
  roomId: string;
  gameId: string;
  stateVersion: number;
};

export type RoomClosedEvent = {
  roomId: string;
};

export type RoomPlayerLeftEvent = {
  roomId: string;
  leftUserId: string;
  leftUserName: string;
  winnerUserId: string;
  winnerUserName: string;
};

export type ChatMessageEvent = {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string;
};

export type LobbyRoomSnapshot = {
  id: string;
  name: string;
  code: null;
  hostId: string;
  isPublic: boolean;
  status: 'waiting';
  maxPlayers: number;
  targetScore: 15 | 30;
  withFlor: boolean;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
};

export type LobbyRoomCreatedEvent = {
  room: LobbyRoomSnapshot;
};

export type LobbyRoomUpdatedEvent = {
  room: LobbyRoomSnapshot;
};

export type LobbyRoomRemovedEvent = {
  roomId: string;
};

export const REALTIME_EVENTS_CHANNEL = 'truco:realtime-events';

export type CrossProcessRealtimeEvent =
  { type: 'room:closed'; roomId: string } | ({ type: 'room:player_left' } & RoomPlayerLeftEvent);

export function serializeRealtimeEvent(event: CrossProcessRealtimeEvent): string {
  return JSON.stringify(event);
}

export function parseRealtimeEvent(value: string): CrossProcessRealtimeEvent | null {
  try {
    const event: unknown = JSON.parse(value);
    if (
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'room:closed' &&
      'roomId' in event &&
      typeof event.roomId === 'string'
    ) {
      return { type: 'room:closed', roomId: event.roomId };
    }

    if (
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'room:player_left' &&
      'roomId' in event &&
      'leftUserId' in event &&
      'leftUserName' in event &&
      'winnerUserId' in event &&
      'winnerUserName' in event &&
      typeof event.roomId === 'string' &&
      typeof event.leftUserId === 'string' &&
      typeof event.leftUserName === 'string' &&
      typeof event.winnerUserId === 'string' &&
      typeof event.winnerUserName === 'string'
    ) {
      return {
        type: 'room:player_left',
        roomId: event.roomId,
        leftUserId: event.leftUserId,
        leftUserName: event.leftUserName,
        winnerUserId: event.winnerUserId,
        winnerUserName: event.winnerUserName,
      };
    }
  } catch {
    // Ignore malformed cross-process messages.
  }

  return null;
}

export const realtimeEvents = new EventEmitter();
