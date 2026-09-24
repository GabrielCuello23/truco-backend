import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';
import { hash, verify } from 'argon2';
import { SignJWT } from 'jose';

import { env } from '../../config/env';
import type { Database } from '../../database/client';
import { authAccounts, refreshSessions, users } from '../../database/schema';
import { AppError } from '../../shared/errors';

const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);

export type PublicUser = Pick<typeof users.$inferSelect, 'id' | 'email' | 'displayName' | 'role'>;

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type DatabaseExecutor = Pick<Database, 'insert'>;

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createAccessToken(user: PublicUser): Promise<string> {
  return new SignJWT({ type: 'access', role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + env.ACCESS_TOKEN_TTL_SECONDS)
    .sign(jwtSecret);
}

async function issueTokenPair(
  database: DatabaseExecutor,
  user: PublicUser,
  sessionExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
): Promise<TokenPair> {
  const refreshToken = randomBytes(48).toString('base64url');

  await database.insert(refreshSessions).values({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: sessionExpiresAt,
  });

  return {
    accessToken: await createAccessToken(user),
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublicUser(user: typeof users.$inferSelect): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

export async function registerUser(
  database: Database,
  input: { nickname: string; email: string; password: string },
): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hash(input.password, { type: 2 });

  try {
    return await database.transaction(async (transaction) => {
      const [user] = await transaction
        .insert(users)
        .values({
          email,
          passwordHash,
          displayName: input.nickname.trim(),
        })
        .returning();

      if (!user) {
        throw new AppError(500, 'USER_CREATION_FAILED', 'No se pudo crear el usuario.');
      }

      await transaction.insert(authAccounts).values({
        userId: user.id,
        provider: 'password',
        providerAccountId: email,
      });

      const publicUser = toPublicUser(user);
      return { user: publicUser, tokens: await issueTokenPair(transaction, publicUser) };
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'El email ya está registrado.');
    }

    throw error;
  }
}

export async function loginUser(
  database: Database,
  input: { email: string; password: string },
): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const [result] = await database
    .select({ user: users })
    .from(users)
    .innerJoin(
      authAccounts,
      and(eq(authAccounts.userId, users.id), eq(authAccounts.provider, 'password')),
    )
    .where(eq(users.email, normalizeEmail(input.email)))
    .limit(1);
  const user = result?.user;

  if (!user?.passwordHash || !(await verify(user.passwordHash, input.password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos.');
  }

  const publicUser = toPublicUser(user);
  return { user: publicUser, tokens: await issueTokenPair(database, publicUser) };
}

export async function refreshUserTokens(
  database: Database,
  refreshToken: string,
): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const tokenHash = hashRefreshToken(refreshToken);
  return database.transaction(async (transaction) => {
    const now = new Date();
    const [session] = await transaction
      .select()
      .from(refreshSessions)
      .where(
        and(
          eq(refreshSessions.tokenHash, tokenHash),
          isNull(refreshSessions.revokedAt),
          gt(refreshSessions.expiresAt, now),
        ),
      )
      .for('update')
      .limit(1);

    if (!session) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'El refresh token no es válido.');
    }

    const [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'El refresh token no es válido.');
    }

    const publicUser = toPublicUser(user);
    await transaction
      .update(refreshSessions)
      .set({ revokedAt: now })
      .where(eq(refreshSessions.id, session.id));

    return {
      user: publicUser,
      tokens: await issueTokenPair(transaction, publicUser, session.expiresAt),
    };
  });
}

export async function getUserById(database: Database, userId: string): Promise<PublicUser> {
  const [user] = await database.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  return toPublicUser(user);
}

export async function revokeRefreshToken(database: Database, refreshToken: string): Promise<void> {
  await database
    .update(refreshSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshSessions.tokenHash, hashRefreshToken(refreshToken)),
        isNull(refreshSessions.revokedAt),
      ),
    );
}
