import { EventEmitter } from 'node:events';

export type GameUpdatedEvent = {
  roomId: string;
  gameId: string;
  stateVersion: number;
};

export type RoomClosedEvent = {
  roomId: string;
};

export const REALTIME_EVENTS_CHANNEL = 'truco:realtime-events';

export type CrossProcessRealtimeEvent = { type: 'room:closed'; roomId: string };

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
  } catch {
    // Ignore malformed cross-process messages.
  }

  return null;
}

export const realtimeEvents = new EventEmitter();
