import { and, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';

import type { Database } from '../../database/client';
import { roomMembers, rooms, users } from '../../database/schema';
import { AppError } from '../../shared/errors';

export const ESLA_COMPANIES = [
  {
    id: 'truco',
    slug: 'truco',
    name: 'Truco',
    description: 'Truco argentino multijugador de EslaGames.',
    status: 'active' as const,
  },
] as const;

export type AdminPagination = {
  page: number;
  pageSize: number;
};

function getOffset({ page, pageSize }: AdminPagination): number {
  return (page - 1) * pageSize;
}

function assertCompany(companyId: string): void {
  if (!ESLA_COMPANIES.some((company) => company.id === companyId)) {
    throw new AppError(404, 'COMPANY_NOT_FOUND', 'La empresa o juego solicitado no existe.');
  }
}

export async function listCompanies(database: Database) {
  const [[userCountRow], [roomCountRow]] = await Promise.all([
    database.select({ userCount: count(users.id) }).from(users),
    database.select({ roomCount: count(rooms.id) }).from(rooms),
  ]);
  const userCount = userCountRow?.userCount ?? 0;
  const roomCount = roomCountRow?.roomCount ?? 0;

  return ESLA_COMPANIES.map((company) => ({
    ...company,
    userCount: Number(userCount),
    roomCount: Number(roomCount),
  }));
}

export async function listCompanyUsers(
  database: Database,
  companyId: string,
  pagination: AdminPagination,
  search?: string,
) {
  assertCompany(companyId);
  const normalizedSearch = search?.trim();
  const where = normalizedSearch
    ? or(
        ilike(users.displayName, `%${normalizedSearch}%`),
        ilike(users.email, `%${normalizedSearch}%`),
      )
    : undefined;

  const [rows, totalRows] = await Promise.all([
    database
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        points: users.points,
        role: users.role,
        emailVerified: users.emailVerifiedAt,
        countryCode: users.countryCode,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pagination.pageSize)
      .offset(getOffset(pagination)),
    database
      .select({ total: count(users.id) })
      .from(users)
      .where(where),
  ]);
  const total = totalRows[0]?.total ?? 0;

  return {
    items: rows.map((user) => ({
      ...user,
      emailVerified: Boolean(user.emailVerified),
      status: 'active' as const,
    })),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / pagination.pageSize),
    },
  };
}

export type AdminRoomStatus = 'all' | 'active' | 'pending' | 'finished' | 'abandoned';

function toDatabaseRoomStatus(status: AdminRoomStatus) {
  if (status === 'active') return 'in_progress' as const;
  if (status === 'pending') return 'waiting' as const;
  if (status === 'finished') return 'finished' as const;
  if (status === 'abandoned') return 'abandoned' as const;
  return undefined;
}

export async function listCompanyRooms(
  database: Database,
  companyId: string,
  pagination: AdminPagination,
  status: AdminRoomStatus,
  search?: string,
) {
  assertCompany(companyId);
  const normalizedSearch = search?.trim();
  const databaseStatus = toDatabaseRoomStatus(status);
  const filters = [];

  if (databaseStatus) {
    filters.push(eq(rooms.status, databaseStatus));
  }

  if (normalizedSearch) {
    filters.push(
      or(
        ilike(rooms.name, `%${normalizedSearch}%`),
        ilike(rooms.code, `%${normalizedSearch}%`),
        ilike(users.displayName, `%${normalizedSearch}%`),
      ),
    );
  }

  const where = filters.length > 0 ? and(...filters) : undefined;
  const baseQuery = database
    .select({
      id: rooms.id,
      name: rooms.name,
      code: rooms.code,
      isPublic: rooms.isPublic,
      status: rooms.status,
      maxPlayers: rooms.maxPlayers,
      targetScore: rooms.targetScore,
      withFlor: rooms.withFlor,
      host: {
        id: users.id,
        displayName: users.displayName,
      },
      memberCount: count(roomMembers.userId),
      createdAt: rooms.createdAt,
      updatedAt: rooms.updatedAt,
    })
    .from(rooms)
    .leftJoin(users, eq(users.id, rooms.hostId))
    .leftJoin(roomMembers, and(eq(roomMembers.roomId, rooms.id), isNull(roomMembers.leftAt)))
    .where(where)
    .groupBy(rooms.id, users.id)
    .orderBy(desc(rooms.updatedAt))
    .limit(pagination.pageSize)
    .offset(getOffset(pagination));

  const [rows, totalRows] = await Promise.all([
    baseQuery,
    database
      .select({ total: count(rooms.id) })
      .from(rooms)
      .leftJoin(users, eq(users.id, rooms.hostId))
      .where(where),
  ]);
  const total = totalRows[0]?.total ?? 0;

  return {
    items: rows.map((room) => ({
      ...room,
      memberCount: Number(room.memberCount),
    })),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / pagination.pageSize),
    },
  };
}
