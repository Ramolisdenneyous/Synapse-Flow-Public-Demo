import { describe, expect, it } from 'vitest';
import { executeRouterCode } from '../server/routerSandbox.js';
import {
  STORY_ENGINE_ROUTER_CODE,
  createStoryEngineHarness,
} from '../scripts/build-story-engine-harness.mjs';
import { diagnoseGraph } from '../src/engine/graphDiagnostics.js';
import { routerContextFor } from '../src/engine/executor.js';

function setup() {
  const harness = createStoryEngineHarness();
  const router = harness.nodes.find((node) => node.id === 'story-engine');
  return {
    harness,
    context: routerContextFor(router, harness.nodes, harness.edges),
  };
}

async function execute(input, state, invocationId, randomValue = 0.31) {
  const { context } = setup();
  return executeRouterCode({
    code: STORY_ENGINE_ROUTER_CODE,
    input,
    context: {
      ...context,
      runtime: { invocationId, randomValue },
    },
    state,
  });
}

function legalDecision(turn) {
  const { payload } = turn;
  if (payload.actor === 'Opposition') {
    return {
      actor: 'Opposition',
      monsterId: payload.monsterActors[0].id,
      target: payload.legalTargets[0],
      turnToken: payload.turnToken,
    };
  }
  const choice =
    payload.legalActions.find((action) => action.action === 'ATTACK') ??
    payload.legalActions[0];
  return {
    actor: payload.actor,
    action: choice.action,
    target: choice.target,
    turnToken: payload.turnToken,
  };
}

describe('Story Engine authoritative chapter harness', () => {
  it('maps the extracted specialist roles around one authoritative engine', () => {
    const { harness } = setup();
    const agents = harness.nodes.filter((node) => node.data.kind === 'agent');
    const diagnostics = diagnoseGraph(harness.nodes, harness.edges);

    expect(agents.map((node) => node.id)).toEqual([
      'story-world-lock',
      'story-player-jannet',
      'story-player-annie',
      'story-player-beau',
      'story-player-joe',
      'story-opposition',
      'story-summary',
      'story-narrative',
    ]);
    expect(
      diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    ).toBe(false);
    expect(
      diagnostics.find((diagnostic) => diagnostic.code === 'execution-cycle')
        ?.message,
    ).toContain('Governed loop detected');
  });

  it('starts with Jannet and supplies exact legal choices and a correlation token', async () => {
    const turn = await execute(
      'Locked world and chapter canon.',
      {},
      'story-start-test',
    );

    expect(turn.targetIds).toEqual(['story-player-jannet']);
    expect(turn.payload).toMatchObject({
      type: 'player_turn',
      actor: 'Jannet',
    });
    expect(turn.payload.turnToken).toContain('story:1:Jannet:');
    expect(turn.payload.legalActions).toContainEqual({
      action: 'ATTACK',
      target: 'raider-1',
      label: 'Attack Frost Raider One',
    });
    expect(turn.state.party.Jannet.hp).toBe(24);
    expect(turn.state.enemies).toHaveLength(2);
  });

  it('retries malformed or stale agent output without mutating combat state', async () => {
    const started = await execute('Locked canon.', {}, 'retry-start');
    const retried = await execute(
      {
        actor: 'Jannet',
        action: 'ATTACK',
        target: 'raider-1',
        turnToken: 'stale-token',
      },
      started.state,
      'retry-invalid',
    );

    expect(retried.targetIds).toEqual(['story-player-jannet']);
    expect(retried.payload.type).toBe('retry');
    expect(retried.payload.error).toContain('turnToken');
    expect(retried.state.enemies).toEqual(started.state.enemies);
    expect(retried.state.events).toEqual(started.state.events);
  });

  it('bounds invalid output retries and advances with an explicit fallback event', async () => {
    const started = await execute('Locked canon.', {}, 'fallback-start');
    const retryOne = await execute(
      'not json',
      started.state,
      'fallback-one',
    );
    const retryTwo = await execute(
      'still not json',
      retryOne.state,
      'fallback-two',
    );
    const advanced = await execute(
      'definitely not json',
      retryTwo.state,
      'fallback-three',
    );

    expect(retryOne.payload.type).toBe('retry');
    expect(retryTwo.payload.type).toBe('retry');
    expect(advanced.payload.actor).toBe('Annie');
    expect(advanced.state.events.at(-1)).toMatchObject({
      type: 'invalid_response_fallback',
      actor: 'Jannet',
    });
  });

  it('keeps mechanics authoritative and requests a durable summary after a round', async () => {
    let turn = await execute('Locked canon.', {}, 'round-start', 0.42);
    const expectedActors = ['Jannet', 'Annie', 'Beau', 'Joe', 'Opposition'];

    for (const actor of expectedActors) {
      expect(turn.payload.actor).toBe(actor);
      turn = await execute(
        legalDecision(turn),
        turn.state,
        `round-${actor}`,
        0.42,
      );
    }

    expect(turn.targetIds).toEqual(['story-summary']);
    expect(turn.payload.type).toBe('summarize_turn_delta');
    expect(turn.payload.completedRound).toBe(1);
    expect(turn.payload.events).toHaveLength(6);
    expect(turn.state.round).toBe(2);
    expect(
      turn.state.events.every((event) => typeof event.result === 'string'),
    ).toBe(true);
  });

  it('runs through the chapter boundary and hands the exact record to Narrative', async () => {
    let turn = await execute('Locked canon.', {}, 'full-start', 0.73);
    let steps = 0;
    while (turn.payload.type !== 'build_narrative' && steps < 30) {
      const input =
        turn.payload.type === 'summarize_turn_delta'
          ? `Durable summary through round ${turn.payload.completedRound}.`
          : legalDecision(turn);
      turn = await execute(input, turn.state, `full-${steps}`, 0.73);
      steps += 1;
    }

    expect(turn.payload.type).toBe('build_narrative');
    expect(turn.targetIds).toEqual(['story-run-archive', 'story-narrative']);
    expect(['party_victory', 'party_defeat', 'chapter_boundary']).toContain(
      turn.payload.ending,
    );
    expect(turn.payload.completeEvents.length).toBeGreaterThan(1);
    expect(turn.payload.finalState.party.Jannet).toHaveProperty('hp');
    expect(turn.payload.worldLock).toBe('Locked canon.');
    expect(steps).toBeLessThan(30);
  });
});
