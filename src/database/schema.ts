import {
  index,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['player', 'admin']);
export const authProviderEnum = pgEnum('auth_provider', ['password', 'google', 'apple']);
export const roomStatusEnum = pgEnum('room_status', [
  'waiting',
  'in_progress',
  'finished',
  'abandoned',
]);
export const roomMemberRoleEnum = pgEnum('room_member_role', ['host', 'player']);
export const gameStatusEnum = pgEnum('game_status', [
  'waiting',
  'in_progress',
  'finished',
  'abandoned',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }),
    passwordHash: varchar('password_hash', { length: 255 }),
    displayName: varchar('display_name', { length: 80 }).notNull(),
    role: userRoleEnum('role').notNull().default('player'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authProviderEnum('provider').notNull(),
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_accounts_provider_account_idx').on(table.provider, table.providerAccountId),
    uniqueIndex('auth_accounts_user_provider_idx').on(table.userId, table.provider),
  ],
);

export const refreshSessions = pgTable(
  'refresh_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_sessions_token_hash_idx').on(table.tokenHash),
    index('refresh_sessions_user_id_idx').on(table.userId),
  ],
);

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 8 }).notNull(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id),
    status: roomStatusEnum('status').notNull().default('waiting'),
    maxPlayers: integer('max_players').notNull().default(4),
    targetScore: integer('target_score').notNull().default(30),
    withFlor: boolean('with_flor').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('rooms_code_idx').on(table.code),
    index('rooms_host_id_idx').on(table.hostId),
    index('rooms_status_updated_at_idx').on(table.status, table.updatedAt),
  ],
);

export const roomMembers = pgTable(
  'room_members',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roomMemberRoleEnum('role').notNull().default('player'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.userId] }),
    index('room_members_user_id_idx').on(table.userId),
  ],
);

export const roomMessages = pgTable(
  'room_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: varchar('body', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('room_messages_room_created_at_idx').on(table.roomId, table.createdAt),
    index('room_messages_user_id_idx').on(table.userId),
  ],
);

export const games = pgTable(
  'games',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    status: gameStatusEnum('status').notNull().default('waiting'),
    stateVersion: integer('state_version').notNull().default(0),
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('games_room_id_idx').on(table.roomId)],
);

export const gameEvents = pgTable(
  'game_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    type: varchar('type', { length: 80 }).notNull(),
    commandId: uuid('command_id').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('game_events_game_version_idx').on(table.gameId, table.version),
    uniqueIndex('game_events_game_command_idx').on(table.gameId, table.commandId),
    index('game_events_game_id_idx').on(table.gameId),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aggregateType: varchar('aggregate_type', { length: 80 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('outbox_events_pending_idx').on(table.publishedAt, table.createdAt),
    index('outbox_events_aggregate_idx').on(table.aggregateType, table.aggregateId),
  ],
);
