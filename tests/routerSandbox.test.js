import { describe, expect, it } from 'vitest';
import {
  executeRouterCode,
  validateGeneratedRouter,
  withRouterRuntime,
} from '../server/routerSandbox.js';

const context = {
  router: { id: 'router', label: 'Router' },
  incoming: [],
  targets: [
    { edgeId: 'edge-a', channel: 'data', node: { id: 'a', label: 'Alpha' } },
    { edgeId: 'edge-b', channel: 'data', node: { id: 'b', label: 'Beta' } },
  ],
};

describe('generated router sandbox', () => {
  it('runs a synchronous router with isolated state', async () => {
    const result = await executeRouterCode({
      code: `function route(input, context, state) {
        const count = (state.count || 0) + 1;
        return {
          targetIds: [context.targets[0].node.id],
          payload: input.toUpperCase(),
          state: { count }
        };
      }`,
      input: 'hello',
      context,
      state: { count: 2 },
    });

    expect(result).toEqual({
      targetIds: ['a'],
      payload: 'HELLO',
      drop: false,
      state: { count: 3 },
    });
  });

  it('rejects destinations that are not connected', async () => {
    await expect(executeRouterCode({
      code: 'function route(input) { return { targetIds: ["elsewhere"], payload: input }; }',
      input: 'hello',
      context,
      state: {},
    })).rejects.toThrow('unconnected target');
  });

  it('interrupts a router that does not terminate', async () => {
    await expect(executeRouterCode({
      code: 'function route() { while (true) {} }',
      input: 'hello',
      context,
      state: {},
    })).rejects.toThrow('time limit');
  });

  it('adds fresh capability-safe runtime entropy', () => {
    const first = withRouterRuntime(context);
    const second = withRouterRuntime(context);

    expect(first.runtime.randomValue).toBeGreaterThanOrEqual(0);
    expect(first.runtime.randomValue).toBeLessThan(1);
    expect(first.runtime.invocationId).not.toBe(second.runtime.invocationId);
  });

  it('rejects random routers that ignore runtime entropy', async () => {
    await expect(validateGeneratedRouter({
      code: 'function route(input) { return { targetIds: ["a"], payload: input }; }',
      summary: 'Always routes to A.',
      assumptions: [],
      tests: [{
        name: 'route',
        input: 'hello',
        randomValue: 0.5,
        expectedTargetIds: ['a'],
      }],
    }, context, 'Choose a random target.')).rejects.toThrow(
      'must use context.runtime.randomValue',
    );
  });

  it('validates random branches with controlled entropy samples', async () => {
    await expect(validateGeneratedRouter({
      code: `function route(input, context) {
        const index = Math.floor(context.runtime.randomValue * context.targets.length);
        return { targetIds: [context.targets[index].node.id], payload: input };
      }`,
      summary: 'Chooses a target uniformly.',
      assumptions: [],
      tests: [
        {
          name: 'low sample',
          input: 'hello',
          randomValue: 0.1,
          expectedTargetIds: ['a'],
        },
        {
          name: 'high sample',
          input: 'hello',
          randomValue: 0.9,
          expectedTargetIds: ['b'],
        },
      ],
    }, context, 'Choose a random target.')).resolves.toBeUndefined();
  });
});
