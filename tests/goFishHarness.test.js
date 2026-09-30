import { describe, expect, it } from 'vitest';
import { executeRouterCode } from '../server/routerSandbox.js';
import {
  GO_FISH_ROUTER_CODE,
  createGoFishHarness,
} from '../scripts/build-go-fish-harness.mjs';
import {
  executeNode,
  routerContextFor,
} from '../src/engine/executor.js';
import { diagnoseGraph } from '../src/engine/graphDiagnostics.js';

function setup() {
  const harness = createGoFishHarness();
  const router = harness.nodes.find((node) => node.id === 'go-fish-engine');
  return {
    harness,
    context: routerContextFor(router, harness.nodes, harness.edges),
  };
}

async function execute(input, state, randomValue = 0.37, invocationId = 'go-fish-test') {
  const { context } = setup();
  return executeRouterCode({
    code: GO_FISH_ROUTER_CODE,
    input,
    context: {
      ...context,
      runtime: { randomValue, invocationId },
    },
    state,
  });
}

function chooseAsk(turn) {
  const player = turn.payload.player;
  const opponents = turn.payload.legalTargets;
  for (const rank of turn.payload.legalRanks) {
    const target = opponents.find((candidate) =>
      turn.state.hands[candidate].some((card) => card.slice(0, -1) === rank),
    );
    if (target) {
      return {
        player,
        target,
        rank,
        turnToken: turn.payload.turnToken,
      };
    }
  }
  return {
    player,
    target: opponents[0],
    rank: turn.payload.legalRanks[0],
    turnToken: turn.payload.turnToken,
  };
}

function authoritativeCards(state) {
  return [
    ...state.deck,
    ...Object.values(state.hands).flat(),
    ...Object.values(state.books)
      .flat()
      .flatMap((book) => book.cards),
  ];
}

describe('three-player Go Fish Governor harness', () => {
  it('builds three Luna players around one phrase-stopped Governor loop', () => {
    const { harness } = setup();
    const agents = harness.nodes.filter((node) => node.data.kind === 'agent');
    const governor = harness.nodes.find((node) => node.id === 'go-fish-governor');
    const diagnostics = diagnoseGraph(harness.nodes, harness.edges);

    expect(agents).toHaveLength(3);
    expect(governor.data.config).toEqual({
      maxActivations: 10000,
      stopPhrase: 'GAME_OVER',
    });
    expect(
      diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    ).toBe(false);
    expect(
      diagnostics.find((diagnostic) => diagnostic.code === 'execution-cycle')
        ?.message,
    ).toContain('Governed loop detected');
  });

  it('deals seven cards each from one complete unique deck', async () => {
    const started = await execute('START_GO_FISH', {}, 0.37, 'initial-deal');
    const cards = authoritativeCards(started.state);

    expect(started.targetIds).toEqual(['go-fish-player-one']);
    expect(started.payload).toMatchObject({
      type: 'player_turn',
      player: 'Player One',
    });
    expect(Object.values(started.state.hands).map((hand) => hand.length))
      .toEqual([7, 7, 7]);
    expect(started.state.deck).toHaveLength(31);
    expect(cards).toHaveLength(52);
    expect(new Set(cards)).toHaveLength(52);
  });

  it('retries an illegal ask without changing authoritative cards or token', async () => {
    const started = await execute('START_GO_FISH', {}, 0.41, 'retry-start');
    const priorCards = authoritativeCards(started.state);
    const retry = await execute(
      {
        player: started.payload.player,
        target: started.payload.player,
        rank: started.payload.legalRanks[0],
        turnToken: started.payload.turnToken,
      },
      started.state,
      0.8,
      'retry-invalid',
    );

    expect(retry.payload.type).toBe('retry');
    expect(retry.payload.turnToken).toBe(started.payload.turnToken);
    expect(authoritativeCards(retry.state)).toEqual(priorCards);
  });

  it('plays to the first fourth book and lets the Governor block GAME_OVER', async () => {
    let current = await execute('START_GO_FISH', {}, 0.19, 'full-game-start');
    let decisions = 0;
    while (current.payload.type !== 'GAME_OVER' && decisions < 120) {
      current = await execute(
        chooseAsk(current),
        current.state,
        0.5,
        `full-game-${decisions}`,
      );
      decisions += 1;
    }

    expect(current.payload.type).toBe('GAME_OVER');
    expect(current.payload.winningBookCount).toBe(4);
    expect(current.state.books[current.payload.winner]).toHaveLength(4);
    expect(current.targetIds).toEqual([
      'go-fish-game-archive',
      'go-fish-governor',
      'go-fish-table-display',
    ]);
    const cards = authoritativeCards(current.state);
    expect(cards).toHaveLength(52);
    expect(new Set(cards)).toHaveLength(52);
    expect(decisions).toBeLessThan(65);

    const { harness } = setup();
    const governor = harness.nodes.find((node) => node.id === 'go-fish-governor');
    const stopped = await executeNode(
      governor,
      { payload: current.payload },
      { governorState: {} },
    );

    expect(stopped.blocked).toBe(true);
    expect(stopped.meta.governor).toMatchObject({
      reason: 'stop_phrase',
      stopPhraseMatched: true,
    });
  });
});
