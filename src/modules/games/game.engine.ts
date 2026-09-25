import { randomInt, randomUUID } from 'node:crypto';

import { AppError } from '../../shared/errors';

export const CARD_SUITS = ['espadas', 'bastos', 'oros', 'copas'] as const;
export const CARD_RANKS = ['1', '2', '3', '4', '5', '6', '7', '10', '11', '12'] as const;
export const TEAMS = ['A', 'B'] as const;
export const BOT_PLAYER_ID = '00000000-0000-0000-0000-000000000001';

export type CardSuit = (typeof CARD_SUITS)[number];
export type CardRank = (typeof CARD_RANKS)[number];
export type Team = (typeof TEAMS)[number];
export type GameCard = {
  id: string;
  suit: CardSuit;
  rank: CardRank;
  power: number;
  envidoValue: number;
};

export type GamePlayer = {
  id: string;
  displayName: string;
  seat: number;
  team: Team;
};

export type PlayedGameCard = {
  playerId: string;
  card: GameCard;
};

export type RoundState = {
  cards: PlayedGameCard[];
  winnerPlayerId: string | null;
  winnerTeam: Team | null;
  result: 'PLAYER' | 'DRAW';
};

export type TrucoCall = 'truco' | 'retruco' | 'vale_cuatro';
export type EnvidoCall = 'envido' | 'real_envido' | 'falta_envido';
export type FlorCall = 'flor' | 'contra_flor' | 'contra_flor_al_resto';
export type GameActionType =
  TrucoCall | EnvidoCall | FlorCall | 'quiero' | 'no_quiero' | 'fold' | 'play_card' | 'new_hand';

export type BotAction = {
  type: GameActionType;
  cardId?: string;
};

export type BotActionNotice = {
  id: string;
  type: GameActionType;
};

export type GameActionNotice =
  | {
      id: string;
      actorId: string;
      type: Exclude<GameActionType, 'play_card' | 'new_hand'>;
      context: 'truco' | 'envido' | 'flor' | 'fold';
    }
  | {
      id: string;
      actorId: string;
      type: 'envido_result';
      winnerId: string | null;
      values: Record<string, number>;
      points: number;
    };

type PendingCall<T extends string> = {
  type: T;
  callerId: string;
  responderId: string;
  previousValue: number;
};

export type GameState = {
  targetScore: 15 | 30;
  withFlor: boolean;
  players: GamePlayer[];
  scores: Record<Team, number>;
  manoPlayerId: string;
  handNumber: number;
  hands: Record<string, GameCard[]>;
  currentRoundCards: PlayedGameCard[];
  rounds: RoundState[];
  currentTurnPlayerId: string;
  handStatus: 'playing' | 'finished';
  handWinnerTeam: Team | null;
  truco: {
    level: 0 | 1 | 2 | 3;
    pending: PendingCall<TrucoCall> | null;
    lastCallerId: string | null;
    teamWithRaiseRight: Team | null;
  };
  envido: {
    calls: EnvidoCall[];
    pending: PendingCall<EnvidoCall> | null;
    resolved: boolean;
    winnerTeam: Team | null;
    revealCards: boolean;
    revealPlayerId: string | null;
    revealCardIds: string[];
  };
  flor: {
    calls: FlorCall[];
    pending: PendingCall<FlorCall> | null;
    resolved: boolean;
    winnerTeam: Team | null;
  };
  lastBotAction: BotActionNotice | null;
  lastAction: GameActionNotice | null;
  revealedCards: PlayedGameCard[];
};

type RandomSource = (maxExclusive: number) => number;

const defaultRandomSource: RandomSource = (maxExclusive) => randomInt(maxExclusive);

const POWER_BY_CARD: Record<string, number> = {
  '1-espadas': 14,
  '1-bastos': 13,
  '7-espadas': 12,
  '7-oros': 11,
};

function cardPower(rank: CardRank, suit: CardSuit): number {
  const specialPower = POWER_BY_CARD[`${rank}-${suit}`];
  if (specialPower) {
    return specialPower;
  }

  if (rank === '3') return 10;
  if (rank === '2') return 9;
  if (rank === '1') return 8;
  if (rank === '12') return 7;
  if (rank === '11') return 6;
  if (rank === '10') return 5;
  if (rank === '7') return 4;
  if (rank === '6') return 3;
  if (rank === '5') return 2;
  return 1;
}

function cardEnvidoValue(rank: CardRank): number {
  return ['10', '11', '12'].includes(rank) ? 0 : Number(rank);
}

export function createDeck(): GameCard[] {
  return CARD_SUITS.flatMap((suit) =>
    CARD_RANKS.map((rank) => ({
      id: `${rank}-${suit}`,
      suit,
      rank,
      power: cardPower(rank, suit),
      envidoValue: cardEnvidoValue(rank),
    })),
  );
}

function shuffle<T>(items: T[], randomSource: RandomSource): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = randomSource(index + 1);
    [result[index], result[randomIndex]] = [result[randomIndex]!, result[index]!];
  }

  return result;
}

function teamForSeat(seat: number): Team {
  return seat % 2 === 0 ? 'A' : 'B';
}

function getPlayer(state: GameState, playerId: string): GamePlayer {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) {
    throw new AppError(403, 'GAME_PLAYER_NOT_FOUND', 'El jugador no pertenece a esta partida.');
  }

  return player;
}

function getPlayerTeam(state: GameState, playerId: string): Team {
  return getPlayer(state, playerId).team;
}

function nextPlayer(state: GameState, playerId: string): GamePlayer {
  const currentPlayer = getPlayer(state, playerId);
  return state.players[(currentPlayer.seat + 1) % state.players.length]!;
}

function getPlayerOrderFromMano(state: GameState): GamePlayer[] {
  const mano = getPlayer(state, state.manoPlayerId);
  return state.players.slice(mano.seat).concat(state.players.slice(0, mano.seat));
}

export function getHandWinner(
  rounds: Array<Pick<RoundState, 'winnerTeam'>>,
  manoTeam: Team,
): Team | null {
  const results = rounds.map((round) => round.winnerTeam);
  const first = results[0];
  const second = results[1];

  if (results.length < 2 || first === undefined || second === undefined) {
    return null;
  }

  if (first && first === second) {
    return first;
  }

  if (first === null) {
    if (second === null) {
      return results.length >= 3 ? (results[2] ?? manoTeam) : null;
    }

    return second;
  }

  if (second === null) {
    return first;
  }

  return results.length >= 3 ? (results[2] ?? first) : null;
}

function getCurrentHandWinner(state: GameState): Team | null {
  return getHandWinner(state.rounds, getPlayerTeam(state, state.manoPlayerId));
}

export function calculateEnvido(cards: Pick<GameCard, 'suit' | 'envidoValue'>[]): number {
  const valuesBySuit = new Map<CardSuit, number[]>();

  for (const card of cards) {
    const values = valuesBySuit.get(card.suit) ?? [];
    values.push(card.envidoValue);
    valuesBySuit.set(card.suit, values);
  }

  const pairedValues = Array.from(valuesBySuit.values())
    .filter((values) => values.length >= 2)
    .map((values) =>
      values
        .sort((first, second) => second - first)
        .slice(0, 2)
        .reduce((sum, value) => sum + value, 20),
    );

  return Math.max(...pairedValues, ...cards.map((card) => card.envidoValue), 0);
}

function getEnvidoScoringCards(cards: GameCard[]): GameCard[] {
  const cardsBySuit = new Map<CardSuit, GameCard[]>();

  for (const card of cards) {
    const suitCards = cardsBySuit.get(card.suit) ?? [];
    suitCards.push(card);
    cardsBySuit.set(card.suit, suitCards);
  }

  let bestPair: GameCard[] = [];
  let bestPairValue = -1;

  for (const suitCards of cardsBySuit.values()) {
    if (suitCards.length < 2) {
      continue;
    }

    const pair = [...suitCards]
      .sort((first, second) => second.envidoValue - first.envidoValue)
      .slice(0, 2);
    const pairValue = pair.reduce((sum, card) => sum + card.envidoValue, 20);

    if (pairValue > bestPairValue) {
      bestPair = pair;
      bestPairValue = pairValue;
    }
  }

  if (bestPair.length > 0) {
    return bestPair;
  }

  const highestCard = [...cards].sort(
    (first, second) => second.envidoValue - first.envidoValue,
  )[0];
  return highestCard ? [highestCard] : [];
}

export function calculateFlor(cards: Pick<GameCard, 'suit' | 'envidoValue'>[]): number | null {
  if (cards.length !== 3 || new Set(cards.map((card) => card.suit)).size !== 1) {
    return null;
  }

  return cards.reduce((sum, card) => sum + card.envidoValue, 20);
}

export function calculateFaltaEnvidoValue(
  scores: Record<Team, number>,
  targetScore: 15 | 30,
): number {
  const leadingScore = Math.max(scores.A, scores.B);
  const target = targetScore === 15 || (scores.A < 15 && scores.B < 15) ? 15 : 30;
  return Math.max(1, target - leadingScore);
}

export function calculateEnvidoAcceptedValue(
  calls: EnvidoCall[],
  scores: Record<Team, number>,
  targetScore: 15 | 30,
): number {
  if (calls.includes('falta_envido')) {
    return calculateFaltaEnvidoValue(scores, targetScore);
  }

  return calls.reduce((total, call) => total + (call === 'envido' ? 2 : 3), 0);
}

export function calculateEnvidoRejectedValue(
  calls: EnvidoCall[],
  scores: Record<Team, number>,
  targetScore: 15 | 30,
): number {
  if (calls.length <= 1) {
    return 1;
  }

  return calculateEnvidoAcceptedValue(calls.slice(0, -1), scores, targetScore);
}

export function calculateFlorAcceptedValue(
  calls: FlorCall[],
  scores: Record<Team, number>,
  targetScore: 15 | 30,
): number {
  if (calls.includes('contra_flor_al_resto')) {
    return calculateFaltaEnvidoValue(scores, targetScore);
  }

  if (calls.includes('contra_flor')) {
    return 6;
  }

  return 3;
}

export function getRoundWinner(cards: PlayedGameCard[]): {
  winnerPlayerId: string | null;
  winnerTeam: Team | null;
  result: 'PLAYER' | 'DRAW';
} {
  const highestPower = Math.max(...cards.map(({ card }) => card.power));
  const highestCards = cards.filter(({ card }) => card.power === highestPower);

  if (highestCards.length !== 1) {
    return { winnerPlayerId: null, winnerTeam: null, result: 'DRAW' };
  }

  const winner = highestCards[0]!;
  return {
    winnerPlayerId: winner.playerId,
    winnerTeam: null,
    result: 'PLAYER',
  };
}

function getRoundTeam(state: GameState, round: RoundState): RoundState {
  if (!round.winnerPlayerId) {
    const highestPower = Math.max(...round.cards.map(({ card }) => card.power));
    const highestCards = round.cards.filter(({ card }) => card.power === highestPower);
    const highestTeams = new Set(
      highestCards.map(({ playerId }) => getPlayerTeam(state, playerId)),
    );

    if (highestTeams.size === 1 && highestCards[0]) {
      return {
        ...round,
        winnerPlayerId: highestCards[0].playerId,
        winnerTeam: [...highestTeams][0]!,
        result: 'PLAYER',
      };
    }

    return round;
  }

  return { ...round, winnerTeam: getPlayerTeam(state, round.winnerPlayerId) };
}

function addScore(state: GameState, team: Team, points: number): void {
  state.scores[team] += points;

  if (state.scores[team] >= state.targetScore) {
    state.handStatus = 'finished';
    state.handWinnerTeam = team;
  }
}

function revealEnvidoCards(state: GameState): void {
  if (!state.envido.revealCards || state.handStatus !== 'finished') {
    return;
  }

  state.revealedCards ??= [];

  const playerId = state.envido.revealPlayerId;
  if (playerId) {
    const hand = state.hands[playerId] ?? [];
    const revealCardIds = new Set(state.envido.revealCardIds ?? []);
    const cardsToReveal = hand.filter((card) => revealCardIds.has(card.id));

    for (const card of cardsToReveal) {
      state.revealedCards.push({ playerId, card });
    }
    state.hands[playerId] = hand.filter((card) => !revealCardIds.has(card.id));
  }

  state.envido.revealCards = false;
  state.envido.revealPlayerId = null;
  state.envido.revealCardIds = [];
}

function opposingTeam(team: Team): Team {
  return team === 'A' ? 'B' : 'A';
}

function assertActorCanRespond(
  pending: PendingCall<string> | null,
  actorId: string,
  message: string,
): asserts pending is PendingCall<string> {
  if (!pending || pending.responderId !== actorId) {
    throw new AppError(409, 'INVALID_GAME_RESPONSE', message);
  }
}

function assertNoPendingCall(state: GameState): void {
  if (state.truco.pending || state.envido.pending || state.flor.pending) {
    throw new AppError(
      409,
      'GAME_RESPONSE_REQUIRED',
      'Primero debes responder el canto pendiente.',
    );
  }
}

function isFirstBettingWindowOpen(state: GameState): boolean {
  return state.rounds.length === 0 && state.currentRoundCards.length < state.players.length;
}

function hasFlor(state: GameState, playerId: string): boolean {
  return calculateFlor(state.hands[playerId] ?? []) !== null;
}

function getFlorCalls(state: GameState): FlorCall[] {
  state.flor.calls ??= [];
  return state.flor.calls;
}

function canActInInitialBettingWindow(state: GameState, actorId: string): boolean {
  return (
    isFirstBettingWindowOpen(state) &&
    (state.currentTurnPlayerId === actorId || state.truco.pending?.responderId === actorId)
  );
}

function canCallEnvidoForState(state: GameState, actorId: string): boolean {
  const pending = state.envido.pending;
  const actorHasFlor = state.withFlor && hasFlor(state, actorId);

  if (state.flor.pending || state.flor.resolved || state.envido.resolved) {
    return false;
  }

  if (pending) {
    return pending.responderId === actorId && !actorHasFlor;
  }

  return (
    state.envido.calls.length === 0 && !actorHasFlor && canActInInitialBettingWindow(state, actorId)
  );
}

export function canCallEnvido(state: GameState, actorId: string): boolean {
  return canCallEnvidoForState(state, actorId);
}

function canRaiseEnvido(state: GameState, actorId: string, call: EnvidoCall): boolean {
  if (!canCallEnvidoForState(state, actorId)) {
    return false;
  }

  if (!state.envido.pending || state.envido.pending.responderId !== actorId) {
    return false;
  }

  if (call === 'envido') {
    return (
      !state.envido.calls.includes('real_envido') &&
      !state.envido.calls.includes('falta_envido') &&
      state.envido.calls.filter((item) => item === 'envido').length < 2
    );
  }

  if (call === 'real_envido') {
    return (
      !state.envido.calls.includes('real_envido') && !state.envido.calls.includes('falta_envido')
    );
  }

  return !state.envido.calls.includes('falta_envido');
}

function callEnvido(state: GameState, actorId: string, call: EnvidoCall): void {
  const canCall = state.envido.pending
    ? canRaiseEnvido(state, actorId, call)
    : canCallEnvidoForState(state, actorId) && isLegalEnvidoCall(state.envido.calls, call);
  if (!canCall) {
    throw new AppError(409, 'INVALID_ENVIDO_CALL', 'Ese canto de envido no está permitido ahora.');
  }

  const responder = nextPlayer(state, actorId);
  const previousValue = calculateEnvidoAcceptedValue(
    state.envido.calls,
    state.scores,
    state.targetScore,
  );
  state.envido.calls.push(call);
  state.envido.pending = {
    type: call,
    callerId: actorId,
    responderId: responder.id,
    previousValue,
  };
}

function resolveEnvido(state: GameState, accepted: boolean): void {
  const pending = state.envido.pending;
  if (!pending) {
    throw new AppError(409, 'NO_ENVIDO_PENDING', 'No hay un envido pendiente de respuesta.');
  }

  const points = accepted
    ? calculateEnvidoAcceptedValue(state.envido.calls, state.scores, state.targetScore)
    : pending.previousValue || 1;

  if (!accepted) {
    addScore(state, getPlayerTeam(state, pending.callerId), points);
    state.envido.winnerTeam = getPlayerTeam(state, pending.callerId);
  } else {
    const scoresByPlayer = state.players.map((player) => ({
      player,
      cards: state.hands[player.id] ?? [],
      value: calculateEnvido(state.hands[player.id] ?? []),
    }));
    const highestValue = Math.max(...scoresByPlayer.map((item) => item.value));
    const winner = getPlayerOrderFromMano(state).find(
      (player) =>
        scoresByPlayer.find((item) => item.player.id === player.id)?.value === highestValue,
    );

    if (winner) {
      addScore(state, winner.team, points);
      state.envido.winnerTeam = winner.team;
    }

    state.lastAction = {
      id: randomUUID(),
      actorId: pending.responderId,
      type: 'envido_result',
      winnerId: winner?.id ?? null,
      values: Object.fromEntries(scoresByPlayer.map(({ player, value }) => [player.id, value])),
      points,
    };
    state.envido.revealCards = true;
    state.envido.revealPlayerId = winner?.id ?? null;
    state.envido.revealCardIds = winner
      ? getEnvidoScoringCards(
          scoresByPlayer.find((item) => item.player.id === winner.id)?.cards ?? [],
        ).map((card) => card.id)
      : [];
  }

  state.envido.pending = null;
  state.envido.resolved = true;
  revealEnvidoCards(state);
}

function getFlorResponder(state: GameState, callerId: string): GamePlayer | null {
  const callerTeam = getPlayerTeam(state, callerId);
  return (
    getPlayerOrderFromMano(state).find(
      (player) => player.team !== callerTeam && hasFlor(state, player.id),
    ) ?? null
  );
}

function canCallFlorForState(state: GameState, actorId: string): boolean {
  return (
    state.withFlor &&
    !state.flor.pending &&
    !state.flor.resolved &&
    getFlorCalls(state).length === 0 &&
    state.envido.calls.length === 0 &&
    !state.envido.pending &&
    hasFlor(state, actorId) &&
    canActInInitialBettingWindow(state, actorId)
  );
}

function canRaiseFlor(state: GameState, actorId: string, call: FlorCall): boolean {
  const pending = state.flor.pending;
  const calls = getFlorCalls(state);
  if (!pending || pending.responderId !== actorId || !hasFlor(state, actorId)) {
    return false;
  }

  if (call === 'contra_flor') {
    return pending.type === 'flor' && !calls.includes('contra_flor');
  }

  return (
    call === 'contra_flor_al_resto' &&
    pending.type === 'contra_flor' &&
    !calls.includes('contra_flor_al_resto')
  );
}

function settleFlorWithoutChallenge(state: GameState, winnerTeam: Team): void {
  addScore(
    state,
    winnerTeam,
    calculateFlorAcceptedValue(getFlorCalls(state), state.scores, state.targetScore),
  );
  state.flor.pending = null;
  state.flor.winnerTeam = winnerTeam;
  state.flor.resolved = true;
}

function callFlor(state: GameState, actorId: string, call: FlorCall): void {
  if (!state.withFlor) {
    throw new AppError(409, 'FLOR_DISABLED', 'Esta sala se está jugando sin flor.');
  }

  const pending = state.flor.pending;
  if (pending) {
    if (!canRaiseFlor(state, actorId, call)) {
      throw new AppError(409, 'INVALID_FLOR_CALL', 'Ese canto de flor no está permitido ahora.');
    }

    const previousValue = calculateFlorAcceptedValue(
      getFlorCalls(state),
      state.scores,
      state.targetScore,
    );
    getFlorCalls(state).push(call);
    const responder = getFlorResponder(state, actorId);
    if (!responder) {
      settleFlorWithoutChallenge(state, getPlayerTeam(state, actorId));
      return;
    }

    state.flor.pending = {
      type: call,
      callerId: actorId,
      responderId: responder.id,
      previousValue,
    };
    return;
  }

  if (call !== 'flor' || !canCallFlorForState(state, actorId)) {
    throw new AppError(409, 'INVALID_FLOR_CALL', 'La flor no está disponible en este estado.');
  }

  getFlorCalls(state).push(call);
  const responder = getFlorResponder(state, actorId);
  if (!responder) {
    settleFlorWithoutChallenge(state, getPlayerTeam(state, actorId));
    return;
  }

  state.flor.pending = {
    type: call,
    callerId: actorId,
    responderId: responder.id,
    previousValue: calculateFlorAcceptedValue([], state.scores, state.targetScore),
  };
}

function resolveFlor(state: GameState, accepted: boolean): void {
  const pending = state.flor.pending;
  if (!pending) {
    throw new AppError(409, 'NO_FLOR_PENDING', 'No hay una flor pendiente de respuesta.');
  }

  const points = accepted
    ? calculateFlorAcceptedValue(getFlorCalls(state), state.scores, state.targetScore)
    : pending.previousValue;

  if (!accepted) {
    addScore(state, getPlayerTeam(state, pending.callerId), points);
    state.flor.winnerTeam = getPlayerTeam(state, pending.callerId);
  } else {
    const playersWithFlor = getPlayerOrderFromMano(state)
      .map((player) => ({ player, value: calculateFlor(state.hands[player.id] ?? []) }))
      .filter((item): item is { player: GamePlayer; value: number } => item.value !== null);
    const winner = playersWithFlor.sort((first, second) => second.value - first.value)[0];
    if (winner) {
      addScore(state, winner.player.team, points);
      state.flor.winnerTeam = winner.player.team;
    }
  }

  state.flor.pending = null;
  state.flor.resolved = true;
}

function callTruco(state: GameState, actorId: string, call: TrucoCall): void {
  const expectedLevel = call === 'truco' ? 0 : call === 'retruco' ? 1 : 2;
  const nextLevel = (expectedLevel + 1) as 1 | 2 | 3;
  if (state.truco.level !== expectedLevel) {
    throw new AppError(
      409,
      'INVALID_TRUCO_CALL',
      'Ese canto de truco no corresponde al estado actual.',
    );
  }

  const pending = state.truco.pending;
  if (pending) {
    if (pending.responderId !== actorId || call === 'truco') {
      throw new AppError(409, 'INVALID_TRUCO_CALLER', 'Debes responder el canto pendiente.');
    }
  } else {
    if (!state.truco.teamWithRaiseRight && state.currentTurnPlayerId !== actorId) {
      throw new AppError(409, 'INVALID_TURN', 'No es el turno de este jugador.');
    }

    if (
      state.truco.teamWithRaiseRight &&
      state.truco.teamWithRaiseRight !== getPlayerTeam(state, actorId)
    ) {
      throw new AppError(
        409,
        'INVALID_TRUCO_CALLER',
        'El rival tiene el derecho a subir el truco.',
      );
    }
  }

  state.truco.pending = {
    type: call,
    callerId: actorId,
    responderId: nextPlayer(state, actorId).id,
    previousValue: pending ? state.truco.level : expectedLevel + 1,
  };
  state.truco.lastCallerId = actorId;
  state.truco.level = nextLevel;
}

function resolveTruco(state: GameState, accepted: boolean): void {
  const pending = state.truco.pending;
  if (!pending) {
    throw new AppError(409, 'NO_TRUCO_PENDING', 'No hay un truco pendiente de respuesta.');
  }

  if (!accepted) {
    addScore(state, getPlayerTeam(state, pending.callerId), pending.previousValue);
    state.handStatus = 'finished';
    state.handWinnerTeam = getPlayerTeam(state, pending.callerId);
    revealEnvidoCards(state);
  } else {
    state.truco.teamWithRaiseRight = null;
    state.currentTurnPlayerId = pending.callerId;
  }

  state.truco.pending = null;
}

function foldHand(state: GameState, actorId: string): void {
  if (state.envido.pending) {
    if (state.envido.pending.responderId !== actorId) {
      throw new AppError(409, 'INVALID_FOLD', 'No puedes irte al mazo en este momento.');
    }

    const winnerTeam = getPlayerTeam(state, state.envido.pending.callerId);
    state.envido.pending = null;
    state.envido.resolved = true;
    addScore(state, winnerTeam, 2);
    state.handStatus = 'finished';
    state.handWinnerTeam = winnerTeam;
    revealEnvidoCards(state);
    return;
  }

  if (state.truco.pending) {
    if (state.truco.pending.responderId !== actorId) {
      throw new AppError(409, 'INVALID_FOLD', 'No puedes irte al mazo en este momento.');
    }

    const winnerTeam = getPlayerTeam(state, state.truco.pending.callerId);
    state.truco.pending = null;
    addScore(state, winnerTeam, 1);
    state.handStatus = 'finished';
    state.handWinnerTeam = winnerTeam;
    revealEnvidoCards(state);
    return;
  }

  if (state.currentTurnPlayerId !== actorId || state.flor.pending) {
    throw new AppError(409, 'INVALID_FOLD', 'No puedes irte al mazo en este momento.');
  }

  const winnerTeam = opposingTeam(getPlayerTeam(state, actorId));
  const points =
    state.truco.level === 0
      ? state.rounds.length === 0 && state.envido.calls.length === 0
        ? 2
        : 1
      : state.truco.level + 1;
  addScore(state, winnerTeam, points);
  state.handStatus = 'finished';
  state.handWinnerTeam = winnerTeam;
  revealEnvidoCards(state);
}

function getActionContext(
  action: GameActionType,
  responseContext: 'truco' | 'envido' | 'flor' | null,
): 'truco' | 'envido' | 'flor' | 'fold' {
  if (action === 'fold') {
    return 'fold';
  }

  if (responseContext) {
    return responseContext;
  }

  if (action === 'flor' || action === 'contra_flor' || action === 'contra_flor_al_resto') {
    return 'flor';
  }

  if (action === 'envido' || action === 'real_envido' || action === 'falta_envido') {
    return 'envido';
  }

  return 'truco';
}

function finishHand(state: GameState, winnerTeam: Team): void {
  state.handStatus = 'finished';
  state.handWinnerTeam = winnerTeam;
  addScore(state, winnerTeam, state.truco.level === 0 ? 1 : state.truco.level + 1);
  revealEnvidoCards(state);
}

function playCard(state: GameState, actorId: string, cardId: string): void {
  assertNoPendingCall(state);

  if (state.handStatus !== 'playing') {
    throw new AppError(409, 'HAND_FINISHED', 'La mano ya terminó.');
  }

  if (state.currentTurnPlayerId !== actorId) {
    throw new AppError(409, 'INVALID_TURN', 'No es el turno de este jugador.');
  }

  const hand = state.hands[actorId] ?? [];
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1) {
    throw new AppError(409, 'CARD_NOT_IN_HAND', 'La carta no está en tu mano.');
  }

  const [card] = hand.splice(cardIndex, 1);
  state.currentRoundCards.push({ playerId: actorId, card: card! });

  if (state.currentRoundCards.length < state.players.length) {
    state.currentTurnPlayerId = nextPlayer(state, actorId).id;
    return;
  }

  const winner = getRoundWinner(state.currentRoundCards);
  const round = getRoundTeam(state, {
    cards: state.currentRoundCards,
    winnerPlayerId: winner.winnerPlayerId,
    winnerTeam: winner.winnerTeam,
    result: winner.result,
  });
  state.rounds.push(round);
  state.currentRoundCards = [];

  const handWinner = getCurrentHandWinner(state);
  if (handWinner || state.rounds.length >= 3) {
    finishHand(state, handWinner ?? getPlayerTeam(state, state.manoPlayerId));
    return;
  }

  state.currentTurnPlayerId = round.winnerPlayerId ?? state.manoPlayerId;
}

function isLegalEnvidoCall(calls: EnvidoCall[], call: EnvidoCall): boolean {
  if (calls.includes('falta_envido')) {
    return false;
  }

  if (call === 'envido') {
    return !calls.includes('real_envido') && calls.filter((item) => item === 'envido').length < 2;
  }

  if (call === 'real_envido') {
    return !calls.includes('real_envido');
  }

  return true;
}

function canCallTrucoForState(state: GameState, actorId: string, call: TrucoCall): boolean {
  const expectedLevel = call === 'truco' ? 0 : call === 'retruco' ? 1 : 2;
  if (state.truco.level !== expectedLevel) {
    return false;
  }

  if (state.truco.pending) {
    return state.truco.pending.responderId === actorId && call !== 'truco';
  }

  if (state.truco.teamWithRaiseRight) {
    return state.truco.teamWithRaiseRight === getPlayerTeam(state, actorId);
  }

  return call === 'truco' && state.currentTurnPlayerId === actorId;
}

function getInitialEnvidoActions(state: GameState, actorId: string): GameActionType[] {
  if (!canCallEnvidoForState(state, actorId)) {
    return [];
  }

  return (['envido', 'real_envido', 'falta_envido'] as const).filter((call) =>
    isLegalEnvidoCall(state.envido.calls, call),
  );
}

function getEnvidoRaiseActions(state: GameState, actorId: string): GameActionType[] {
  return (['envido', 'real_envido', 'falta_envido'] as const).filter((call) =>
    canRaiseEnvido(state, actorId, call),
  );
}

function getFlorRaiseActions(state: GameState, actorId: string): GameActionType[] {
  return (['contra_flor', 'contra_flor_al_resto'] as const).filter((call) =>
    canRaiseFlor(state, actorId, call),
  );
}

function getTrucoResponseActions(state: GameState, actorId: string): GameActionType[] {
  const pending = state.truco.pending;
  if (!pending || pending.responderId !== actorId) {
    return [];
  }

  const actions: GameActionType[] = ['quiero', 'no_quiero'];
  const raise =
    pending.type === 'truco' ? 'retruco' : pending.type === 'retruco' ? 'vale_cuatro' : null;
  if (raise && canCallTrucoForState(state, actorId, raise)) {
    actions.push(raise);
  }

  return actions;
}

export function getAvailableActions(state: GameState, actorId: string): GameActionType[] {
  getPlayer(state, actorId);
  if (state.handStatus === 'finished') {
    return [];
  }

  if (state.envido.pending) {
    if (state.envido.pending.responderId !== actorId) {
      return [];
    }

    return ['quiero', 'no_quiero', ...getEnvidoRaiseActions(state, actorId), 'fold'];
  }

  if (state.flor.pending) {
    if (state.flor.pending.responderId !== actorId) {
      return [];
    }

    return ['quiero', 'no_quiero', ...getFlorRaiseActions(state, actorId)];
  }

  if (state.truco.pending) {
    if (state.truco.pending.responderId !== actorId) {
      return [];
    }

    const actions = getTrucoResponseActions(state, actorId);
    if (state.truco.pending.type === 'truco') {
      if (canCallFlorForState(state, actorId)) {
        actions.push('flor');
      } else {
        actions.push(...getInitialEnvidoActions(state, actorId));
      }
    }
    actions.push('fold');
    return actions;
  }

  const actions: GameActionType[] = [];
  if (state.currentTurnPlayerId === actorId) {
    actions.push('play_card');
  }

  for (const call of ['truco', 'retruco', 'vale_cuatro'] as const) {
    if (canCallTrucoForState(state, actorId, call)) {
      actions.push(call);
      break;
    }
  }

  if (canCallFlorForState(state, actorId)) {
    actions.push('flor');
  } else {
    actions.push(...getInitialEnvidoActions(state, actorId));
  }

  if (state.currentTurnPlayerId === actorId) {
    actions.push('fold');
  }

  return actions;
}

function dealHands(players: GamePlayer[], randomSource: RandomSource): Record<string, GameCard[]> {
  const shuffledCards = shuffle(createDeck(), randomSource);
  return Object.fromEntries(
    players.map((player, index) => [player.id, shuffledCards.slice(index * 3, index * 3 + 3)]),
  );
}

export function createInitialGameState(
  playersInput: Array<Pick<GamePlayer, 'id' | 'displayName'>>,
  targetScore: 15 | 30,
  withFlor: boolean,
  randomSource: RandomSource = defaultRandomSource,
): GameState {
  if (playersInput.length !== 2 && playersInput.length !== 4) {
    throw new AppError(409, 'INVALID_PLAYER_COUNT', 'El juego necesita 2 o 4 jugadores.');
  }

  const players = playersInput.map((player, seat) => ({
    ...player,
    seat,
    team: teamForSeat(seat),
  }));
  const manoPlayerId = players[0]!.id;

  return {
    targetScore,
    withFlor,
    players,
    scores: { A: 0, B: 0 },
    manoPlayerId,
    handNumber: 1,
    hands: dealHands(players, randomSource),
    currentRoundCards: [],
    rounds: [],
    currentTurnPlayerId: manoPlayerId,
    handStatus: 'playing',
    handWinnerTeam: null,
    truco: {
      level: 0,
      pending: null,
      lastCallerId: null,
      teamWithRaiseRight: null,
    },
    envido: {
      calls: [],
      pending: null,
      resolved: false,
      winnerTeam: null,
      revealCards: false,
      revealPlayerId: null,
      revealCardIds: [],
    },
    flor: { calls: [], pending: null, resolved: false, winnerTeam: null },
    lastBotAction: null,
    lastAction: null,
    revealedCards: [],
  };
}

export function createNextHand(
  state: GameState,
  randomSource: RandomSource = defaultRandomSource,
): GameState {
  if (state.handStatus !== 'finished') {
    throw new AppError(409, 'HAND_NOT_FINISHED', 'La mano actual todavía no terminó.');
  }

  if (Math.max(state.scores.A, state.scores.B) >= state.targetScore) {
    throw new AppError(409, 'GAME_FINISHED', 'La partida ya terminó.');
  }

  const nextMano = nextPlayer(state, state.manoPlayerId).id;
  const nextState = createInitialGameState(
    state.players,
    state.targetScore,
    state.withFlor,
    randomSource,
  );
  nextState.scores = { ...state.scores };
  nextState.manoPlayerId = nextMano;
  nextState.currentTurnPlayerId = nextMano;
  nextState.handNumber = state.handNumber + 1;
  nextState.lastBotAction = state.lastBotAction;
  nextState.lastAction = state.lastAction;
  return nextState;
}

export function applyGameAction(
  sourceState: GameState,
  actorId: string,
  action: { type: GameActionType; cardId?: string },
  randomSource: RandomSource = defaultRandomSource,
): GameState {
  const state: GameState = structuredClone(sourceState);
  getPlayer(state, actorId);

  if (action.type === 'new_hand') {
    return createNextHand(state, randomSource);
  }

  if (state.handStatus === 'finished') {
    throw new AppError(409, 'HAND_FINISHED', 'La mano ya terminó.');
  }

  if (!getAvailableActions(state, actorId).includes(action.type)) {
    throw new AppError(409, 'INVALID_GAME_ACTION', 'La acción no está permitida en este estado.');
  }

  const responseContext = state.envido.pending
    ? 'envido'
    : state.flor.pending
      ? 'flor'
      : state.truco.pending
        ? 'truco'
        : null;
  let resolvedEnvido = false;

  switch (action.type) {
    case 'play_card':
      if (!action.cardId) {
        throw new AppError(400, 'CARD_REQUIRED', 'Debes indicar qué carta jugar.');
      }
      playCard(state, actorId, action.cardId);
      break;
    case 'truco':
    case 'retruco':
    case 'vale_cuatro':
      callTruco(state, actorId, action.type);
      break;
    case 'envido':
    case 'real_envido':
    case 'falta_envido':
      callEnvido(state, actorId, action.type);
      break;
    case 'flor':
    case 'contra_flor':
    case 'contra_flor_al_resto':
      callFlor(state, actorId, action.type);
      break;
    case 'fold':
      foldHand(state, actorId);
      break;
    case 'quiero':
      if (state.envido.pending) {
        assertActorCanRespond(
          state.envido.pending,
          actorId,
          'No eres quien debe responder el envido.',
        );
        resolveEnvido(state, true);
        resolvedEnvido = true;
      } else if (state.flor.pending) {
        assertActorCanRespond(state.flor.pending, actorId, 'No eres quien debe responder la flor.');
        resolveFlor(state, true);
      } else {
        assertActorCanRespond(
          state.truco.pending,
          actorId,
          'No eres quien debe responder el truco.',
        );
        resolveTruco(state, true);
      }
      break;
    case 'no_quiero':
      if (state.envido.pending) {
        assertActorCanRespond(
          state.envido.pending,
          actorId,
          'No eres quien debe responder el envido.',
        );
        resolveEnvido(state, false);
      } else if (state.flor.pending) {
        assertActorCanRespond(state.flor.pending, actorId, 'No eres quien debe responder la flor.');
        resolveFlor(state, false);
      } else {
        assertActorCanRespond(
          state.truco.pending,
          actorId,
          'No eres quien debe responder el truco.',
        );
        resolveTruco(state, false);
      }
      break;
    default:
      throw new AppError(400, 'UNKNOWN_GAME_ACTION', 'La acción de juego no es válida.');
  }

  if (action.type !== 'play_card' && !resolvedEnvido) {
    state.lastAction = {
      id: randomUUID(),
      actorId,
      type: action.type,
      context: getActionContext(action.type, responseContext),
    };
  }

  if (actorId === BOT_PLAYER_ID) {
    state.lastBotAction = { id: randomUUID(), type: action.type };
  }

  return state;
}

function chooseRandom<T>(items: T[]): T | null {
  return items.length > 0 ? items[randomInt(items.length)]! : null;
}

export function getNextBotAction(state: GameState): BotAction | null {
  if (!state.players.some((player) => player.id === BOT_PLAYER_ID)) {
    return null;
  }

  const available = getAvailableActions(state, BOT_PLAYER_ID);
  if (available.length === 0) {
    return null;
  }

  const responseActions = available.filter((action) => action !== 'play_card');
  if (responseActions.includes('quiero') || responseActions.includes('no_quiero')) {
    if (responseActions.includes('no_quiero') && randomInt(100) < 20) {
      return { type: 'no_quiero' };
    }

    const raises = responseActions.filter(
      (action) => action !== 'quiero' && action !== 'no_quiero',
    );
    if (raises.length > 0 && randomInt(100) < 35) {
      const raise = chooseRandom(raises);
      if (raise) {
        return { type: raise };
      }
    }

    if (responseActions.includes('quiero')) {
      return { type: 'quiero' };
    }
  }

  if (available.includes('play_card') && state.currentTurnPlayerId === BOT_PLAYER_ID) {
    const botCard = [...(state.hands[BOT_PLAYER_ID] ?? [])].sort(
      (first, second) => first.power - second.power,
    )[0];
    return botCard ? { type: 'play_card', cardId: botCard.id } : null;
  }

  const voluntaryCalls = responseActions.filter((action) => action !== 'fold');
  if (voluntaryCalls.length > 0 && randomInt(100) < 35) {
    const call = chooseRandom(voluntaryCalls);
    if (call) {
      return { type: call };
    }
  }

  return null;
}

export function canBotAct(state: GameState): boolean {
  return (
    state.players.some((player) => player.id === BOT_PLAYER_ID) &&
    getAvailableActions(state, BOT_PLAYER_ID).length > 0
  );
}

export function applyNextBotAction(sourceState: GameState): GameState {
  const state = structuredClone(sourceState);
  const action = getNextBotAction(state);
  return action ? applyGameAction(state, BOT_PLAYER_ID, action) : state;
}

export function applyBotTurns(sourceState: GameState): GameState {
  let state = structuredClone(sourceState);

  for (let turn = 0; turn < 8; turn += 1) {
    if (state.handStatus === 'finished') {
      return state;
    }

    const action = getNextBotAction(state);
    if (!action) {
      return state;
    }

    state = applyGameAction(state, BOT_PLAYER_ID, action);
  }

  return state;
}

export type PublicGameState = {
  targetScore: 15 | 30;
  withFlor: boolean;
  scores: Record<Team, number>;
  manoPlayerId: string;
  handNumber: number;
  currentTurnPlayerId: string;
  handStatus: GameState['handStatus'];
  handWinnerTeam: Team | null;
  availableActions: GameActionType[];
  lastBotAction: BotActionNotice | null;
  lastAction: GameActionNotice | null;
  players: Array<GamePlayer & { cards: GameCard[] | null; cardCount: number; isSelf: boolean }>;
  currentRoundCards: PlayedGameCard[];
  playedCards: Array<PlayedGameCard & { roundNumber: number }>;
  revealedCards: PlayedGameCard[];
  rounds: RoundState[];
  truco: Pick<GameState['truco'], 'level' | 'teamWithRaiseRight'> & {
    pending: (PendingCall<TrucoCall> & { canRespond: boolean }) | null;
  };
  envido: Pick<GameState['envido'], 'calls' | 'resolved' | 'winnerTeam'> & {
    pending: (PendingCall<EnvidoCall> & { canRespond: boolean }) | null;
  };
  flor: Pick<GameState['flor'], 'calls' | 'resolved' | 'winnerTeam'> & {
    pending: (PendingCall<FlorCall> & { canRespond: boolean }) | null;
  };
};

export function toPublicGameState(state: GameState, userId: string): PublicGameState {
  getPlayer(state, userId);
  const publicPending = <T extends string>(pending: PendingCall<T> | null) =>
    pending ? { ...pending, canRespond: pending.responderId === userId } : null;

  return {
    targetScore: state.targetScore,
    withFlor: state.withFlor,
    scores: state.scores,
    manoPlayerId: state.manoPlayerId,
    handNumber: state.handNumber,
    currentTurnPlayerId: state.currentTurnPlayerId,
    handStatus: state.handStatus,
    handWinnerTeam: state.handWinnerTeam,
    availableActions: getAvailableActions(state, userId),
    lastBotAction: state.lastBotAction ?? null,
    lastAction: state.lastAction ?? null,
    players: state.players.map((player) => ({
      ...player,
      cards: player.id === userId ? (state.hands[player.id] ?? []) : null,
      cardCount: (state.hands[player.id] ?? []).length,
      isSelf: player.id === userId,
    })),
    currentRoundCards: state.currentRoundCards,
    playedCards: state.rounds.flatMap((round, roundNumber) =>
      round.cards.map((card) => ({ ...card, roundNumber })),
    ),
    revealedCards: state.revealedCards ?? [],
    rounds: state.rounds,
    truco: {
      level: state.truco.level,
      teamWithRaiseRight: state.truco.teamWithRaiseRight,
      pending: publicPending(state.truco.pending),
    },
    envido: {
      calls: state.envido.calls,
      resolved: state.envido.resolved,
      winnerTeam: state.envido.winnerTeam,
      pending: publicPending(state.envido.pending),
    },
    flor: {
      calls: getFlorCalls(state),
      resolved: state.flor.resolved,
      winnerTeam: state.flor.winnerTeam,
      pending: publicPending(state.flor.pending),
    },
  };
}
