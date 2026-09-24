import { EventEmitter } from 'node:events';

export type GameUpdatedEvent = {
  roomId: string;
  gameId: string;
  stateVersion: number;
};

export type RoomClosedEvent = {
  roomId: string;
};

export const realtimeEvents = new EventEmitter();
