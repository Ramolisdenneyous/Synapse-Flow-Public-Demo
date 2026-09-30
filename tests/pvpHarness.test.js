import { describe, expect, it } from 'vitest';
import { executeRouterCode } from '../server/routerSandbox.js';
import {
  COMBAT_ROUTER_CODE,
  createPvpHarness,
} from '../scripts/build-pvp-harness.mjs';
import { routerContextFor } from '../src/engine/executor.js';

function setup() {
  const harness = createPvpHarness();
  const router = harness.nodes.find((node) => node.id === 'pvp-combat-engine');
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

describe('2v2 PVP harness', () => {
  it('starts with four unique d20 initiative rolls and one active combatant', async () => {
    const { harness, context } = setup();
    const result = await executeRouterCode({
      code: COMBAT_ROUTER_CODE,
      input: 'START_MATCH',
      context: withRuntime(context, 0, 'start-00000000'),
      state: {},
    });

    expect(new Set(Object.values(result.state.initiativeRolls))).toHaveLength(4);
    expect(result.state.hp).toEqual({ Lumen: 10, Spark: 10, Bolt: 10, Chip: 10 });
    expect(result.payload.type).toBe('turn');
    expect(result.targetIds).toContain('pvp-battle-chronicle');
    expect(result.targetIds).toContain('pvp-arena-feed');
    expect(
      result.targetIds.filter((id) => harness.nodes.find((node) => node.id === id)?.data.kind === 'agent'),
    ).toHaveLength(1);
  });

  it('resolves a valid attack and advances to the next living combatant', async () => {
    const { context } = setup();
    const started = await executeRouterCode({
      code: COMBAT_ROUTER_CODE,
      input: 'START_MATCH',
      context: withRuntime(context, 0, 'start-00000000'),
      state: {},
    });
    const actor = started.payload.actor;
    const target = started.payload.legalTargets[0];

    const result = await executeRouterCode({
      code: COMBAT_ROUTER_CODE,
      input: JSON.stringify({
        actor,
        action: 'attack',
        target,
        turnToken: started.payload.turnToken,
      }),
      context: withRuntime(context, 0.999999, 'attack-00000000'),
      state: started.state,
    });

    expect(result.payload.lastEvent).toMatchObject({
      actor,
      target,
      attackRoll: 20,
      damage: 8,
      hit: true,
    });
    expect(result.state.hp[target]).toBe(2);
    expect(result.payload.actor).not.toBe(actor);
  });

  it('retries an invalid decision without advancing the turn', async () => {
    const { context } = setup();
    const started = await executeRouterCode({
      code: COMBAT_ROUTER_CODE,
      input: 'START_MATCH',
      context: withRuntime(context, 0, 'start-00000000'),
      state: {},
    });

    const result = await executeRouterCode({
      code: COMBAT_ROUTER_CODE,
      input: '{"actor":"Wrong","action":"attack","target":"Bolt","turnToken":"bad"}',
      context: withRuntime(context, 0.5, 'retry-00000000'),
      state: started.state,
    });

    expect(result.payload.type).toBe('retry');
    expect(result.state).toEqual(started.state);
    expect(result.targetIds).toEqual([
      `pvp-agent-${started.payload.actor.toLowerCase()}`,
    ]);
  });

  it('ends the queue when the opposing team is defeated', async () => {
    const { context } = setup();
    const state = {
      initialized: true,
      status: 'active',
      hp: { Lumen: 0, Spark: 1, Bolt: 10, Chip: 10 },
      initiative: ['Chip', 'Spark', 'Bolt', 'Lumen'],
      initiativeRolls: { Lumen: 1, Spark: 2, Bolt: 3, Chip: 4 },
      turnIndex: 0,
      round: 2,
      turn: 8,
      turnToken: 'winning-turn',
    };

    const result = await executeRouterCode({
      code: COMBAT_ROUTER_CODE,
      input: JSON.stringify({
        actor: 'Chip',
        action: 'attack',
        target: 'Spark',
        turnToken: 'winning-turn',
      }),
      context: withRuntime(context, 0.999999, 'finish-00000000'),
      state,
    });

    expect(result.payload).toMatchObject({
      type: 'match_complete',
      winner: 'Crimson',
    });
    expect(result.targetIds).toEqual([
      'pvp-battle-chronicle',
      'pvp-arena-feed',
    ]);
  });
});
