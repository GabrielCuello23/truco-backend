import { createHash, randomBytes, randomInt } from 'node:crypto';

import { and, asc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { hash, verify } from 'argon2';
import { SignJWT } from 'jose';

import { env } from '../../config/env';
import type { Database } from '../../database/client';
import { authAccounts, games, refreshSessions, roomMembers, users } from '../../database/schema';
import { AppError } from '../../shared/errors';
import { type CountryCode } from './countries';

const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);

export type PublicUser = Pick<
  typeof users.$inferSelect,
  'id' | 'email' | 'displayName' | 'points' | 'role' | 'countryCode' | 'pendingCountryCode'
> & { emailVerified: boolean };

export type ProfileStats = {
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  bestStreak: number;
};

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
    points: user.points,
    emailVerified: Boolean(user.emailVerifiedAt),
    role: user.role,
    countryCode: user.countryCode,
    pendingCountryCode: user.pendingCountryCode,
  };
}

export async function registerUser(
  database: Database,
  input: { nickname: string; email: string; password: string; countryCode: CountryCode },
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
          points: 10,
          emailVerifiedAt: null,
          countryCode: input.countryCode,
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

export async function requestCountryChange(
  database: Database,
  userId: string,
  countryCode: CountryCode,
): Promise<PublicUser> {
  const [currentUser] = await database
    .select({ countryCode: users.countryCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!currentUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  const [updatedUser] = await database
    .update(users)
    .set(
      currentUser.countryCode
        ? {
            pendingCountryCode: currentUser.countryCode === countryCode ? null : countryCode,
            updatedAt: new Date(),
          }
        : { countryCode, pendingCountryCode: null, updatedAt: new Date() },
    )
    .where(eq(users.id, userId))
    .returning();

  if (!updatedUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  return toPublicUser(updatedUser);
}

export async function updateUserProfile(
  database: Database,
  userId: string,
  input: { displayName: string; email: string; countryCode: CountryCode },
): Promise<PublicUser> {
  const email = normalizeEmail(input.email);

  try {
    return await database.transaction(async (transaction) => {
      const [currentUser] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!currentUser) {
        throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
      }

      const [updatedUser] = await transaction
        .update(users)
        .set({
          displayName: input.displayName.trim(),
          email,
          ...(currentUser.email !== email
            ? {
                emailVerifiedAt: null,
                emailVerificationCodeHash: null,
                emailVerificationCodeExpiresAt: null,
                emailVerificationSentAt: null,
                emailVerificationAttemptCount: 0,
              }
            : {}),
          ...(currentUser.countryCode
            ? {
                pendingCountryCode:
                  currentUser.countryCode === input.countryCode ? null : input.countryCode,
              }
            : { countryCode: input.countryCode, pendingCountryCode: null }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!updatedUser) {
        throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
      }

      await transaction
        .update(authAccounts)
        .set({ providerAccountId: email, updatedAt: new Date() })
        .where(and(eq(authAccounts.userId, userId), eq(authAccounts.provider, 'password')));

      return toPublicUser(updatedUser);
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'El email ya está registrado.');
    }

    throw error;
  }
}

const EMAIL_VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000;
const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_EMAIL_VERIFICATION_ATTEMPTS = 5;

function hashEmailVerificationCode(userId: string, code: string): string {
  return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ??
      character,
  );
}

async function sendBrevoVerificationEmail(
  email: string,
  displayName: string,
  code: string,
): Promise<void> {
  if (!env.BREVO_API_KEY) {
    throw new AppError(
      503,
      'EMAIL_SERVICE_NOT_CONFIGURED',
      'La verificación de email todavía no está configurada.',
    );
  }

  const safeDisplayName = escapeHtml(displayName);
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
      to: [{ email, name: displayName }],
      subject: 'Verificá tu email en Esla Games',
      textContent: `Hola ${displayName}, tu código de verificación es ${code}. Vence en 15 minutos.`,
      htmlContent: `<p>Hola ${safeDisplayName},</p><p>Tu código para verificar el email en Esla Games es:</p><p style="font-size: 28px; font-weight: bold; letter-spacing: 8px;">${code}</p><p>Este código vence en 15 minutos.</p>`,
    }),
  });

  if (!response.ok) {
    throw new AppError(502, 'EMAIL_DELIVERY_FAILED', 'No se pudo enviar el email de verificación.');
  }
}

export async function requestEmailVerification(
  database: Database,
  userId: string,
): Promise<{ user: PublicUser; expiresAt: string }> {
  const [user] = await database.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  if (!user.email) {
    throw new AppError(400, 'EMAIL_REQUIRED', 'Tu cuenta no tiene un email para verificar.');
  }

  if (user.emailVerifiedAt) {
    throw new AppError(409, 'EMAIL_ALREADY_VERIFIED', 'Tu email ya está verificado.');
  }

  const now = new Date();
  if (
    user.emailVerificationSentAt &&
    now.getTime() - user.emailVerificationSentAt.getTime() < EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
  ) {
    throw new AppError(
      429,
      'EMAIL_VERIFICATION_COOLDOWN',
      'Esperá un minuto antes de solicitar otro código.',
    );
  }

  const code = randomInt(100000, 1000000).toString();
  const codeHash = hashEmailVerificationCode(user.id, code);
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_CODE_TTL_MS);

  await sendBrevoVerificationEmail(user.email, user.displayName, code);

  const [updatedUser] = await database
    .update(users)
    .set({
      emailVerificationCodeHash: codeHash,
      emailVerificationCodeExpiresAt: expiresAt,
      emailVerificationSentAt: now,
      emailVerificationAttemptCount: 0,
      updatedAt: now,
    })
    .where(eq(users.id, user.id))
    .returning();

  if (!updatedUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  return { user: toPublicUser(updatedUser), expiresAt: expiresAt.toISOString() };
}

export async function verifyEmailCode(
  database: Database,
  userId: string,
  code: string,
): Promise<PublicUser> {
  const [user] = await database.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  if (user.emailVerifiedAt) {
    return toPublicUser(user);
  }

  const isExpired =
    !user.emailVerificationCodeExpiresAt ||
    user.emailVerificationCodeExpiresAt.getTime() <= Date.now();
  const expectedHash = hashEmailVerificationCode(user.id, code);

  if (
    isExpired ||
    !user.emailVerificationCodeHash ||
    user.emailVerificationCodeHash !== expectedHash
  ) {
    const nextAttemptCount = user.emailVerificationAttemptCount + 1;
    await database
      .update(users)
      .set(
        nextAttemptCount >= MAX_EMAIL_VERIFICATION_ATTEMPTS
          ? {
              emailVerificationCodeHash: null,
              emailVerificationCodeExpiresAt: null,
              emailVerificationAttemptCount: 0,
              updatedAt: new Date(),
            }
          : { emailVerificationAttemptCount: nextAttemptCount, updatedAt: new Date() },
      )
      .where(eq(users.id, userId));

    throw new AppError(
      400,
      'INVALID_EMAIL_VERIFICATION_CODE',
      isExpired
        ? 'El código expiró. Solicitá uno nuevo.'
        : 'El código de verificación no es válido.',
    );
  }

  const [verifiedUser] = await database
    .update(users)
    .set({
      emailVerifiedAt: new Date(),
      emailVerificationCodeHash: null,
      emailVerificationCodeExpiresAt: null,
      emailVerificationSentAt: null,
      emailVerificationAttemptCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();

  if (!verifiedUser) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Usuario no encontrado.');
  }

  return toPublicUser(verifiedUser);
}

type StoredGameState = {
  players?: Array<{ id?: unknown; team?: unknown }>;
  scores?: { A?: unknown; B?: unknown };
  matchWinnerTeam?: unknown;
};

type MatchOutcome = 'win' | 'loss' | null;

function getMatchOutcome(state: unknown, userId: string): MatchOutcome {
  const gameState = state as StoredGameState;
  const player = gameState.players?.find((candidate) => candidate.id === userId);

  if (player?.team !== 'A' && player?.team !== 'B') {
    return null;
  }

  const winnerTeam =
    gameState.matchWinnerTeam === 'A' || gameState.matchWinnerTeam === 'B'
      ? gameState.matchWinnerTeam
      : typeof gameState.scores?.A === 'number' && typeof gameState.scores?.B === 'number'
        ? gameState.scores.A === gameState.scores.B
          ? null
          : gameState.scores.A > gameState.scores.B
            ? 'A'
            : 'B'
        : null;

  if (!winnerTeam) {
    return null;
  }

  return winnerTeam === player.team ? 'win' : 'loss';
}

export async function getProfileStats(database: Database, userId: string): Promise<ProfileStats> {
  const finishedGames = await database
    .select({ state: games.state })
    .from(games)
    .innerJoin(roomMembers, eq(roomMembers.roomId, games.roomId))
    .where(and(eq(roomMembers.userId, userId), eq(games.status, 'finished')))
    .orderBy(asc(games.createdAt));

  let wins = 0;
  let losses = 0;
  let currentStreak = 0;
  let bestStreak = 0;

  for (const game of finishedGames) {
    const outcome = getMatchOutcome(game.state, userId);

    if (outcome === 'win') {
      wins += 1;
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else if (outcome === 'loss') {
      losses += 1;
      currentStreak = 0;
    }
  }

  const matches = wins + losses;

  return {
    matches,
    wins,
    losses,
    winRate: matches > 0 ? Number(((wins / matches) * 100).toFixed(1)) : 0,
    bestStreak,
  };
}

/** Applies requested country changes when the active season is reset. */
export async function applyPendingCountryChanges(database: Database): Promise<number> {
  const updatedUsers = await database
    .update(users)
    .set({
      countryCode: sql`${users.pendingCountryCode}`,
      pendingCountryCode: null,
      updatedAt: new Date(),
    })
    .where(isNotNull(users.pendingCountryCode))
    .returning({ id: users.id });

  return updatedUsers.length;
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
