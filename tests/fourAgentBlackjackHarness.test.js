import { describe, expect, it } from 'vitest';
import { executeRouterCode } from '../server/routerSandbox.js';
import {
  FOUR_AGENT_BLACKJACK_ROUTER_CODE,
  createFourAgentBlackjackHarness,
} from '../scripts/build-four-agent-blackjack-harness.mjs';
import { routerContextFor } from '../src/engine/executor.js';

function setup() {
  const harness = createFourAgentBlackjackHarness();
  const router = harness.nodes.find(
    (node) => node.id === 'four-agent-blackjack-table-engine',
  );
  return {
    harness,
    context: routerContextFor(router, harness.nodes, harness.edges),
  };
}

function runtime(context, randomValue, invocationId) {
  return { ...context, runtime: { randomValue, invocationId } };
}

async function execute(input, state, randomValue = 0.3, invocationId = 'test-call') {
  const { context } = setup();
  return executeRouterCode({
    code: FOUR_AGENT_BLACKJACK_ROUTER_CODE,
    input,
    context: runtime(context, randomValue, invocationId),
    state,
  });
}

async function startRound(state = {}, randomValue = 0.3) {
  return execute('DEAL_ROUND', state, randomValue, 'deal-round');
}

async function standPlayers(started) {
  let current = started;
  let decisions = 0;
  while (current.payload.type !== 'dealer_turn' && decisions < 6) {
    current = await execute(
      JSON.stringify({
        player: current.payload.player,
        action: 'stand',
        actionToken: current.payload.actionToken,
      }),
      current.state,
      0.4,
      `player-${decisions}`,
    );
    decisions += 1;
  }
  return current;
}

async function finishDealer(started) {
  let current = started;
  let decisions = 0;
  while (current.payload.type !== 'round_complete' && decisions < 8) {
    current = await execute(
      JSON.stringify({
        dealer: 'Dealer',
        action: current.payload.legalActions[0],
        actionToken: current.payload.actionToken,
      }),
      current.state,
      0.5,
      `dealer-${decisions}`,
    );
    decisions += 1;
  }
  return current;
}

describe('four-agent blackjack harness', () => {
  it('contains a distinct Dealer Agent and authoritative Table Engine', () => {
    const { harness } = setup();
    const dealer = harness.nodes.find(
      (node) => node.id === 'four-agent-blackjack-dealer-agent',
    );
    const engine = harness.nodes.find(
      (node) => node.id === 'four-agent-blackjack-table-engine',
    );

    expect(dealer.data.kind).toBe('agent');
    expect(dealer.data.label).toBe('Dealer Agent');
    expect(engine.data.kind).toBe('logic');
    expect(harness.nodes.filter((node) => node.data.kind === 'agent')).toHaveLength(4);
  });

  it('routes to the Dealer Agent after all player hands finish', async () => {
    const dealerTurn = await standPlayers(await startRound());

    expect(dealerTurn.payload).toMatchObject({
      type: 'dealer_turn',
      dealer: 'Dealer',
    });
    expect(dealerTurn.targetIds).toEqual([
      'four-agent-blackjack-dealer-agent',
      'four-agent-blackjack-table-display',
    ]);
  });

  it('rejects an illegal Dealer action and retries the Dealer Agent', async () => {
    const dealerTurn = await standPlayers(await startRound());
    const illegalAction = dealerTurn.payload.legalActions[0] === 'hit' ? 'stand' : 'hit';
    const retried = await execute(
      JSON.stringify({
        dealer: 'Dealer',
        action: illegalAction,
        actionToken: dealerTurn.payload.actionToken,
      }),
      dealerTurn.state,
      0.5,
      'bad-dealer-action',
    );

    expect(retried.payload.type).toBe('dealer_retry');
    expect(retried.state).toEqual(dealerTurn.state);
    expect(retried.targetIds).toContain('four-agent-blackjack-dealer-agent');
  });

  it('lets the Dealer Agent finish the round before terminal routing', async () => {
    const completed = await finishDealer(
      await standPlayers(await startRound({}, 0.3)),
    );

    expect(completed.payload.type).toBe('round_complete');
    expect(completed.targetIds).toEqual([
      'four-agent-blackjack-round-ledger',
      'four-agent-blackjack-table-display',
    ]);
    expect(completed.state.phase).toBe('round_complete');
  });

  it('continues the next round from the exact remaining deck', async () => {
    const completed = await finishDealer(
      await standPlayers(await startRound({}, 0.22)),
    );
    const remaining = completed.state.deck.slice();
    const next = await startRound(completed.state, 0.91);
    const hands = next.state.hands;
    const dealt = [
      hands['Player One'][0],
      hands['Player Two'][0],
      hands['Player Three'][0],
      hands.Dealer[0],
      hands['Player One'][1],
      hands['Player Two'][1],
      hands['Player Three'][1],
      hands.Dealer[1],
    ];

    expect(next.state.round).toBe(2);
    expect(next.state.shoe).toBe(completed.state.shoe);
    expect(next.state.reshuffled).toBe(false);
    expect(dealt).toEqual(remaining.slice(0, 8));
    expect(next.state.deck).toEqual(remaining.slice(8));
  });
});
