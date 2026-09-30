import { describe, expect, it } from 'vitest';
import { executeRouterCode } from '../server/routerSandbox.js';
import {
  COUNTING_BLACKJACK_ROUTER_CODE,
  createCountingBlackjackHarness,
} from '../scripts/build-counting-blackjack-harness.mjs';
import { routerContextFor } from '../src/engine/executor.js';

const memoryIds = [
  'four-agent-blackjack-dealer-memory',
  'four-agent-blackjack-player-one-memory',
  'four-agent-blackjack-player-two-memory',
  'four-agent-blackjack-player-three-memory',
];

function setup() {
  const harness = createCountingBlackjackHarness();
  const router = harness.nodes.find(
    (node) => node.id === 'four-agent-blackjack-table-engine',
  );
  return {
    harness,
    context: routerContextFor(router, harness.nodes, harness.edges),
  };
}

async function execute(input, state, randomValue = 0.3, invocationId = 'counting-test') {
  const { context } = setup();
  return executeRouterCode({
    code: COUNTING_BLACKJACK_ROUTER_CODE,
    input,
    context: {
      ...context,
      runtime: { randomValue, invocationId },
    },
    state,
  });
}

async function standPlayers(started) {
  let current = started;
  let decisions = 0;
  while (current.payload.type !== 'dealer_turn' && decisions < 6) {
    if (current.payload.type === 'round_complete') return current;
    current = await execute(
      JSON.stringify({
        player: current.payload.player,
        action: 'stand',
        actionToken: current.payload.actionToken,
        countReport: current.payload.counting,
      }),
      current.state,
      0.4,
      `counting-player-${decisions}`,
    );
    decisions += 1;
  }
  return current;
}

async function completeRound(started) {
  let current = await standPlayers(started);
  let decisions = 0;
  while (current.payload.type !== 'round_complete' && decisions < 8) {
    current = await execute(
      JSON.stringify({
        dealer: 'Dealer',
        action: current.payload.legalActions[0],
        actionToken: current.payload.actionToken,
        countReport: current.payload.counting,
      }),
      current.state,
      0.5,
      `counting-dealer-${decisions}`,
    );
    decisions += 1;
  }
  return current;
}

describe('four-agent counting blackjack harness', () => {
  it('gives every Agent an isolated readable count memory', () => {
    const { harness } = setup();
    const agents = harness.nodes.filter((node) => node.data.kind === 'agent');
    const memories = harness.nodes.filter(
      (node) => node.id !== 'four-agent-blackjack-round-ledger' &&
        node.data.kind === 'memory',
    );

    expect(agents).toHaveLength(4);
    expect(memories.map((node) => node.id)).toEqual(memoryIds);

    for (const [index, memoryId] of memoryIds.entries()) {
      const agentId = [
        'four-agent-blackjack-dealer-agent',
        'four-agent-blackjack-player-one',
        'four-agent-blackjack-player-two',
        'four-agent-blackjack-player-three',
      ][index];
      expect(harness.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'four-agent-blackjack-table-engine',
            target: memoryId,
            data: { channel: 'write' },
          }),
          expect.objectContaining({
            source: memoryId,
            target: agentId,
            data: { channel: 'read' },
          }),
        ]),
      );
      expect(memories[index].data.config.operation).toBe('replace');
      expect(
        harness.edges.some(
          (edge) =>
            edge.source === memoryId &&
            edge.data.channel === 'read' &&
            edge.target !== agentId,
        ),
      ).toBe(false);
    }
  });

  it('publishes a cumulative Hi-Lo snapshot without revealing the hole card', async () => {
    const started = await execute('DEAL_ROUND', {}, 0.3, 'initial-count');
    const visibleCards = started.payload.counting.revealedCards;
    const expectedRunningCount = visibleCards.reduce((total, card) => {
      const rank = card.slice(0, -1);
      if (['2', '3', '4', '5', '6'].includes(rank)) return total + 1;
      if (['10', 'J', 'Q', 'K', 'A'].includes(rank)) return total - 1;
      return total;
    }, 0);

    expect(started.payload.counting).toMatchObject({
      system: 'Hi-Lo',
      seenCards: 7,
      cardsDealt: 8,
      runningCount: expectedRunningCount,
    });
    expect(started.payload.publicTable.dealerHand).toHaveLength(1);
    expect(started.payload.publicTable.dealerHiddenCards).toBe(1);
    expect(started.targetIds).toEqual([
      'four-agent-blackjack-player-one-memory',
      'four-agent-blackjack-player-one',
      'four-agent-blackjack-table-display',
    ]);
  });

  it('reveals and counts the Dealer hole card only when Dealer play begins', async () => {
    const dealerTurn = await standPlayers(
      await execute('DEAL_ROUND', {}, 0.3, 'dealer-reveal'),
    );

    expect(dealerTurn.payload.type).toBe('dealer_turn');
    expect(dealerTurn.state.dealerRevealed).toBe(true);
    expect(dealerTurn.payload.counting.seenCards).toBe(8);
    expect(dealerTurn.payload.publicTable.dealerHiddenCards).toBe(0);
    expect(dealerTurn.payload.publicTable.dealerHand).toHaveLength(2);
  });

  it('carries the cumulative count into the next round from the same shoe', async () => {
    const completed = await completeRound(
      await execute('DEAL_ROUND', {}, 0.22, 'count-round-one'),
    );
    const priorRevealed = completed.state.revealedCards.slice();
    const next = await execute(
      'DEAL_ROUND',
      completed.state,
      0.91,
      'count-round-two',
    );

    expect(next.state.shoe).toBe(completed.state.shoe);
    expect(next.state.reshuffled).toBe(false);
    expect(next.state.revealedCards.slice(0, priorRevealed.length)).toEqual(
      priorRevealed,
    );
    expect(next.payload.counting.seenCards).toBe(priorRevealed.length + 7);
  });

  it('synchronizes every private count memory when the round completes', async () => {
    const completed = await completeRound(
      await execute('DEAL_ROUND', {}, 0.22, 'memory-sync'),
    );

    expect(completed.targetIds).toEqual([
      ...memoryIds,
      'four-agent-blackjack-round-ledger',
      'four-agent-blackjack-table-display',
    ]);
  });

  it('resets the count when the Table Engine shuffles a fresh shoe', async () => {
    const staleState = {
      shoe: 4,
      round: 9,
      deck: Array.from({ length: 19 }, (_, index) => `${index + 2}S`),
      revealedCards: ['OLD-SHOE-CARD'],
    };
    const started = await execute(
      'DEAL_ROUND',
      staleState,
      0.7,
      'fresh-shoe',
    );

    expect(started.state.shoe).toBe(5);
    expect(started.state.reshuffled).toBe(true);
    expect(started.state.revealedCards).toHaveLength(7);
    expect(started.state.revealedCards).not.toContain('OLD-SHOE-CARD');
  });
});
