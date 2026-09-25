import { describe, expect, it } from 'vitest';

import {
  applyBotTurns,
  applyGameAction,
  BOT_PLAYER_ID,
  calculateEnvido,
  calculateEnvidoAcceptedValue,
  calculateEnvidoRejectedValue,
  calculateFaltaEnvidoValue,
  createDeck,
  createInitialGameState,
  getAvailableActions,
  getHandWinner,
  toPublicGameState,
  type GameState,
} from '../src/modules/games/game.engine';

const players = [
  { id: 'player-1', displayName: 'Jugador 1' },
  { id: 'player-2', displayName: 'Jugador 2' },
];

function createState(): GameState {
  return createInitialGameState(players, 30, true, () => 0);
}

function createNoFlorState(withFlor = false): GameState {
  const state = createInitialGameState(players, 30, withFlor, () => 0);
  const deck = createDeck();
  state.hands = {
    'player-1': [
      deck.find((card) => card.id === '1-espadas')!,
      deck.find((card) => card.id === '4-copas')!,
      deck.find((card) => card.id === '5-bastos')!,
    ],
    'player-2': [
      deck.find((card) => card.id === '2-espadas')!,
      deck.find((card) => card.id === '6-copas')!,
      deck.find((card) => card.id === '7-bastos')!,
    ],
  };
  return state;
}

describe('truco game engine', () => {
  it('calculates opening actions from flor configuration and cards', () => {
    expect(getAvailableActions(createNoFlorState(), 'player-1')).toEqual([
      'play_card',
      'truco',
      'envido',
      'real_envido',
      'falta_envido',
      'fold',
    ]);

    const state = createNoFlorState(true);
    const deck = createDeck();
    state.hands['player-1'] = [
      deck.find((card) => card.id === '1-espadas')!,
      deck.find((card) => card.id === '2-espadas')!,
      deck.find((card) => card.id === '3-espadas')!,
    ];

    expect(getAvailableActions(state, 'player-1')).toEqual(['play_card', 'truco', 'flor', 'fold']);

    const withoutFlorRules = createState();
    withoutFlorRules.withFlor = false;
    withoutFlorRules.hands['player-1'] = [
      deck.find((card) => card.id === '1-espadas')!,
      deck.find((card) => card.id === '2-espadas')!,
      deck.find((card) => card.id === '3-espadas')!,
    ];
    expect(getAvailableActions(withoutFlorRules, 'player-1')).toContain('envido');
    expect(getAvailableActions(withoutFlorRules, 'player-1')).not.toContain('flor');
  });

  it('follows the legal envido raise matrix', () => {
    let state = createNoFlorState();
    state = applyGameAction(state, 'player-1', { type: 'envido' });
    expect(getAvailableActions(state, 'player-2')).toEqual([
      'quiero',
      'no_quiero',
      'envido',
      'real_envido',
      'falta_envido',
      'fold',
    ]);

    state = applyGameAction(state, 'player-2', { type: 'envido' });
    expect(getAvailableActions(state, 'player-1')).toEqual([
      'quiero',
      'no_quiero',
      'real_envido',
      'falta_envido',
      'fold',
    ]);

    state = applyGameAction(state, 'player-1', { type: 'real_envido' });
    expect(getAvailableActions(state, 'player-2')).toEqual([
      'quiero',
      'no_quiero',
      'falta_envido',
      'fold',
    ]);

    state = applyGameAction(state, 'player-2', { type: 'falta_envido' });
    expect(getAvailableActions(state, 'player-1')).toEqual(['quiero', 'no_quiero', 'fold']);
  });

  it('allows direct truco raises and preserves the raise right', () => {
    let state = createNoFlorState();
    state = applyGameAction(state, 'player-1', { type: 'truco' });
    expect(getAvailableActions(state, 'player-2')).toContain('retruco');

    state = applyGameAction(state, 'player-2', { type: 'retruco' });
    expect(getAvailableActions(state, 'player-1')).toContain('vale_cuatro');
    expect(getAvailableActions(state, 'player-2')).toEqual([]);

    state = applyGameAction(state, 'player-1', { type: 'vale_cuatro' });
    expect(getAvailableActions(state, 'player-2')).toEqual(['quiero', 'no_quiero', 'fold']);
  });

  it('follows the flor raise matrix and does not create a response without rival flor', () => {
    let state = createState();
    const deck = createDeck();
    state.hands = {
      'player-1': [
        deck.find((card) => card.id === '1-espadas')!,
        deck.find((card) => card.id === '2-espadas')!,
        deck.find((card) => card.id === '3-espadas')!,
      ],
      'player-2': [
        deck.find((card) => card.id === '4-copas')!,
        deck.find((card) => card.id === '5-copas')!,
        deck.find((card) => card.id === '6-copas')!,
      ],
    };

    state = applyGameAction(state, 'player-1', { type: 'flor' });
    expect(getAvailableActions(state, 'player-2')).toEqual(['quiero', 'no_quiero', 'contra_flor']);

    state = applyGameAction(state, 'player-2', { type: 'contra_flor' });
    expect(getAvailableActions(state, 'player-1')).toEqual([
      'quiero',
      'no_quiero',
      'contra_flor_al_resto',
    ]);

    state = applyGameAction(state, 'player-1', { type: 'contra_flor_al_resto' });
    expect(getAvailableActions(state, 'player-2')).toEqual(['quiero', 'no_quiero']);
  });

  it('ends the response after quiero and gives the next play to the caller', () => {
    let state = createState();
    state = applyGameAction(state, 'player-1', { type: 'truco' });
    state = applyGameAction(state, 'player-2', { type: 'quiero' });

    expect(getAvailableActions(state, 'player-2')).toEqual([]);
    expect(getAvailableActions(state, 'player-2')).not.toContain('retruco');
    expect(getAvailableActions(state, 'player-1')).toContain('play_card');
    expect(getAvailableActions(state, 'player-1')).not.toContain('retruco');
    expect(state.currentTurnPlayerId).toBe('player-1');
    expect(state.scores).toEqual({ A: 0, B: 0 });
  });

  it('keeps the direct retruco response and resumes with the caller', () => {
    let state = createState();
    state = applyGameAction(state, 'player-1', { type: 'truco' });
    state = applyGameAction(state, 'player-2', { type: 'retruco' });
    state = applyGameAction(state, 'player-1', { type: 'quiero' });

    expect(getAvailableActions(state, 'player-1')).toEqual([]);
    expect(getAvailableActions(state, 'player-2')).toContain('play_card');
    expect(state.currentTurnPlayerId).toBe('player-2');
  });

  it('awards two points when the responder folds on an envido', () => {
    let state = createNoFlorState();
    state = applyGameAction(state, 'player-1', { type: 'envido' });
    expect(getAvailableActions(state, 'player-2')).toContain('fold');

    state = applyGameAction(state, 'player-2', { type: 'fold' });

    expect(state.scores).toEqual({ A: 2, B: 0 });
    expect(state.handStatus).toBe('finished');
  });

  it('awards one point when the responder folds on a truco', () => {
    let state = createNoFlorState();
    state = applyGameAction(state, 'player-1', { type: 'truco' });
    expect(getAvailableActions(state, 'player-2')).toContain('fold');

    state = applyGameAction(state, 'player-2', { type: 'fold' });

    expect(state.scores).toEqual({ A: 1, B: 0 });
    expect(state.handStatus).toBe('finished');
  });

  it('calculates envido with figures and same-suit cards', () => {
    expect(
      calculateEnvido([
        { suit: 'oros', envidoValue: 7 },
        { suit: 'oros', envidoValue: 6 },
        { suit: 'oros', envidoValue: 0 },
      ]),
    ).toBe(33);
    expect(
      calculateEnvido([
        { suit: 'oros', envidoValue: 0 },
        { suit: 'espadas', envidoValue: 0 },
        { suit: 'copas', envidoValue: 4 },
      ]),
    ).toBe(4);
  });

  it('calculates accepted and rejected envido sequences', () => {
    expect(calculateEnvidoAcceptedValue(['envido', 'real_envido'], { A: 0, B: 0 }, 30)).toBe(5);
    expect(calculateEnvidoRejectedValue(['envido', 'real_envido'], { A: 0, B: 0 }, 30)).toBe(2);
    expect(calculateEnvidoRejectedValue(['envido'], { A: 0, B: 0 }, 30)).toBe(1);
  });

  it('allows an envido chain and resolves it independently from truco', () => {
    let state = createState();
    const deck = createDeck();
    state.hands = {
      'player-1': [
        deck.find((card) => card.id === '1-espadas')!,
        deck.find((card) => card.id === '4-copas')!,
        deck.find((card) => card.id === '5-copas')!,
      ],
      'player-2': [
        deck.find((card) => card.id === '4-bastos')!,
        deck.find((card) => card.id === '5-bastos')!,
        deck.find((card) => card.id === '6-copas')!,
      ],
    };
    state = applyGameAction(state, 'player-1', { type: 'truco' });
    state = applyGameAction(state, 'player-2', { type: 'envido' });
    state = applyGameAction(state, 'player-1', { type: 'quiero' });
    state = applyGameAction(state, 'player-2', { type: 'quiero' });

    expect(state.envido.resolved).toBe(true);
    expect(state.truco.level).toBe(1);
    expect(state.truco.pending).toBeNull();
  });

  it('announces both envido values after it is accepted', () => {
    let state = createNoFlorState();

    state = applyGameAction(state, 'player-1', { type: 'envido' });
    state = applyGameAction(state, 'player-2', { type: 'quiero' });

    expect(state.lastAction).toMatchObject({
      type: 'envido_result',
      winnerId: 'player-2',
      values: { 'player-1': 5, 'player-2': 7 },
    });
  });

  it('reveals the unplayed envido cards before the winning hand is reset', () => {
    let state = createNoFlorState();
    const deck = createDeck();
    state.hands = {
      'player-1': [
        deck.find((card) => card.id === '1-espadas')!,
        deck.find((card) => card.id === '7-espadas')!,
        deck.find((card) => card.id === '3-copas')!,
      ],
      'player-2': [
        deck.find((card) => card.id === '4-bastos')!,
        deck.find((card) => card.id === '5-copas')!,
        deck.find((card) => card.id === '6-oros')!,
      ],
    };

    state = applyGameAction(state, 'player-1', { type: 'envido' });
    state = applyGameAction(state, 'player-2', { type: 'quiero' });
    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '1-espadas' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '4-bastos' });
    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '3-copas' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '5-copas' });

    expect(state.handStatus).toBe('finished');
    expect(state.lastAction).toMatchObject({
      type: 'envido_result',
      winnerId: 'player-1',
      values: { 'player-1': 28 },
    });
    expect(state.revealedCards.map(({ playerId, card }) => `${playerId}:${card.id}`)).toEqual([
      'player-1:7-espadas',
    ]);
    expect(state.hands['player-1']).toEqual([]);
    expect(state.hands['player-2']?.map((card) => card.id)).toEqual(['6-oros']);

    const publicState = toPublicGameState(state, 'player-2');
    expect(publicState.revealedCards.map(({ card }) => card.id)).toEqual([
      '7-espadas',
    ]);
    expect(publicState.players.find((player) => player.id === 'player-1')?.cards).toBeNull();
  });

  it('reveals the rival cards when the rival wins the envido and the hand', () => {
    let state = createNoFlorState();
    const deck = createDeck();
    state.hands = {
      'player-1': [
        deck.find((card) => card.id === '4-copas')!,
        deck.find((card) => card.id === '5-bastos')!,
        deck.find((card) => card.id === '6-oros')!,
      ],
      'player-2': [
        deck.find((card) => card.id === '1-espadas')!,
        deck.find((card) => card.id === '7-espadas')!,
        deck.find((card) => card.id === '3-copas')!,
      ],
    };

    state = applyGameAction(state, 'player-1', { type: 'envido' });
    state = applyGameAction(state, 'player-2', { type: 'quiero' });
    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '4-copas' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '1-espadas' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '3-copas' });
    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '5-bastos' });

    expect(state.handStatus).toBe('finished');
    expect(state.lastAction).toMatchObject({
      type: 'envido_result',
      winnerId: 'player-2',
      values: { 'player-2': 28 },
    });
    expect(state.revealedCards.map(({ playerId, card }) => `${playerId}:${card.id}`)).toEqual([
      'player-2:7-espadas',
    ]);
    expect(state.hands['player-1']?.map((card) => card.id)).toEqual(['6-oros']);
    expect(state.hands['player-2']).toEqual([]);
  });

  it('reveals only the cards that form the winning envido when the winner folds before playing', () => {
    let state = createNoFlorState();
    const deck = createDeck();
    state.hands = {
      'player-1': [
        deck.find((card) => card.id === '4-oros')!,
        deck.find((card) => card.id === '7-oros')!,
        deck.find((card) => card.id === '6-bastos')!,
      ],
      'player-2': [
        deck.find((card) => card.id === '1-espadas')!,
        deck.find((card) => card.id === '4-copas')!,
        deck.find((card) => card.id === '5-bastos')!,
      ],
    };

    state = applyGameAction(state, 'player-1', { type: 'envido' });
    state = applyGameAction(state, 'player-2', { type: 'quiero' });
    state = applyGameAction(state, 'player-1', { type: 'fold' });

    expect(state.lastAction).toMatchObject({ type: 'fold', actorId: 'player-1' });
    expect(state.revealedCards.map(({ card }) => card.id)).toEqual([
      '4-oros',
      '7-oros',
    ]);
    expect(state.hands['player-1']?.map((card) => card.id)).toEqual(['6-bastos']);
  });

  it('uses mano to break an envido tie', () => {
    const deck = createDeck();
    let state = createNoFlorState();
    state.hands = {
      'player-1': [
        deck.find((card) => card.id === '1-espadas')!,
        deck.find((card) => card.id === '4-espadas')!,
        deck.find((card) => card.id === '5-bastos')!,
      ],
      'player-2': [
        deck.find((card) => card.id === '2-espadas')!,
        deck.find((card) => card.id === '3-espadas')!,
        deck.find((card) => card.id === '6-copas')!,
      ],
    };

    state = applyGameAction(state, 'player-1', { type: 'envido' });
    state = applyGameAction(state, 'player-2', { type: 'quiero' });

    expect(state.lastAction).toMatchObject({
      type: 'envido_result',
      winnerId: 'player-1',
      values: { 'player-1': 25, 'player-2': 25 },
    });
    expect(state.envido.winnerTeam).toBe('A');
  });

  it('finishes the hand and announces when a player goes to the deck', () => {
    let state = createNoFlorState();

    state = applyGameAction(state, 'player-1', { type: 'fold' });

    expect(state.handStatus).toBe('finished');
    expect(state.handWinnerTeam).toBe('B');
    expect(state.scores).toEqual({ A: 0, B: 2 });
    expect(state.lastAction).toMatchObject({ type: 'fold', actorId: 'player-1' });
  });

  it('awards one point for folding on the second or third trick', () => {
    let state = createNoFlorState();

    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '1-espadas' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '2-espadas' });
    state = applyGameAction(state, 'player-1', { type: 'fold' });

    expect(state.scores).toEqual({ A: 0, B: 1 });

    state = createNoFlorState();
    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '1-espadas' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '2-espadas' });
    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '4-copas' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '6-copas' });
    state = applyGameAction(state, 'player-2', { type: 'fold' });

    expect(state.scores).toEqual({ A: 1, B: 0 });
  });

  it('awards one point for folding in the first trick after an envido was called', () => {
    let state = createNoFlorState();

    state = applyGameAction(state, 'player-1', { type: 'envido' });
    state = applyGameAction(state, 'player-2', { type: 'quiero' });
    state = applyGameAction(state, 'player-1', { type: 'fold' });

    expect(state.scores).toEqual({ A: 0, B: 3 });
  });

  it('keeps a finished hand visible until the next hand is requested', () => {
    let state = createNoFlorState();
    state = applyGameAction(state, 'player-1', { type: 'fold' });

    expect(state.handStatus).toBe('finished');
    expect(state.hands['player-1']).toHaveLength(3);

    const nextHand = applyGameAction(state, 'player-1', { type: 'new_hand' });

    expect(nextHand.handNumber).toBe(2);
    expect(nextHand.handStatus).toBe('playing');
    expect(nextHand.currentRoundCards).toEqual([]);
    expect(nextHand.rounds).toEqual([]);
    expect(nextHand.hands['player-1']).toHaveLength(3);
    expect(nextHand.hands['player-2']).toHaveLength(3);
  });

  it('calculates falta envido from malas, buenas and the match target', () => {
    expect(calculateFaltaEnvidoValue({ A: 0, B: 0 }, 15)).toBe(15);
    expect(calculateFaltaEnvidoValue({ A: 4, B: 2 }, 15)).toBe(11);
    expect(calculateFaltaEnvidoValue({ A: 10, B: 6 }, 15)).toBe(5);
    expect(calculateFaltaEnvidoValue({ A: 14, B: 8 }, 15)).toBe(1);

    expect(calculateFaltaEnvidoValue({ A: 0, B: 0 }, 30)).toBe(15);
    expect(calculateFaltaEnvidoValue({ A: 8, B: 5 }, 30)).toBe(7);
    expect(calculateFaltaEnvidoValue({ A: 14, B: 10 }, 30)).toBe(1);
    expect(calculateFaltaEnvidoValue({ A: 15, B: 10 }, 30)).toBe(15);
    expect(calculateFaltaEnvidoValue({ A: 18, B: 16 }, 30)).toBe(12);
    expect(calculateFaltaEnvidoValue({ A: 24, B: 17 }, 30)).toBe(6);
    expect(calculateFaltaEnvidoValue({ A: 29, B: 25 }, 30)).toBe(1);

    expect(calculateEnvidoAcceptedValue(['falta_envido'], { A: 0, B: 0 }, 15)).toBe(15);
  });

  it('awards the calculated falta envido value when it is accepted', () => {
    let state = createNoFlorState();
    state.targetScore = 15;
    state.scores = { A: 0, B: 0 };

    state = applyGameAction(state, 'player-1', { type: 'falta_envido' });
    state = applyGameAction(state, 'player-2', { type: 'quiero' });

    expect(state.scores).toEqual({ A: 0, B: 15 });
    expect(state.handStatus).toBe('finished');
    expect(state.handWinnerTeam).toBe('B');
    expect(getAvailableActions(state, 'player-1')).toEqual([]);
  });

  it('awards three points for a flor that is not challenged', () => {
    let state = createState();
    const deck = createDeck();
    state.hands = {
      'player-1': [
        deck.find((card) => card.id === '1-espadas')!,
        deck.find((card) => card.id === '2-espadas')!,
        deck.find((card) => card.id === '3-espadas')!,
      ],
      'player-2': [],
    };

    state = applyGameAction(state, 'player-1', { type: 'flor' });

    expect(state.scores.A).toBe(3);
    expect(state.flor.pending).toBeNull();
    expect(state.flor.resolved).toBe(true);
  });

  it('uses the mano team to break a third-round draw', () => {
    expect(
      getHandWinner([{ winnerTeam: 'A' }, { winnerTeam: 'B' }, { winnerTeam: null }], 'A'),
    ).toBe('A');
  });

  it('resolves the round winner on the backend from card power', () => {
    let state = createState();
    const deck = createDeck();
    state.hands = {
      'player-1': [deck.find((card) => card.id === '1-espadas')!],
      'player-2': [deck.find((card) => card.id === '3-copas')!],
    };

    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '1-espadas' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '3-copas' });

    expect(state.rounds[0]?.winnerPlayerId).toBe('player-1');
    expect(state.rounds[0]?.winnerTeam).toBe('A');
  });

  it('lets the bot answer a canto and play its turn on the backend', () => {
    const deck = createDeck();
    let state = createInitialGameState(
      [players[0]!, { id: BOT_PLAYER_ID, displayName: 'Bot' }],
      30,
      true,
      () => 0,
    );
    state.hands = {
      'player-1': [
        deck.find((card) => card.id === '1-espadas')!,
        deck.find((card) => card.id === '4-copas')!,
        deck.find((card) => card.id === '5-copas')!,
      ],
      [BOT_PLAYER_ID]: [
        deck.find((card) => card.id === '4-bastos')!,
        deck.find((card) => card.id === '5-bastos')!,
        deck.find((card) => card.id === '6-bastos')!,
      ],
    };

    state = applyGameAction(state, 'player-1', { type: 'envido' });
    state = applyBotTurns(state);
    expect(state.envido.resolved).toBe(true);

    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '1-espadas' });
    state = applyBotTurns(state);
    expect(state.rounds[0]?.winnerPlayerId).toBe('player-1');
    expect(state.hands[BOT_PLAYER_ID]).toHaveLength(2);
  });

  it('redeals a new hand after the same team wins the first two rounds', () => {
    const deck = createDeck();
    let state = createState();
    state.hands = {
      'player-1': [
        deck.find((card) => card.id === '1-espadas')!,
        deck.find((card) => card.id === '1-bastos')!,
        deck.find((card) => card.id === '4-copas')!,
      ],
      'player-2': [
        deck.find((card) => card.id === '3-copas')!,
        deck.find((card) => card.id === '2-copas')!,
        deck.find((card) => card.id === '5-bastos')!,
      ],
    };

    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '1-espadas' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '3-copas' });
    state = applyGameAction(state, 'player-1', { type: 'play_card', cardId: '1-bastos' });
    state = applyGameAction(state, 'player-2', { type: 'play_card', cardId: '2-copas' });

    expect(state.handStatus).toBe('finished');
    expect(state.rounds[1]?.cards).toHaveLength(2);

    const nextHand = applyGameAction(state, 'player-1', { type: 'new_hand' });

    expect(nextHand.handNumber).toBe(2);
    expect(nextHand.handStatus).toBe('playing');
    expect(nextHand.scores.A).toBe(1);
    expect(nextHand.hands['player-1']).toHaveLength(3);
    expect(nextHand.hands['player-2']).toHaveLength(3);
  });
});
