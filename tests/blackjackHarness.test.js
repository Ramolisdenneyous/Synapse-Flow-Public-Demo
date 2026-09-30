import { describe, expect, it } from 'vitest';
import { executeRouterCode } from '../server/routerSandbox.js';
import {
  BLACKJACK_ROUTER_CODE,
  createBlackjackHarness,
} from '../scripts/build-blackjack-harness.mjs';
import { routerContextFor } from '../src/engine/executor.js';

function setup() {
  const harness = createBlackjackHarness();
  const router = harness.nodes.find((node) => node.id === 'blackjack-dealer');
  return {
    harness,
    context: routerContextFor(router, harness.nodes, harness.edges),
  };
}

function withRuntime(context, randomValue, invocationId) {
  return {
    ...context,
    runtime: { randomValue, invocationId },
  };
}

async function startRound(state = {}, randomValue = 0.25, invocationId = 'deal-00000000') {
  const { context } = setup();
  return executeRouterCode({
    code: BLACKJACK_ROUTER_CODE,
    input: 'DEAL_ROUND',
    context: withRuntime(context, randomValue, invocationId),
    state,
  });
}

async function standThroughRound(started) {
  const { context } = setup();
  let current = started;
  let decisions = 0;
  while (current.payload.type !== 'round_complete' && decisions < 6) {
    current = await executeRouterCode({
      code: BLACKJACK_ROUTER_CODE,
      input: JSON.stringify({
        player: current.payload.player,
        action: 'stand',
        actionToken: current.payload.actionToken,
      }),
      context: withRuntime(context, 0.6, `stand-${decisions}-00000000`),
      state: current.state,
    });
    decisions += 1;
  }
  return current;
}

describe('three-player blackjack harness', () => {
  it('deals one Dealer and three player hands from one 52-card deck', async () => {
    const { harness } = setup();
    const result = await startRound();
    const dealtCards = Object.values(result.state.hands).flat();

    expect(new Set(dealtCards)).toHaveLength(8);
    expect(result.state.deck).toHaveLength(44);
    expect(result.state.round).toBe(1);
    expect(result.state.shoe).toBe(1);
    expect(result.targetIds).toContain('blackjack-table-display');
    expect(
      result.targetIds.filter(
        (id) => harness.nodes.find((node) => node.id === id)?.data.kind === 'agent',
      ),
    ).toHaveLength(1);
  });

  it('rejects a stale decision without advancing or changing the hand', async () => {
    const { context } = setup();
    const started = await startRound();
    const result = await executeRouterCode({
      code: BLACKJACK_ROUTER_CODE,
      input: JSON.stringify({
        player: started.payload.player,
        action: 'stand',
        actionToken: 'stale-token',
      }),
      context: withRuntime(context, 0.4, 'retry-00000000'),
      state: started.state,
    });

    expect(result.payload.type).toBe('retry');
    expect(result.state).toEqual(started.state);
    expect(result.targetIds).toContain('blackjack-table-display');
  });

  it('ends immediately when the Dealer is dealt blackjack', async () => {
    const result = await startRound({}, 0.057, 'dealer-natural');

    expect(result.payload).toMatchObject({
      type: 'round_complete',
      totals: { Dealer: 21 },
      results: {
        'Player One': 'loss',
        'Player Two': 'loss',
        'Player Three': 'loss',
      },
    });
    expect(result.payload.hands.Dealer).toHaveLength(2);
    expect(result.targetIds).toEqual([
      'blackjack-round-ledger',
      'blackjack-table-display',
    ]);
  });

  it('completes exactly one round and leaves no player continuation target', async () => {
    const completed = await standThroughRound(await startRound());

    expect(completed.payload.type).toBe('round_complete');
    expect(Object.keys(completed.payload.results)).toEqual([
      'Player One',
      'Player Two',
      'Player Three',
    ]);
    expect(completed.targetIds).toEqual([
      'blackjack-round-ledger',
      'blackjack-table-display',
    ]);
    expect(completed.state.phase).toBe('round_complete');
  });

  it('deals the next round from the exact remaining deck', async () => {
    const completed = await standThroughRound(await startRound({}, 0.15));
    const remaining = completed.state.deck.slice();
    const next = await startRound(completed.state, 0.95, 'deal-two-00000000');
    const nextDealt = [
      next.state.hands['Player One'][0],
      next.state.hands['Player Two'][0],
      next.state.hands['Player Three'][0],
      next.state.hands.Dealer[0],
      next.state.hands['Player One'][1],
      next.state.hands['Player Two'][1],
      next.state.hands['Player Three'][1],
      next.state.hands.Dealer[1],
    ];

    expect(next.state.round).toBe(2);
    expect(next.state.shoe).toBe(completed.state.shoe);
    expect(next.state.reshuffled).toBe(false);
    expect(nextDealt).toEqual(remaining.slice(0, 8));
    expect(next.state.deck).toEqual(remaining.slice(8));
  });

  it('configures the round Trigger to preserve state only on manual continuation', () => {
    const { harness } = setup();
    const trigger = harness.nodes.find(
      (node) => node.id === 'blackjack-next-round-trigger',
    );

    expect(trigger.data.config).toMatchObject({
      payload: 'DEAL_ROUND',
      continueState: true,
    });
  });
});
